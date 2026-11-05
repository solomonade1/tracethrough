import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_REDACTION_POLICY, MASK, type ServerEventInput } from '@tracethrough/core';
import { startCollector, type Collector } from '@tracethrough/collector';
import { CANARY, startFixtureServer, type FixtureServer } from '@tracethrough/fixtures';
import { register, type TraceThroughHandle, type TraceThroughNodeOptions } from '../src/index.ts';

const silent = { warn: () => {} };

/** SDK options that are off by default: masking in the SDK, and turning body capture off. */
describe('App Connect Node SDK options', () => {
  let collector: Collector;
  let upstream: FixtureServer;
  let app: Server;
  let appPort: number;
  let handle: TraceThroughHandle | undefined;
  const received: ServerEventInput[] = [];
  const nativeFetch = globalThis.fetch;

  function start(opts: TraceThroughNodeOptions) {
    received.length = 0;
    handle = register({ collectorUrl: collector.url, token: collector.token, flushIntervalMs: 10, logger: silent, ...opts });
  }

  function callApp(path: string) {
    return new Promise<void>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: appPort, path }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end();
    });
  }

  async function eventFor(pred: (e: ServerEventInput) => boolean): Promise<ServerEventInput> {
    for (let i = 0; i < 50; i++) {
      await handle!.flush();
      const latest = [...new Map(received.map((e) => [e.id, e])).values()];
      const match = latest.find((e) => pred(e) && e.timing?.downloadMs !== undefined && e.responseBody !== undefined);
      if (match) return match;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timed out waiting for server events');
  }

  beforeAll(async () => {
    collector = await startCollector({ port: 0, onEvents: (events) => void received.push(...events) });
    upstream = await startFixtureServer();
    app = createServer(async (_req, res) => {
      await (
        await fetch(`${upstream.url}/api/echo?api_key=${CANARY}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${CANARY}` },
          body: JSON.stringify({ username: 'ada', password: CANARY }),
        })
      ).text();
      res.end('ok');
    });
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    appPort = (app.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await handle?.shutdown();
    handle = undefined;
  });

  afterAll(async () => {
    app?.close();
    await upstream?.close();
    await collector?.close();
  });

  it('masks in the SDK when given a redaction policy', async () => {
    start({ redaction: DEFAULT_REDACTION_POLICY });
    await callApp('/');
    const e = await eventFor((x) => x.urlSanitized.includes('/api/echo'));
    expect(e.urlSanitized).toContain(`api_key=${MASK}`);
    expect(e.requestHeadersSanitized?.authorization).toBe(`Bearer ${MASK}`);
    expect(JSON.parse(e.requestBody!.preview!)).toEqual({ username: 'ada', password: MASK });
    expect(e.redactionApplied).toBe(true);
    expect(JSON.stringify(received)).not.toContain(CANARY);
  });

  it('sends no bodies when body capture is off, and leaves fetch untouched', async () => {
    start({ captureBodies: false });
    expect(globalThis.fetch).toBe(nativeFetch);
    await callApp('/');
    const e = await eventFor((x) => x.urlSanitized.includes('/api/echo'));
    expect(e.requestBody).toBeUndefined();
    expect(e.responseBody?.unavailableReason).toBe('omitted-by-policy');
  });

  it('restores the original fetch on shutdown', async () => {
    start({});
    expect(globalThis.fetch).not.toBe(nativeFetch);
    await handle!.shutdown();
    handle = undefined;
    expect(globalThis.fetch).toBe(nativeFetch);
  });
});
