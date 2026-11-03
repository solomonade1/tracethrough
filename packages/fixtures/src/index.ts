import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Secret planted in fixture traffic. Redaction tests assert it never appears in captured output.
 * Shaped so that only key-based redaction (not value patterns) can catch it.
 */
export const CANARY = 'tlcanary7f3a9c';

export interface FixtureServer {
  url: string;
  close(): Promise<void>;
}

const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

/** Page whose script exercises every basic scenario, then sets `window.__done = true`. */
const BASIC_PAGE = `<!doctype html>
<html><head><title>fixture</title>
<meta name="csrf-token" content="${CANARY}">
</head><body>
<img src="/api/binary">
<script>
(async () => {
  const j = (p, init) => fetch(p, init).then(r => r.text()).catch(() => {});
  await j('/api/ok?api_key=${CANARY}&page=1');
  await j('/api/not-found');
  await j('/api/error');
  await j('/redirect/a');
  await j('/api/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ${CANARY}' },
    body: JSON.stringify({ username: 'ada', password: '${CANARY}' }),
  });
  await j('/api/set-cookie');
  await j('/api/large?kb=600');
  await new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('GET', '/api/slow?ms=150');
    x.onloadend = resolve;
    x.send();
  });
  window.__done = true;
})();
</script></body></html>`;

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://fixture');
  switch (url.pathname) {
    case '/':
    case '/basic':
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(BASIC_PAGE);
    case '/blank':
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>blank</title>');
    case '/api/ok':
      return json(res, 200, { user: { name: 'Ada', email: 'ada@example.test' }, accessToken: CANARY, items: [1, 2, 3] });
    case '/api/not-found':
      return json(res, 404, { error: 'not found' });
    case '/api/error':
      return json(res, 500, { error: 'boom' });
    case '/redirect/a':
      res.writeHead(302, { location: '/redirect/b' });
      return res.end();
    case '/redirect/b':
      res.writeHead(301, { location: '/api/ok' });
      return res.end();
    case '/api/echo': {
      const body = await readBody(req);
      return json(res, 200, { received: body.length, echo: safeJson(body) });
    }
    case '/api/set-cookie':
      res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': [`sid=${CANARY}; Path=/; HttpOnly`, 'theme=dark; Path=/'] });
      return res.end('ok');
    case '/api/large': {
      const kb = Number(url.searchParams.get('kb') ?? 300);
      return json(res, 200, { password: CANARY, filler: 'x'.repeat(kb * 1024) });
    }
    case '/api/binary':
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG_1PX);
    case '/api/slow': {
      const ms = Number(url.searchParams.get('ms') ?? 500);
      await new Promise((r) => setTimeout(r, ms));
      return json(res, 200, { waitedMs: ms });
    }
    case '/api/headers':
      return json(
        res,
        200,
        { traceparent: req.headers.traceparent ?? null, hasCookie: !!req.headers.cookie },
        { 'access-control-allow-origin': '*' },
      );
    case '/api/hang':
      return; // never responds; used for abort/cancel scenarios
    default:
      return json(res, 404, { error: 'unknown fixture route' });
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export async function startFixtureServer(port = 0): Promise<FixtureServer> {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
