import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatTraceparent, newTraceContext, type ServerEventInput } from '@tracethrough/core';
import { startCollector, type Collector } from '@tracethrough/collector';
import { startFixtureServer, type FixtureServer } from '@tracethrough/fixtures';
import { register, type TraceThroughHandle } from '../src/index.ts';

/** Stand-in for Next.js's global request store (Symbol.for('@next/work-unit-async-storage@<version>')). */
const nextStorage = new AsyncLocalStorage<unknown>();
(globalThis as Record<symbol, unknown>)[Symbol.for('@next/work-unit-async-storage@99.0.0-test')] = nextStorage;

const requestStore = (traceparent: string | undefined, path = '/page', search = '') => ({
  type: 'request',
  headers: new Headers(traceparent ? { traceparent } : {}),
  url: { pathname: path, search },
});

describe('@tracethrough/next', () => {
  let collector: Collector;
  let upstream: FixtureServer;
  let handle: TraceThroughHandle;
  let app: Server;
  let appPort: number;
  const received: ServerEventInput[] = [];

  async function eventFor(path: string): Promise<ServerEventInput> {
    for (let i = 0; i < 100; i++) {
      await handle.flush();
      const found = [...new Map(received.map((e) => [e.id, e])).values()].find(
        (e) => e.urlSanitized.includes(path) && e.timing?.downloadMs !== undefined,
      );
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no event for ${path}`);
  }

  beforeAll(async () => {
    collector = await startCollector({ port: 0, onEvents: (e) => void received.push(...e) });
    upstream = await startFixtureServer();
    handle = register({ collectorUrl: collector.url, token: collector.token, flushIntervalMs: 10, logger: { warn: () => {} } })!;

    // A server whose handler runs "inside Next" with a store that may disagree with the raw request.
    app = createServer((req, res) => {
      const nextTrace = req.headers['x-next-traceparent'] as string | undefined;
      const call = () => fetch(`${upstream.url}${req.url}`).then((r) => r.text());
      const url = new URL(req.url!, 'http://app');
      const work = req.headers['x-in-next'] ? nextStorage.run(requestStore(nextTrace, url.pathname, url.search), call) : call();
      void work.then(() => res.end('ok'));
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

  const callApp = (path: string, headers: Record<string, string>) =>
    new Promise<void>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: appPort, path, headers }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end();
    });

  it('links work Next runs outside the original request context (dev compile case)', async () => {
    const ctx = newTraceContext();
    // No incoming HTTP request at all: only Next's store knows which request this is.
    await nextStorage.run(requestStore(formatTraceparent(ctx), '/products', '?page=2&token=abc'), () =>
      fetch(`${upstream.url}/api/ok?case=deferred`).then((r) => r.text()),
    );
    const e = await eventFor('case=deferred');
    expect(e.traceId).toBe(ctx.traceId);
    // Sent as captured; the TraceThrough app masks it only when the session has "Mask secrets" on.
    expect(e.handler).toBe('/products?page=2&token=abc');
  });

  it("prefers Next's store over the SDK's own context when they disagree", async () => {
    const outer = newTraceContext();
    const inner = newTraceContext();
    await callApp('/api/not-found?case=disagree', {
      traceparent: formatTraceparent(outer),
      'x-in-next': '1',
      'x-next-traceparent': formatTraceparent(inner),
    });
    const e = await eventFor('case=disagree');
    expect(e.traceId).toBe(inner.traceId);
    // Same request path, so the method-bearing label from the raw request is kept.
    expect(e.handler).toBe('GET /api/not-found?case=disagree');
  });

  it('never links when Next says the request had no trace context, even if ours did', async () => {
    await callApp('/api/error?case=none', { traceparent: formatTraceparent(newTraceContext()), 'x-in-next': '1' });
    expect((await eventFor('case=none')).traceId).toBeUndefined();
  });

  it('ignores non-request stores (prerender/cache) and falls back to its own tracking', async () => {
    const ctx = newTraceContext();
    await nextStorage.run({ type: 'prerender' }, () => callApp('/api/ok?case=prerender', { traceparent: formatTraceparent(ctx) }));
    expect((await eventFor('case=prerender')).traceId).toBe(ctx.traceId);
  });

  it('is a no-op on the Edge runtime', () => {
    const prev = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = 'edge';
    try {
      expect(register()).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = prev;
    }
  });
});
