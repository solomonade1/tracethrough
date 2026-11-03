import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MASK, NetworkEvent } from '@tracelens/core';
import { CANARY, startFixtureServer, type FixtureServer } from '@tracelens/fixtures';
import { CaptureSession, InvalidTargetUrlError, validateTargetUrl, type BrowserChannel } from '../src/index.js';

const channel = process.env.TRACELENS_BROWSER_CHANNEL as BrowserChannel | undefined;
const PREVIEW_BYTES = 64 * 1024;

function waitForEvent(session: CaptureSession, pred: (e: NetworkEvent) => boolean, timeoutMs = 10_000) {
  const existing = session.buffer.all().find(pred);
  if (existing) return Promise.resolve(existing);
  return new Promise<NetworkEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.off('event', on);
      reject(new Error('Timed out waiting for event'));
    }, timeoutMs);
    const on = (e: NetworkEvent) => {
      if (!pred(e)) return;
      clearTimeout(timer);
      session.off('event', on);
      resolve(e);
    };
    session.on('event', on);
  });
}

const pathOf = (e: NetworkEvent) => new URL(e.urlSanitized).pathname;

describe('validateTargetUrl', () => {
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.test', 'not a url', ''])('rejects %j', (u) => {
    expect(() => validateTargetUrl(u)).toThrow(InvalidTargetUrlError);
  });
  it('accepts http(s)', () => {
    expect(validateTargetUrl(' https://example.com/a ').href).toBe('https://example.com/a');
  });
});

describe('CaptureSession against fixture site', () => {
  let server: FixtureServer;
  let session: CaptureSession;
  let events: NetworkEvent[];
  const byPath = (p: string) => events.filter((e) => pathOf(e) === p);

  beforeAll(async () => {
    server = await startFixtureServer();
    session = await CaptureSession.start({
      url: `${server.url}/basic`,
      headless: true,
      channel,
      bodyLimits: { previewBytes: PREVIEW_BYTES, maxParseBytes: 2 * 1024 * 1024 },
    });
    await session.page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true);
    await session.settled();
    events = session.buffer.all();
  });

  afterAll(async () => {
    await session?.stop();
    await server?.close();
  });

  it('records the document navigation and groups subrequests under it', () => {
    const [doc] = byPath('/basic');
    expect(doc).toMatchObject({ type: 'document', isNavigation: true, status: 200, state: 'complete', source: 'browser' });
    expect(doc!.navigationId).toBeTruthy();
    for (const e of byPath('/api/not-found')) expect(e.navigationId).toBe(doc!.navigationId);
  });

  it('captures status codes and request types', () => {
    expect(byPath('/api/not-found')[0]).toMatchObject({ status: 404, type: 'fetch', method: 'GET' });
    expect(byPath('/api/error')[0]).toMatchObject({ status: 500 });
    expect(byPath('/api/slow')[0]).toMatchObject({ status: 200, type: 'xhr' });
    expect(byPath('/api/binary')[0]).toMatchObject({ type: 'asset', resourceType: 'image' });
  });

  it('links redirect chains hop by hop', () => {
    const [a] = byPath('/redirect/a');
    const [b] = byPath('/redirect/b');
    expect(a).toMatchObject({ status: 302, responseBody: { unavailableReason: 'redirect' } });
    expect(b).toMatchObject({ status: 301, redirectedFromId: a!.id });
    const final = byPath('/api/ok').find((e) => e.redirectedFromId === b!.id);
    expect(final).toMatchObject({ status: 200 });
  });

  it('redacts query params, headers and bodies but keeps non-secret content', () => {
    const ok = byPath('/api/ok').find((e) => e.urlSanitized.includes('api_key'))!;
    expect(ok.urlSanitized).toContain(`api_key=${MASK}&page=1`);
    expect(ok.redactionApplied).toBe(true);
    const body = JSON.parse(ok.responseBody!.preview!);
    expect(body).toMatchObject({ accessToken: MASK, user: { name: 'Ada' } });

    const [echo] = byPath('/api/echo');
    expect(echo!.method).toBe('POST');
    expect(echo!.requestHeadersSanitized!['authorization']).toBe(`Bearer ${MASK}`);
    expect(JSON.parse(echo!.requestBody!.preview!)).toEqual({ username: 'ada', password: MASK });
    expect(JSON.parse(echo!.responseBody!.preview!).echo).toEqual({ username: 'ada', password: MASK });

    const [cookie] = byPath('/api/set-cookie');
    expect(cookie!.responseHeadersSanitized!['set-cookie']).toContain(`sid=${MASK}`);
  });

  it('marks large and binary bodies instead of inventing content', () => {
    const [large] = byPath('/api/large');
    expect(large!.responseBody).toMatchObject({ truncated: true, mime: 'application/json' });
    expect(large!.responseBody!.sizeBytes!).toBeGreaterThan(PREVIEW_BYTES);
    expect(Buffer.byteLength(large!.responseBody!.preview!)).toBeLessThanOrEqual(PREVIEW_BYTES);

    expect(byPath('/api/binary')[0]!.responseBody).toMatchObject({ unavailableReason: 'binary', mime: 'image/png' });
  });

  it('records timing', () => {
    const [slow] = byPath('/api/slow');
    expect(slow!.durationMs!).toBeGreaterThanOrEqual(140);
    expect(slow!.timing?.ttfbMs).toBeDefined();
  });

  it('never stores the canary secret anywhere in the session (US-04)', () => {
    expect(JSON.stringify(session.buffer.all())).not.toContain(CANARY);
  });

  it('emits only schema-valid, browser-sourced events (CAP-03)', () => {
    for (const e of events) {
      expect(() => NetworkEvent.parse(e)).not.toThrow();
      expect(e.source).toBe('browser');
    }
  });

  it('captures DNS failures with a readable reason (ERR-01)', async () => {
    await session.page.evaluate(() => fetch('http://tracelens-does-not-exist.invalid/x').catch(() => {}));
    const failed = await waitForEvent(session, (e) => e.domain === 'tracelens-does-not-exist.invalid' && e.state !== 'pending');
    expect(failed.state).toBe('failed');
    expect(failed.error?.code).toMatch(/ERR_/);
  });

  it('captures aborted requests', async () => {
    await session.page.evaluate(async () => {
      const ac = new AbortController();
      const p = fetch('/api/hang', { signal: ac.signal }).catch(() => {});
      setTimeout(() => ac.abort(), 50);
      await p;
    });
    const aborted = await waitForEvent(session, (e) => pathOf(e) === '/api/hang' && e.state !== 'pending');
    expect(aborted).toMatchObject({ state: 'failed', error: { code: 'net::ERR_ABORTED' } });
  });
});

describe('CaptureSession App Connect', () => {
  let owned: FixtureServer;
  let thirdParty: FixtureServer;
  let session: CaptureSession;

  beforeAll(async () => {
    owned = await startFixtureServer();
    thirdParty = await startFixtureServer();
    session = await CaptureSession.start({ url: `${owned.url}/blank`, headless: true, channel, connectedOrigin: owned.url });
  });
  afterAll(async () => {
    await session?.stop();
    await owned?.close();
    await thirdParty?.close();
  });

  it('adds traceparent only to the connected origin and records the same trace id', async () => {
    const seen = await session.page.evaluate(
      async ([own, other]) => {
        await fetch(`${own}/api/set-cookie`);
        const a = await (await fetch(`${own}/api/headers`)).json();
        const b = await (await fetch(`${other}/api/headers`)).json();
        return { own: a, other: b };
      },
      [owned.url, thirdParty.url],
    );
    await session.settled();

    expect(seen.other.traceparent).toBeNull();
    expect(seen.own.hasCookie).toBe(true);
    const [, traceId, spanId] = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/.exec(seen.own.traceparent)!;

    const events = session.buffer.all().filter((e) => pathOf(e) === '/api/headers');
    const ownEvent = events.find((e) => e.urlSanitized.startsWith(owned.url))!;
    const otherEvent = events.find((e) => e.urlSanitized.startsWith(thirdParty.url))!;
    expect(ownEvent).toMatchObject({ traceId, spanId });
    expect(otherEvent.traceId).toBeUndefined();
  });

  it('ingests server events as untrusted input', () => {
    const ok = session.ingestServerEvent({
      id: 'abc',
      state: 'complete',
      timestamp: new Date().toISOString(),
      method: 'GET',
      urlSanitized: `https://upstream.test/x?token=${CANARY}`,
      domain: 'spoofed.test',
      status: 200,
      isNavigation: true,
      handler: `GET /page?api_key=${CANARY}`,
      requestHeadersSanitized: { authorization: `Bearer ${CANARY}` },
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    });
    expect(ok).toBe(true);
    const e = session.buffer.get('server:abc')!;
    expect(e).toMatchObject({
      source: 'server',
      sessionId: session.id,
      domain: 'upstream.test',
      isNavigation: false,
      urlSanitized: `https://upstream.test/x?token=${MASK}`,
      handler: `GET /page?api_key=${MASK}`,
      requestHeadersSanitized: { authorization: `Bearer ${MASK}` },
      redactionApplied: true,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    });
    expect(() => NetworkEvent.parse(e)).not.toThrow();
    expect(JSON.stringify(session.buffer.all())).not.toContain(CANARY);
  });
});

describe('CaptureSession limits', () => {
  it('drops oldest exchanges beyond maxEvents and counts them', async () => {
    const server = await startFixtureServer();
    const session = await CaptureSession.start({ url: `${server.url}/basic`, headless: true, channel, maxEvents: 3 });
    try {
      await session.page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true);
      await session.settled();
      expect(session.buffer.size).toBe(3);
      expect(session.buffer.dropped).toBeGreaterThan(0);
    } finally {
      await session.stop();
      await server.close();
    }
  });
});
