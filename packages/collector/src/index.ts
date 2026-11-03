import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ServerEventBatch, type ServerEventInput } from '@tracelens/core';

export const DEFAULT_COLLECTOR_PORT = 47811;

export interface CollectorOptions {
  /** Preferred port; falls back to a random free port if taken. 0 = random. */
  port?: number;
  /** Bearer token SDKs must present. Generated when omitted. */
  token?: string;
  /** Receives validated batches. Return false to tell SDKs to stop sending (kill switch). */
  onEvents(events: ServerEventInput[]): boolean | void;
  maxBodyBytes?: number;
}

export interface Collector {
  url: string;
  port: number;
  token: string;
  /** Batches accepted since start. */
  readonly stats: { batches: number; events: number; rejected: number };
  close(): Promise<void>;
}

export const generateToken = () => randomBytes(24).toString('base64url');

function tokensEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
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
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Loopback-only ingest endpoint for App Connect SDKs (RFC-001). It authenticates, bounds and
 * validates input; it does not redact — the caller re-applies its own policy before storing.
 */
export async function startCollector(opts: CollectorOptions): Promise<Collector> {
  const token = opts.token ?? generateToken();
  const maxBodyBytes = opts.maxBodyBytes ?? 1024 * 1024;
  const stats = { batches: 0, events: 0, rejected: 0 };
  let port = 0;

  const server = createServer(async (req, res) => {
    const reject = (status: number, error: string) => {
      stats.rejected++;
      reply(res, status, { error });
    };
    // Browsers always send Origin on cross-origin POSTs; SDKs never do. Blocks drive-by web pages.
    if (req.headers.origin !== undefined) return reject(403, 'origin not allowed');
    // DNS-rebinding guard: only accept our own loopback authority.
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reject(403, 'host not allowed');
    if (req.method !== 'POST' || req.url !== '/v1/events') return reject(404, 'not found');

    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || !tokensEqual(auth.slice(7), token)) return reject(401, 'invalid token');
    if (!String(req.headers['content-type']).startsWith('application/json')) return reject(415, 'expected JSON');

    const text = await readBody(req, maxBodyBytes);
    if (text === undefined) return reject(413, 'payload too large');
    let parsed: ReturnType<typeof ServerEventBatch.safeParse>;
    try {
      parsed = ServerEventBatch.safeParse(JSON.parse(text));
    } catch {
      return reject(400, 'invalid JSON');
    }
    if (!parsed.success) return reject(400, 'invalid batch');

    stats.batches++;
    stats.events += parsed.data.events.length;
    let enabled = true;
    try {
      enabled = opts.onEvents(parsed.data.events) !== false;
    } catch {
      // A consumer bug must not break the SDK protocol.
    }
    reply(res, 200, { accepted: parsed.data.events.length, enabled });
  });
  server.requestTimeout = 10_000;

  const preferred = opts.port ?? DEFAULT_COLLECTOR_PORT;
  try {
    port = await listen(server, preferred);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || preferred === 0) throw err;
    port = await listen(server, 0);
  }

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    stats,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
