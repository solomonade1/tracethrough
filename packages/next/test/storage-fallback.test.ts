import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTraceparent, newTraceContext, type ServerEventInput } from '@tracethrough/core';
import { startCollector } from '@tracethrough/collector';

/**
 * The adapter reads a private Next.js global. These tests change or remove it and check that the
 * adapter reports "no request" instead of throwing, and that the SDK still links by itself.
 */
const PREFIX = '@next/work-unit-async-storage@';
const g = globalThis as Record<symbol, unknown>;
const planted: symbol[] = [];

function plant(version: string, value: unknown) {
  const sym = Symbol.for(`${PREFIX}${version}`);
  g[sym] = value;
  planted.push(sym);
}

/** A fresh copy of the adapter, because it caches the storage it finds. */
async function freshAdapter() {
  vi.resetModules();
  return import('../src/index.ts');
}

beforeEach(() => {
  // Other versions of the global may exist in this process; start from none.
  for (const sym of Object.getOwnPropertySymbols(g)) if (sym.description?.startsWith(PREFIX)) delete g[sym];
});
afterEach(() => {
  for (const sym of planted.splice(0)) delete g[sym];
});

describe('nextRequestContext when Next.js internals are missing or changed', () => {
  it('returns undefined when the storage does not exist (an older or newer Next.js)', async () => {
    const { nextRequestContext } = await freshAdapter();
    expect(nextRequestContext()).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an object without getStore', { run() {} }],
    ['getStore that is not a function', { getStore: 42 }],
  ])('ignores a storage that is %s', async (_label, value) => {
    plant('99.0.0-test', value);
    const { nextRequestContext } = await freshAdapter();
    expect(nextRequestContext()).toBeUndefined();
  });

  it('survives getStore() throwing', async () => {
    plant('99.0.0-test', {
      getStore() {
        throw new Error('internal change');
      },
    });
    const { nextRequestContext } = await freshAdapter();
    expect(() => nextRequestContext()).not.toThrow();
    expect(nextRequestContext()).toBeUndefined();
  });

  it.each([
    ['no store active', undefined],
    ['a prerender store', { type: 'prerender' }],
    ['a cache store', { type: 'cache', headers: new Headers({ traceparent: formatTraceparent(newTraceContext()) }) }],
    ['a request store without headers', { type: 'request' }],
    ['headers that are not a Headers object', { type: 'request', headers: { traceparent: 'x' } }],
    ['headers whose get() throws', { type: 'request', headers: { get: () => { throw new Error('moved'); } } }],
  ])('treats %s as "no request"', async (_label, store) => {
    plant('99.0.0-test', { getStore: () => store });
    const { nextRequestContext } = await freshAdapter();
    expect(nextRequestContext()).toBeUndefined();
  });

  it('copes with a request store whose url changed shape', async () => {
    const traceparent = formatTraceparent(newTraceContext());
    const headers = new Headers({ traceparent });
    for (const url of [undefined, null, 'https://x.test/a?b=1', { pathname: 42 }, { pathname: '/ok' }]) {
      plant('99.0.0-test', { getStore: () => ({ type: 'request', headers, url }) });
      const { nextRequestContext } = await freshAdapter();
      const ctx = nextRequestContext();
      expect(ctx?.traceparent).toBe(traceparent);
      expect(ctx?.path === undefined || typeof ctx.path === 'string').toBe(true);
    }
    // A string url (a different shape) has no pathname, so no path is claimed.
    plant('99.0.0-test', { getStore: () => ({ type: 'request', headers, url: 'https://x.test/a?b=1' }) });
    expect((await (await freshAdapter()).nextRequestContext())?.path).toBeUndefined();
  });

  it('reads the current shape: a request store with headers and url', async () => {
    const ctx = newTraceContext();
    plant('16.4.4', {
      getStore: () => ({ type: 'request', headers: new Headers({ traceparent: formatTraceparent(ctx) }), url: { pathname: '/p', search: '?q=1' } }),
    });
    const { nextRequestContext } = await freshAdapter();
    expect(nextRequestContext()).toEqual({ traceparent: formatTraceparent(ctx), path: '/p?q=1' });
  });
});

describe('the host application is unaffected by a broken Next.js storage', () => {
  let app: Server | undefined;
  afterEach(async () => {
    app?.closeAllConnections();
    await new Promise((r) => app?.close(r));
    app = undefined;
  });

  it('keeps serving requests and links with the SDK’s own tracking', async () => {
    plant('99.0.0-test', {
      getStore() {
        throw new Error('the internals changed');
      },
    });
    const received: ServerEventInput[] = [];
    const collector = await startCollector({ port: 0, onEvents: (e) => void received.push(...e) });
    const upstream = createServer((_req, res) => res.end('{"ok":true}'));
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const { register } = await freshAdapter();
    const handle = register({ collectorUrl: collector.url, token: collector.token, flushIntervalMs: 10, logger: { warn: () => {} } })!;
    try {
      app = createServer(async (_req, res) => {
        await (await fetch(`http://127.0.0.1:${upstreamPort}/data`)).text();
        res.end('rendered');
      });
      await new Promise<void>((r) => app!.listen(0, '127.0.0.1', r));
      const trace = newTraceContext();
      const body = await new Promise<string>((resolve, reject) => {
        const req = request(
          { host: '127.0.0.1', port: (app!.address() as AddressInfo).port, path: '/page', headers: { traceparent: formatTraceparent(trace) } },
          (res) => {
            let text = '';
            res.on('data', (c: Buffer) => (text += c));
            res.on('end', () => resolve(text));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(body).toBe('rendered');
      await handle.flush();
      const call = received.find((e) => e.urlSanitized.endsWith('/data'));
      expect(call, JSON.stringify({ n: received.length, enabled: handle.enabled, why: handle.disabledReason, urls: received.map((e) => e.urlSanitized), dropped: handle.dropped, stats: collector.stats, url: collector.url })).toBeDefined();
      // The adapter found nothing usable, so the SDK's own request tracking supplied the link.
      expect(call?.traceId).toBe(trace.traceId);
      expect(handle.enabled).toBe(true);
    } finally {
      await handle.shutdown();
      upstream.closeAllConnections();
      await new Promise((r) => upstream.close(r));
      await collector.close();
    }
  });
});
