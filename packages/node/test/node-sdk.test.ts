import { Agent, createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatTraceparent, newTraceContext, type ServerEventInput } from '@tracethrough/core';
import { startCollector, type Collector } from '@tracethrough/collector';
import { CANARY, startFixtureServer, type FixtureServer } from '@tracethrough/fixtures';
import { register, type TraceThroughHandle } from '../src/index.ts';

const silent = { warn: () => {} };

describe('register guards', () => {
  const env = { ...process.env };
  afterAll(() => {
    process.env = env;
  });

  it.each([
    [{}, {}, /not set/],
    [{ collectorUrl: 'http://10.0.0.5:47811', token: 't' }, {}, /loopback/],
    [{ collectorUrl: 'https://127.0.0.1:47811', token: 't' }, {}, /loopback/],
    [{ collectorUrl: 'http://127.0.0.1:47811', token: 't' }, { NODE_ENV: 'production' }, /production/],
    [{ collectorUrl: 'http://127.0.0.1:47811', token: 't' }, { TRACETHROUGH_DISABLED: '1' }, /TRACETHROUGH_DISABLED/],
  ])('stays off for %j with env %j', (opts, extraEnv, reason) => {
    process.env = { ...env, TRACETHROUGH_COLLECTOR_URL: '', TRACETHROUGH_TOKEN: '', ...extraEnv };
    const handle = register({ ...opts, logger: silent });
    expect(handle.enabled).toBe(false);
    expect(handle.disabledReason).toMatch(reason);
  });
});

describe('App Connect Node SDK', () => {
  let collector: Collector;
  let upstream: FixtureServer;
  let app: Server;
  let appPort: number;
  let handle: TraceThroughHandle;
  const received: ServerEventInput[] = [];

  /** Calls the instrumented app with node:http (not fetch) so the test client isn't itself observed. */
  function callApp(path: string, headers: Record<string, string> = {}, agent?: Agent) {
    return new Promise<string>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: appPort, path, headers, agent }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (text += c));
        res.on('end', () => resolve(text));
      });
      req.on('error', reject);
      req.end();
    });
  }

  async function eventsFor(pred: (e: ServerEventInput) => boolean, count = 1) {
    await handle.flush();
    for (let i = 0; i < 50; i++) {
      // Latest version of each exchange (the SDK sends headers-time and completion updates).
      const latest = new Map(received.map((e) => [e.id, e]));
      const matches = [...latest.values()].filter(pred);
      // Complete exchanges are done once timing and the (separately read) response body are in.
      const done = (e: ServerEventInput) =>
        e.state === 'failed' || (e.state === 'complete' && e.timing?.downloadMs !== undefined && e.responseBody !== undefined);
      if (matches.length >= count && matches.every(done)) return matches;
      await new Promise((r) => setTimeout(r, 20));
      await handle.flush();
    }
    throw new Error('timed out waiting for server events');
  }

  beforeAll(async () => {
    collector = await startCollector({ port: 0, onEvents: (events) => void received.push(...events) });
    upstream = await startFixtureServer();
    handle = register({ collectorUrl: collector.url, token: collector.token, flushIntervalMs: 10, logger: silent });

    app = createServer(async (req, res) => {
      try {
        if (req.url?.startsWith('/page')) {
          await (await fetch(`${upstream.url}/api/ok?api_key=${CANARY}`, { headers: { authorization: `Bearer ${CANARY}` } })).text();
          // Context must survive timers and parallel awaits.
          await new Promise((r) => setTimeout(r, 5));
          await Promise.all([fetch(`${upstream.url}/api/not-found`).then((r) => r.text()), fetch(`${upstream.url}/api/error`).then((r) => r.text())]);
        } else if (req.url === '/fail') {
          await fetch('http://tracethrough-nope.invalid/x').catch(() => {});
        } else if (req.url === '/post') {
          await (
            await fetch(`${upstream.url}/api/echo`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ username: 'ada', password: CANARY }),
            })
          ).text();
        } else if (req.url === '/large') {
          // The app must still get the whole body even though the SDK keeps only a preview.
          return res.end(String((await (await fetch(`${upstream.url}/api/large?kb=200`)).text()).length));
        } else if (req.url === '/binary') {
          await (await fetch(`${upstream.url}/api/binary`)).arrayBuffer();
        }
        res.end('ok');
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err));
      }
    });
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    appPort = (app.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await handle?.shutdown();
    app?.close();
    await upstream?.close();
    await collector?.close();
  });

  it('is enabled with a loopback collector', () => {
    expect(handle.enabled).toBe(true);
  });

  it('reports outgoing fetches linked to the incoming traceparent (SDK-01, COR-01)', async () => {
    const ctx = newTraceContext();
    await callApp('/page?session=abc&q=1', { traceparent: formatTraceparent(ctx) });
    const events = await eventsFor((e) => e.traceId === ctx.traceId, 3);

    expect(events.map((e) => new URL(e.urlSanitized).pathname).sort()).toEqual(['/api/error', '/api/not-found', '/api/ok']);
    for (const e of events) {
      expect(e).toMatchObject({ state: 'complete', type: 'fetch', handler: 'GET /page?session=abc&q=1' });
      expect(e.spanId).toMatch(/^[0-9a-f]{16}$/);
    }
    const byPath = Object.fromEntries(events.map((e) => [new URL(e.urlSanitized).pathname, e]));
    expect(byPath['/api/ok']!.status).toBe(200);
    expect(byPath['/api/not-found']!.status).toBe(404);
    expect(byPath['/api/error']!.status).toBe(500);
    expect(byPath['/api/error']!.responseBody).toMatchObject({ mime: 'application/json', preview: '{"error":"boom"}', truncated: false });
  });

  it('sends headers, URLs and bodies exactly as captured by default', async () => {
    const [ok] = await eventsFor((e) => e.urlSanitized.includes('/api/ok'));
    expect(ok!.urlSanitized).toContain(`api_key=${CANARY}`);
    expect(ok!.requestHeadersSanitized?.authorization).toBe(`Bearer ${CANARY}`);
    expect(ok!.responseBody?.preview).toContain(`"accessToken":"${CANARY}"`);
    expect(ok!.redactionApplied).toBe(false);
  });

  it('captures request and response bodies', async () => {
    await callApp('/post');
    const [post] = await eventsFor((e) => e.method === 'POST' && e.urlSanitized.endsWith('/api/echo'));
    expect(post!.requestBody).toMatchObject({ mime: 'application/json', truncated: false });
    expect(JSON.parse(post!.requestBody!.preview!)).toEqual({ username: 'ada', password: CANARY });
    expect(JSON.parse(post!.responseBody!.preview!)).toMatchObject({ echo: { username: 'ada', password: CANARY } });
  });

  it('truncates long bodies without changing what the app receives', async () => {
    const appGot = Number(await callApp('/large'));
    expect(appGot).toBeGreaterThan(200 * 1024);
    const [large] = await eventsFor((e) => e.urlSanitized.includes('/api/large'));
    expect(large!.responseBody!.truncated).toBe(true);
    expect(Buffer.byteLength(large!.responseBody!.preview!)).toBeLessThanOrEqual(64 * 1024);
    expect(large!.responseBody!.preview).toMatch(/^{"password":"/);
  });

  it('reports binary bodies instead of reading them', async () => {
    await callApp('/binary');
    const [binary] = await eventsFor((e) => e.urlSanitized.endsWith('/api/binary'));
    expect(binary!.responseBody).toMatchObject({ mime: 'image/png', unavailableReason: 'binary' });
  });

  it('records failures with an error code', async () => {
    await callApp('/fail');
    const [failed] = await eventsFor((e) => e.domain === 'tracethrough-nope.invalid');
    expect(failed).toMatchObject({ state: 'failed', error: { code: 'ENOTFOUND' }, handler: 'GET /fail' });
    expect(failed!.traceId).toBeUndefined();
  });

  it('does not leak trace context across keep-alive requests', async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const ctx = newTraceContext();
    await callApp('/page?n=1', { traceparent: formatTraceparent(ctx) }, agent);
    await callApp('/page?n=2', {}, agent);
    agent.destroy();
    const second = await eventsFor((e) => e.handler === 'GET /page?n=2', 3);
    for (const e of second) expect(e.traceId).toBeUndefined();
    const first = await eventsFor((e) => e.handler === 'GET /page?n=1', 3);
    for (const e of first) expect(e.traceId).toBe(ctx.traceId);
  });

  it('ignores malformed traceparent headers', async () => {
    await callApp('/page?n=bad', { traceparent: '00-zzzz-yyyy-01' });
    const events = await eventsFor((e) => e.handler === 'GET /page?n=bad', 3);
    for (const e of events) expect(e.traceId).toBeUndefined();
  });

  it('returns the same handle when registered twice', () => {
    expect(register()).toBe(handle);
  });
});
