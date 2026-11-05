import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CaptureSession, type BrowserChannel } from '@tracethrough/capture';
import { startCollector, type Collector } from '@tracethrough/collector';
import type { NetworkEvent, ServerEventInput } from '@tracethrough/core';
// The SDK is not a dependency of the desktop app; the test drives it from source, as a user's server would.
import { register, type TraceThroughHandle } from '../../../packages/node/src/index.ts';
import { SessionHost } from '../src/main/session-host';
import { IPC, type EventBatch } from '../src/shared/api';

const channel = process.env.TRACETHROUGH_BROWSER_CHANNEL as BrowserChannel | undefined;
// Browsers can be slow to start and stop, especially on Windows.
const SLOW = 300_000;

const probe = (id: string, over: Partial<ServerEventInput> = {}): ServerEventInput => ({
  id,
  state: 'complete',
  timestamp: new Date().toISOString(),
  method: 'GET',
  urlSanitized: `https://upstream.test/${id}`,
  domain: 'upstream.test',
  status: 200,
  isNavigation: false,
  ...over,
});

/** Mirrors what the renderer's store does with the batches it is sent. */
function rendererMirror() {
  const events = new Map<string, NetworkEvent>();
  const sent: unknown[] = [];
  const send = (ch: string, payload: unknown) => {
    sent.push([ch, payload]);
    if (ch !== IPC.events) return;
    const { upserts, removed } = payload as EventBatch;
    for (const id of removed) events.delete(id);
    for (const e of upserts) events.set(e.id, e);
  };
  return { events, send };
}

describe('SessionHost with App Connect (real browser, real SDK, real collector)', () => {
  let collector: Collector;
  let upstream: Server;
  let upstreamUrl: string;
  let app: Server;
  let appUrl: string;
  let handle: TraceThroughHandle;
  let host: SessionHost;
  const mirror = rendererMirror();

  /** Set by tests: while set, every GET / waits for it before sending the document headers. */
  let holdDocument: Promise<void> | undefined;
  let release: () => void = () => {};
  const documentRequests: ServerResponse[] = [];
  const ingestedWhileStarting: boolean[] = [];

  beforeAll(async () => {
    collector = await startCollector({
      port: 0,
      onEvents: (events) => {
        ingestedWhileStarting.push(host.status.state === 'starting');
        host.ingest(events);
      },
    });
    upstream = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    // A long interval, so nothing leaves the SDK except by an explicit flush().
    handle = register({ collectorUrl: collector.url, token: collector.token, flushIntervalMs: 60_000, logger: { warn: () => {} } });
    expect(handle.enabled).toBe(true);

    app = createServer(async (req, res) => {
      if (req.url === '/favicon.ico') return void res.writeHead(404).end();
      documentRequests.push(res);
      // Server-side rendering: call the upstream API, then deliver the SDK's report of that call...
      await (await fetch(`${upstreamUrl}/api/ssr`)).text();
      await handle.flush();
      // ...and only then let the document response start.
      await holdDocument;
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>ssr</title><p>rendered</p>');
    });
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;

    host = new SessionHost(mirror.send, { headless: true, channel, flushIntervalMs: 10, maxBufferBytes: 300_000 });
  });

  afterAll(async () => {
    release();
    await host?.dispose();
    await handle?.shutdown();
    app?.closeAllConnections();
    upstream?.closeAllConnections();
    await Promise.all([new Promise((r) => app?.close(r)), new Promise((r) => upstream?.close(r)), collector?.close()]);
  });

  it('ignores server events while there is no session, and never replays them into a later one', () => {
    expect(host.ingest([probe('before-any-session')])).toBe(0);
  });

  it(
    'keeps an upstream call made while the first document is still being served, and links it to that navigation',
    async () => {
      // The document's headers are withheld until the SDK has flushed the SSR call, so the event
      // can only arrive while the initial navigation is still in progress. No timing involved.
      const result = await host.start(`${appUrl}/`, { connect: true, mask: true });
      expect(result).toEqual({ ok: true });
      expect(ingestedWhileStarting).toContain(true);

      const events = host.snapshot().upserts;
      const doc = events.find((e) => e.source === 'browser' && e.isNavigation)!;
      const upstreamCall = events.find((e) => e.source === 'server' && e.urlSanitized.endsWith('/api/ssr'))!;
      expect(doc).toBeDefined();
      expect(upstreamCall).toBeDefined();
      expect(doc.traceId).toBeTruthy();
      expect(upstreamCall.traceId).toBe(doc.traceId);
      expect(upstreamCall.handler).toBe('GET /');
      expect(upstreamCall).toMatchObject({ source: 'server', state: 'complete', status: 200 });

      // The first batch to the renderer already has it, so no later update was needed to show it.
      await vi.waitFor(() => expect([...mirror.events.values()].some((e) => e.id === upstreamCall.id)).toBe(true));
      expect(host.snapshot().upserts.some((e) => e.id === 'server:before-any-session')).toBe(false);
      expect(host.status.state).toBe('recording');
    },
    SLOW,
  );

  it(
    'keeps the renderer, buffer and export in step when the retention budget evicts events',
    async () => {
      // Same recording session as the previous test (browsers are slow to stop, so sessions are reused).
      expect(host.status.state).toBe('recording');
      const big = (id: string): ServerEventInput =>
        probe(id, { responseBody: { mime: 'text/plain', sizeBytes: 100_000, preview: 'y'.repeat(100_000), truncated: false } });
      for (let i = 0; i < 8; i++) expect(host.ingest([big(`big-${i}`)])).toBe(1);
      await vi.waitFor(() => expect(mirror.events.has('server:big-7')).toBe(true));

      const retained = host.snapshot().upserts.map((e) => e.id).sort();
      // 300 KB holds about two of these previews: the oldest ones, and the page's own events, are gone.
      expect(retained.filter((id) => id.startsWith('server:big-')).length).toBeLessThan(8);
      expect(retained).toContain('server:big-7');
      expect(retained).not.toContain('server:big-0');
      await vi.waitFor(() => expect([...mirror.events.keys()].sort()).toEqual(retained));

      const exported = (format: 'json' | 'har') => host.exportData(format)!;
      expect(JSON.parse(exported('json')).events.map((e: NetworkEvent) => e.id).sort()).toEqual(retained);
      expect(JSON.parse(exported('har')).log.entries).toHaveLength(retained.length);
      expect(JSON.parse(exported('json')).droppedEvents).toBeGreaterThan(0);

      // clear() empties the buffer; the renderer is told through the next state it applies.
      host.clear();
      expect(host.snapshot().upserts).toEqual([]);
      expect(host.exportData('json')).toBeUndefined();
    },
    SLOW,
  );

  it('keeps ignoring server events after the session stops', async () => {
    await host.stop();
    expect(host.ingest([probe('after-stop')])).toBe(0);
  }, SLOW);

  it(
    'a stop during startup is final: the late navigation does not revive the session',
    async () => {
      let open!: () => void;
      holdDocument = new Promise<void>((r) => (open = r));
      release = open;
      const starting = host.start(`${appUrl}/`, { connect: true, mask: true });
      // The session is adopted before it navigates: events are accepted while the document is held back.
      await vi.waitFor(() => expect(host.ingest([probe('during-start')])).toBe(1), { timeout: 60_000 });
      expect(host.status.state).toBe('starting');

      await host.stop();
      open();
      const result = await starting;
      expect(result.ok).toBe(false);
      expect(host.status.state).toBe('stopped');
      expect(host.ingest([probe('after-late-start')])).toBe(0);
      holdDocument = undefined;
    },
    SLOW,
  );

  it(
    'a startup that fails leaves no browser running and no session behind',
    async () => {
      let created: CaptureSession | undefined;
      const create = CaptureSession.create.bind(CaptureSession);
      vi.spyOn(CaptureSession, 'create').mockImplementationOnce(async (opts) => (created = await create(opts)));
      vi.spyOn(CaptureSession.prototype, 'navigate').mockRejectedValueOnce(new Error('navigation could not start'));

      const result = await host.start(`${appUrl}/`, { connect: true, mask: true });
      expect(result).toEqual({ ok: false, error: 'navigation could not start' });
      expect(host.status).toMatchObject({ state: 'idle', error: 'navigation could not start' });
      expect(created).toBeDefined();
      expect(created!.closed).toBe(true);
      expect(created!.page.context().browser()?.isConnected()).toBeFalsy();
      expect(host.ingest([probe('after-failed-start')])).toBe(0);
      expect(host.snapshot().upserts).toEqual([]);
      vi.restoreAllMocks();
    },
    SLOW,
  );
});
