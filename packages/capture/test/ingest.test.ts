import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANARY, startFixtureServer, type FixtureServer } from '@tracethrough/fixtures';
import { MASK, NetworkEvent, toHar, toSessionExport, type ServerEventInput } from '@tracethrough/core';
import { CaptureSession, toProtocol, type BrowserChannel } from '../src/index.ts';
import { Limiter } from '../src/limiter.ts';

const channel = process.env.TRACETHROUGH_BROWSER_CHANNEL as BrowserChannel | undefined;

const multipartText = (secret: string) =>
  ['--b', 'Content-Disposition: form-data; name="password"', '', secret, '--b--', ''].join('\r\n');

const serverEvent = (over: Partial<ServerEventInput>): ServerEventInput => ({
  id: 'e',
  state: 'complete',
  timestamp: new Date().toISOString(),
  method: 'POST',
  urlSanitized: 'https://upstream.test/upload',
  domain: 'upstream.test',
  status: 200,
  isNavigation: false,
  ...over,
});

describe('CaptureSession server multipart bodies (masking on)', () => {
  let server: FixtureServer;
  let session: CaptureSession;

  // Browsers are slow to stop (very slow on Windows when two run at once), so one session at a time.
  async function openSession(redaction?: false) {
    server = await startFixtureServer();
    session = await CaptureSession.start({ url: `${server.url}/blank`, headless: true, channel, redaction, maxBufferBytes: 40_000 });
  }
  async function closeSession() {
    await session?.stop();
    await server?.close();
  }

  beforeAll(() => openSession());
  afterAll(closeSession);

  const secret = 'hunter2-' + CANARY;
  const sdkBody = (mime: string | undefined, over: object = {}) => ({
    mime,
    sizeBytes: 4321,
    preview: multipartText(secret),
    truncated: false,
    ...over,
  });

  it.each([
    ['multipart/form-data', 'multipart/form-data'],
    ['multipart/form-data; boundary=b', 'multipart/form-data'],
    ['Multipart/Form-Data;Boundary="b"', 'multipart/form-data'],
  ])('a masked session drops a %s request and response preview from an unmasked SDK event', async (mime, normalized) => {
    const emitted: NetworkEvent[] = [];
    session.on('event', (e) => emitted.push(e));
    expect(
      session.ingestServerEvent(
        serverEvent({ id: 'mp', requestBody: sdkBody(mime), responseBody: sdkBody(mime, { sizeBytes: 99, truncated: true }) }),
      ),
    ).toBe(true);

    const e = session.buffer.get('server:mp')!;
    expect(e.requestBody).toEqual({ mime: normalized, sizeBytes: 4321, truncated: false, unavailableReason: 'omitted-by-policy' });
    expect(e.responseBody).toEqual({ mime: normalized, sizeBytes: 99, truncated: false, unavailableReason: 'omitted-by-policy' });
    expect(() => NetworkEvent.parse(e)).not.toThrow();

    // Nothing the session can hand out still has the password.
    const everything = [
      JSON.stringify(session.buffer.all()),
      JSON.stringify(emitted),
      JSON.stringify(toSessionExport(session.id, session.buffer.all(), 0, session.masking)),
      JSON.stringify(toHar(session.buffer.all(), '0', session.masking)),
    ];
    for (const out of everything) {
      expect(out).not.toContain('hunter2');
      expect(out).not.toContain(CANARY);
    }
  });

  it('recognises multipart from the Content-Type header when the body carries no MIME type', async () => {
    session.ingestServerEvent(
      serverEvent({
        id: 'hdr',
        requestHeadersSanitized: { 'Content-Type': 'multipart/form-data; boundary=b' },
        requestBody: sdkBody(undefined),
        responseHeadersSanitized: { 'content-type': 'multipart/mixed; boundary=b' },
        responseBody: sdkBody('text/plain'),
      }),
    );
    const e = session.buffer.get('server:hdr')!;
    expect(e.requestBody).toMatchObject({ mime: 'multipart/form-data', unavailableReason: 'omitted-by-policy' });
    expect(e.responseBody).toMatchObject({ mime: 'multipart/mixed', unavailableReason: 'omitted-by-policy' });
    expect(JSON.stringify(e)).not.toContain('hunter2');
  });

  it('still masks JSON and form-urlencoded server bodies as before', async () => {
    session.ingestServerEvent(
      serverEvent({
        id: 'json',
        requestBody: { mime: 'application/json', sizeBytes: 30, preview: JSON.stringify({ password: secret, a: 1 }), truncated: false },
        responseBody: { mime: 'application/x-www-form-urlencoded', sizeBytes: 30, preview: `password=${secret}&a=1`, truncated: false },
      }),
    );
    const e = session.buffer.get('server:json')!;
    expect(JSON.parse(e.requestBody!.preview!)).toEqual({ password: MASK, a: 1 });
    expect(e.responseBody!.preview).toBe(`password=${MASK}&a=1`);
  });

  it('applies the byte budget to ingested events and announces every eviction', async () => {
    const evicted: string[] = [];
    session.on('evicted', (id) => evicted.push(id));
    const before = session.buffer.dropped;
    for (let i = 0; i < 6; i++) {
      session.ingestServerEvent(
        serverEvent({
          id: `big${i}`,
          responseBody: { mime: 'text/plain', sizeBytes: 20_000, preview: 'x'.repeat(20_000), truncated: false },
        }),
      );
    }
    expect(session.buffer.bytes).toBeLessThanOrEqual(40_000);
    expect(session.buffer.get('server:big5')).toBeDefined();
    expect(session.buffer.get('server:big0')).toBeUndefined();
    // Anything gone from the buffer was announced, so a listener mirroring the stream stays in step.
    const retained = new Set(session.buffer.all().map((e) => e.id));
    for (const id of evicted) expect(retained.has(id)).toBe(false);
    expect(session.buffer.dropped - before).toBe(evicted.length);
  });
});

describe('CaptureSession server multipart bodies (masking off)', () => {
  let server: FixtureServer;
  let session: CaptureSession;
  const secret = 'hunter2-' + CANARY;

  beforeAll(async () => {
    server = await startFixtureServer();
    session = await CaptureSession.start({ url: `${server.url}/blank`, headless: true, channel, redaction: false });
  });
  afterAll(async () => {
    await session?.stop();
    await server?.close();
  });

  it('a session with masking off retains the supplied preview', async () => {
    const emitted: NetworkEvent[] = [];
    session.on('event', (e) => emitted.push(e));
    session.ingestServerEvent(
      serverEvent({
        id: 'raw',
        requestBody: { mime: 'multipart/form-data; boundary=b', sizeBytes: 4321, preview: multipartText(secret), truncated: false },
        responseBody: { mime: 'multipart/form-data; boundary=b', sizeBytes: 4321, preview: multipartText(secret), truncated: false },
      }),
    );
    const e = session.buffer.get('server:raw')!;
    expect(e.requestBody!.preview).toBe(multipartText(secret));
    expect(e.responseBody!.preview).toBe(multipartText(secret));
    expect(e.requestBody!.unavailableReason).toBeUndefined();
    expect(JSON.stringify(emitted)).toContain('hunter2');
    expect(JSON.stringify(toHar(session.buffer.all(), '0', false))).toContain('hunter2');
  });
});

describe('capture protocol', () => {
  it.each([
    ['HTTP/1.1', 'http/1.1'],
    ['http/1.0', 'http/1.0'],
    ['HTTP/2.0', 'h2'],
    ['h2', 'h2'],
    ['h3', 'h3'],
    ['HTTP/3.0', 'h3'],
    ['', undefined],
    [undefined, undefined],
    ['quic/46', undefined],
  ])('maps %j to %j', (reported, expected) => {
    expect(toProtocol(reported)).toBe(expected);
  });
});

describe('Limiter', () => {
  it('never runs more than the limit at once and keeps order', async () => {
    const limiter = new Limiter(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        limiter.run(async () => {
          order.push(i);
          peak = Math.max(peak, ++active);
          await new Promise((r) => setTimeout(r, 10));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('frees the slot when a task throws', async () => {
    const limiter = new Limiter(1);
    await expect(limiter.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
  });
});
