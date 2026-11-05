/**
 * App Connect across the documented Next.js support matrix, in a real Next.js server (no desktop app).
 *
 *   pnpm test:next-matrix                      # every version and mode below
 *   NEXT_MATRIX=15:dev pnpm test:next-matrix   # one cell, as CI runs it
 *
 * Each cell starts `next dev` or `next build && next start` on a sample app, with the SDK pointed at
 * a test collector, and sends requests carrying known `traceparent` headers. The assertions are
 * about which trace an upstream call is linked to, so they hold without any browser.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatTraceparent, newTraceContext, type ServerEventInput } from '@tracethrough/core';
import { startCollector, type Collector } from '@tracethrough/collector';
import { startFixtureServer, type FixtureServer } from '@tracethrough/fixtures';

type Mode = 'dev' | 'start';
interface Cell {
  /** Next.js major version. */
  major: 15 | 16;
  mode: Mode;
  dir: string;
}

const examples = resolve(import.meta.dirname, '../../../examples');
const FIXTURES = { 15: 'next-app-15', 16: 'next-app' } as const;

/** `NEXT_MATRIX="15:dev,16:start"` selects cells; default is all four. */
const cells: Cell[] = (process.env.NEXT_MATRIX ?? '16:dev,16:start,15:dev,15:start')
  .split(',')
  .map((c) => c.trim().split(':'))
  .map(([major, mode]) => ({ major: Number(major) as 15 | 16, mode: mode as Mode, dir: join(examples, FIXTURES[Number(major) as 15 | 16]) }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });
}

/** `next` runs its server in a child process; on Windows killing the parent leaves it running. */
function killTree(child: ChildProcess | undefined) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

function runToCompletion(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    child.on('error', reject);
    child.on('close', (code) => resolveRun({ code, output }));
  });
}

interface RunningNext {
  port: number;
  child: ChildProcess;
  log: () => string;
}

describe.each(cells)('Next.js $major ($mode)', ({ major, mode, dir }) => {
  const nextBin = createRequire(join(dir, 'package.json')).resolve('next/dist/bin/next');
  let upstream: FixtureServer;
  let collector: Collector;
  let server: RunningNext | undefined;
  const received: ServerEventInput[] = [];
  /** Every trace id this test sent. Anything else showing up on an event would be invented. */
  const sent = new Set<string>();

  const baseEnv = (): NodeJS.ProcessEnv => ({
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    UPSTREAM_URL: upstream.url,
    UPSTREAM_API_KEY: 'tlsecretkey9q2w',
  });

  async function startNext(env: NodeJS.ProcessEnv): Promise<RunningNext> {
    const port = await freePort();
    const child = spawn(process.execPath, [nextBin, mode, '-p', String(port), '-H', '127.0.0.1'], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let output = '';
    child.stdout!.on('data', (c) => (output += c));
    child.stderr!.on('data', (c) => (output += c));
    const deadline = Date.now() + 120_000;
    while (!/Ready in|✓ Ready|Local:/.test(output) || !/App Connect: (enabled|disabled)/.test(output)) {
      if (Date.now() > deadline || child.exitCode !== null) {
        killTree(child);
        throw new Error(`next ${mode} did not start:\n${output}`);
      }
      await sleep(250);
    }
    return { port, child, log: () => output };
  }

  const get = (path: string, trace?: string, port = server!.port) =>
    new Promise<number>((resolveStatus, reject) => {
      const headers: Record<string, string> = trace ? { traceparent: trace } : {};
      const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
        res.resume();
        res.on('end', () => resolveStatus(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end();
    });

  /** A request carrying a fresh trace; returns that trace id. */
  async function trace(path: string): Promise<string> {
    const ctx = newTraceContext();
    sent.add(ctx.traceId);
    expect(await get(path, formatTraceparent(ctx))).toBe(200);
    return ctx.traceId;
  }

  const latest = () => [...new Map(received.map((e) => [e.id, e])).values()];
  /** Upstream calls the sample app makes while rendering `/` (SSR) and in its route handler. */
  const ssrCalls = () => latest().filter((e) => e.urlSanitized.includes('/api/ok?api_key='));
  const handlerCalls = () => latest().filter((e) => e.urlSanitized.includes('/api/slow'));

  async function until<T>(read: () => T | undefined, what: string, timeoutMs = 20_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = read();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; events so far:\n${JSON.stringify(latest().map((e) => [e.urlSanitized, e.traceId, e.handler]), null, 1)}`);
      await sleep(100);
    }
  }

  beforeAll(async () => {
    upstream = await startFixtureServer();
    collector = await startCollector({ port: 0, onEvents: (events) => void received.push(...events) });

    if (mode === 'start') {
      // The production build prerenders /cached, so the fixture upstream must be up (it is) and the
      // SDK must stay out of the build: it is only configured for the server below.
      // Asynchronous on purpose: the fixture upstream lives in this process and must keep answering.
      const build = await runToCompletion(process.execPath, [nextBin, 'build'], dir, baseEnv());
      if (build.code !== 0) throw new Error(`next build failed:
${build.output}`);
    }
    server = await startNext({
      ...baseEnv(),
      TRACETHROUGH_COLLECTOR_URL: collector.url,
      TRACETHROUGH_TOKEN: collector.token,
      // Production never reports unless asked to: this opt-in is explicit, as it must be for any real use.
      ...(mode === 'start' ? { TRACETHROUGH_ALLOW_PRODUCTION: '1' } : { NODE_ENV: 'development' }),
    });
  });

  afterAll(async () => {
    killTree(server?.child);
    await upstream?.close();
    await collector?.close();
  });

  it('starts with App Connect enabled', () => {
    expect(server!.log()).toContain('App Connect: enabled');
  });

  it(
    major === 15
      ? 'first render after startup: linked to its own request or not linked, never to another (Next.js 15 limitation)'
      : 'links the first render after startup',
    async () => {
      const id = await trace('/');
      const call = await until(() => ssrCalls()[0], 'the first SSR upstream call');
      if (major === 16) {
        expect(call.traceId).toBe(id);
        expect(call.handler).toBe('GET /');
      } else {
        // The documented Next 15 limitation: this render can run outside the request's async context,
        // so it may be reported unlinked. It is never allowed to be linked to anything but its own
        // request. (Automated runs on 15.5.29 linked it in both dev and start; manual observations
        // saw it unlinked, so the support matrix keeps calling it a limitation.)
        expect([id, undefined]).toContain(call.traceId);
      }
    },
    120_000,
  );

  it('links a subsequent render to its own request', async () => {
    const id = await trace('/?second=1');
    const call = await until(() => ssrCalls().find((e) => e.traceId === id), 'the SSR call of the second render');
    expect(call).toMatchObject({ traceId: id, handler: 'GET /?second=1', state: 'complete' });
  }, 60_000);

  it('links route handlers, on first and later calls', async () => {
    const first = await trace('/api/products');
    const second = await trace('/api/products?again=1');
    for (const [id, handler] of [
      [first, 'GET /api/products'],
      [second, 'GET /api/products?again=1'],
    ] as const) {
      const call = await until(() => handlerCalls().find((e) => e.traceId === id), `the route handler call for ${handler}`);
      expect(call.handler).toBe(handler);
    }
  }, 60_000);

  it('never lets concurrent requests inherit one another’s trace', async () => {
    const N = 10;
    const requests = Array.from({ length: N }, (_, i) => ({ i, page: newTraceContext(), route: newTraceContext() }));
    for (const r of requests) {
      sent.add(r.page.traceId);
      sent.add(r.route.traceId);
    }
    // Pages and route handlers at once, all in flight together.
    await Promise.all(
      requests.flatMap(({ i, page, route }) => [
        get(`/?c=${i}`, formatTraceparent(page)),
        get(`/api/products?c=${i}`, formatTraceparent(route)),
      ]),
    );
    const mine = (e: ServerEventInput) => /\?c=\d+$/.test(e.handler ?? '');
    await until(
      () => (ssrCalls().filter(mine).length >= N && handlerCalls().filter(mine).length >= N ? true : undefined),
      'every concurrent render and route handler call to be reported',
    );

    const pages = new Map(ssrCalls().map((e) => [e.handler, e]));
    const routes = new Map(handlerCalls().map((e) => [e.handler, e]));
    for (const { i, page, route } of requests) {
      expect(pages.get(`GET /?c=${i}`)?.traceId, `render ${i} must carry its own trace`).toBe(page.traceId);
      expect(routes.get(`GET /api/products?c=${i}`)?.traceId, `route call ${i} must carry its own trace`).toBe(route.traceId);
    }
    // Each trace id appears on exactly one call: nothing was handed to a neighbour.
    const counts = new Map<string, number>();
    for (const e of [...ssrCalls(), ...handlerCalls()]) if (e.traceId) counts.set(e.traceId, (counts.get(e.traceId) ?? 0) + 1);
    for (const { page, route } of requests) {
      expect(counts.get(page.traceId)).toBe(1);
      expect(counts.get(route.traceId)).toBe(1);
    }
  }, 120_000);

  it('does not invent a trace for framework prerender or cache work', async () => {
    const first = await trace('/cached');
    await sleep(1500); // past the 1 second revalidation window, so the next request regenerates it
    const second = await trace('/cached');
    await sleep(1500);
    await get('/cached'); // and one request with no trace at all
    await sleep(500);
    const cached = latest().filter((e) => e.urlSanitized.includes('case=cached'));
    for (const e of cached) {
      // Background regeneration may be attributed to the request that triggered it, or to nothing,
      // but never to a trace no request carried.
      expect([first, second, undefined]).toContain(e.traceId);
    }
  }, 60_000);

  it('only ever reports trace ids that requests actually carried', () => {
    expect(received.length).toBeGreaterThan(0);
    for (const e of latest()) {
      if (e.traceId !== undefined) expect(sent.has(e.traceId), `${e.urlSanitized} carries an unknown trace ${e.traceId}`).toBe(true);
    }
  });

  if (mode === 'start') {
    it('stays off in production unless explicitly enabled, without breaking the app', async () => {
      const before = received.length;
      const quiet = await startNext({
        ...baseEnv(),
        TRACETHROUGH_COLLECTOR_URL: collector.url,
        TRACETHROUGH_TOKEN: collector.token,
        TRACETHROUGH_ALLOW_PRODUCTION: '',
      });
      try {
        expect(quiet.log()).toContain('App Connect: disabled');
        expect(quiet.log()).toMatch(/NODE_ENV=production/);
        expect(await get('/', formatTraceparent(newTraceContext()), quiet.port)).toBe(200);
        await sleep(1000);
        expect(received.length).toBe(before);
      } finally {
        killTree(quiet.child);
      }
    }, 120_000);
  }
});
