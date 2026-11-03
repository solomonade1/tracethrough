import { Agent, createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MASK, formatTraceparent, newTraceContext, type ServerEventInput } from '@tracelens/core';
import { startCollector, type Collector } from '@tracelens/collector';
import { CANARY, startFixtureServer, type FixtureServer } from '@tracelens/fixtures';
import { register, type TraceLensHandle } from '../src/index.js';

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
    [{ collectorUrl: 'http://127.0.0.1:47811', token: 't' }, { TRACELENS_DISABLED: '1' }, /TRACELENS_DISABLED/],
  ])('stays off for %j with env %j', (opts, extraEnv, reason) => {
    process.env = { ...env, TRACELENS_COLLECTOR_URL: '', TRACELENS_TOKEN: '', ...extraEnv };
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
  let handle: TraceLensHandle;
  const received: ServerEventInput[] = [];

  /** Calls the instrumented app with node:http (not fetch) so the test client isn't itself observed. */
  function callApp(path: string, headers: Record<string, string> = {}, agent?: Agent) {
    return new Promise<void>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: appPort, path, headers, agent }, (res) => {
        res.resume();
        res.on('end', resolve);
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
      if (matches.length >= count && matches.every((e) => e.state !== 'pending' && e.timing?.downloadMs !== undefined || e.state === 'failed')) return matches;
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
          await fetch('http://tracelens-nope.invalid/x').catch(() => {});
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
      expect(e).toMatchObject({ state: 'complete', type: 'fetch', handler: `GET /page?session=${MASK}&q=1` });
      expect(e.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(e.responseBody?.unavailableReason).toBe('omitted-by-policy');
    }
    const byPath = Object.fromEntries(events.map((e) => [new URL(e.urlSanitized).pathname, e]));
    expect(byPath['/api/ok']!.status).toBe(200);
    expect(byPath['/api/not-found']!.status).toBe(404);
    expect(byPath['/api/error']!.status).toBe(500);
  });

  it('redacts before sending', () => {
    const ok = received.find((e) => e.urlSanitized.includes('/api/ok'))!;
    expect(ok.urlSanitized).toContain(`api_key=${MASK}`);
    expect(ok.requestHeadersSanitized?.authorization).toBe(`Bearer ${MASK}`);
    expect(JSON.stringify(received)).not.toContain(CANARY);
  });

  it('records failures with an error code', async () => {
    await callApp('/fail');
    const [failed] = await eventsFor((e) => e.domain === 'tracelens-nope.invalid');
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
