import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { BROWSER_LABELS, findBrowsers, type BrowserChannel } from '@tracethrough/capture';
import { generateToken } from '@tracethrough/collector';
import { ConnectService } from '../main/connect';
import { SessionHost } from '../main/session-host';
import { IPC, type AppEnvironment } from '../shared/api';

export const DEFAULT_WEB_PORT = 47812;

export interface WebServerOptions {
  /** Built web UI (`index.html` + assets). */
  staticDir: string;
  appVersion: string;
  /** Persisted App Connect token, shared with the desktop app. */
  collectorTokenFile: string;
  /** Preferred port; falls back to a random free port if taken. 0 = random. */
  port?: number;
  /** Secret the UI must present; generated per launch when omitted. */
  token?: string;
  collectorPort?: number;
  collectorToken?: string;
  headless?: boolean;
  channel?: BrowserChannel;
}

export interface WebServer {
  url: string;
  /** URL to open: carries the UI token in the fragment, which browsers never send to servers. */
  launchUrl: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

/** RPC routes mirror the Electron IPC channels; `events` and `status` arrive on the stream instead. */
type RpcName = Exclude<keyof typeof IPC, 'events' | 'status'>;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

const MAX_RPC_BODY = 64 * 1024;

function tokensEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit: number): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolvePort((server.address() as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Local web mode: serves the inspector UI to the developer's own browser and runs capture on this
 * machine, exactly as the desktop app does. Loopback only; every API call needs the per-launch token,
 * and foreign Host/Origin headers are refused so other pages (or DNS rebinding) cannot drive it.
 */
export async function startWebServer(opts: WebServerOptions): Promise<WebServer> {
  const token = opts.token ?? generateToken();
  const staticRoot = resolve(opts.staticDir);
  const streams = new Set<ServerResponse>();
  let port = 0;

  const broadcast = (channel: string, payload: unknown) => {
    const line = `${JSON.stringify({ channel, payload })}\n`;
    for (const res of streams) res.write(line);
  };
  const host = new SessionHost(broadcast, { headless: opts.headless, channel: opts.channel, appVersion: opts.appVersion });
  const connect = new ConnectService({
    tokenFile: opts.collectorTokenFile,
    port: opts.collectorPort,
    token: opts.collectorToken,
    ingest: (events) => host.ingest(events),
  });

  const rpc: Record<RpcName, (args: unknown[]) => unknown> = {
    start: ([url, options]) => host.start(url, options),
    stop: () => host.stop(),
    clear: () => host.clear(),
    export: ([format]) => {
      if (format !== 'har' && format !== 'json') throw new Error('Unknown export format');
      return host.exportData(format) ?? null;
    },
    connectInfo: () => connect.info(),
    regenerateToken: () => connect.regenerate(),
    environment: (): AppEnvironment => ({
      version: opts.appVersion,
      browsers: findBrowsers().map((channel) => ({ channel, label: BROWSER_LABELS[channel] })),
    }),
  };

  function openStream(res: ServerResponse) {
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
    streams.add(res);
    res.on('close', () => streams.delete(res));
    // A tab that attaches mid-session (or reloads) catches up on the current state.
    res.write(`${JSON.stringify({ channel: IPC.status, payload: host.status })}\n`);
    const snapshot = host.snapshot();
    if (snapshot.upserts.length) res.write(`${JSON.stringify({ channel: IPC.events, payload: snapshot })}\n`);
  }

  async function callRpc(req: IncomingMessage, res: ServerResponse, name: string) {
    if (!Object.hasOwn(rpc, name)) return reply(res, 404, { error: 'not found' });
    if (!String(req.headers['content-type']).startsWith('application/json')) return reply(res, 415, { error: 'expected JSON' });
    const text = await readBody(req, MAX_RPC_BODY);
    if (text === undefined) return reply(res, 413, { error: 'payload too large' });
    let args: unknown;
    try {
      args = JSON.parse(text || '[]');
    } catch {
      return reply(res, 400, { error: 'invalid JSON' });
    }
    if (!Array.isArray(args)) return reply(res, 400, { error: 'expected an argument array' });
    try {
      reply(res, 200, { result: await rpc[name as RpcName](args) });
    } catch (err) {
      reply(res, 500, { error: (err as Error).message });
    }
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'method not allowed' });
    let file: string;
    try {
      file = resolve(staticRoot, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
    } catch {
      return reply(res, 400, { error: 'bad path' });
    }
    if (!file.startsWith(staticRoot + sep)) return reply(res, 404, { error: 'not found' });
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) return reply(res, 404, { error: 'not found' });
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': info.size,
      // Hashed asset names are immutable; the page itself must always be fresh.
      'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  }

  const server = createServer(async (req, res) => {
    // DNS-rebinding guard: only accept our own loopback authority.
    const authority = req.headers.host;
    if (authority !== `127.0.0.1:${port}` && authority !== `localhost:${port}`) return reply(res, 403, { error: 'host not allowed' });
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${authority}`) return reply(res, 403, { error: 'origin not allowed' });

    const { pathname } = new URL(req.url ?? '/', 'http://local');
    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || !tokensEqual(auth.slice(7), token)) return reply(res, 401, { error: 'invalid token' });
    if (pathname === '/api/stream' && req.method === 'GET') return openStream(res);
    if (req.method === 'POST') return callRpc(req, res, pathname.slice('/api/'.length));
    reply(res, 404, { error: 'not found' });
  });

  await connect.start();
  const preferred = opts.port ?? DEFAULT_WEB_PORT;
  try {
    port = await listen(server, preferred);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || preferred === 0) {
      await connect.close();
      throw err;
    }
    port = await listen(server, 0);
  }

  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    launchUrl: `${url}/#token=${token}`,
    port,
    token,
    async close() {
      for (const res of streams) res.end();
      await host.dispose();
      await connect.close();
      await new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      });
    },
  };
}

/** Where the desktop app keeps its data, so both modes share one App Connect token. */
export function desktopUserDataDir(productName: string): string {
  const env = process.env;
  const home = homedir();
  const base =
    process.platform === 'win32'
      ? (env.APPDATA ?? join(home, 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support')
        : (env.XDG_CONFIG_HOME ?? join(home, '.config'));
  return join(base, productName);
}
