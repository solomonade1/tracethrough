import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRedactor } from '@tracethrough/core';
import { createBodyReader, readBounded } from '../src/bodies.ts';

const MAX = 1024;
const raw = createBodyReader(createRedactor(false), MAX);
const masked = createBodyReader(createRedactor(), MAX);

describe('readBounded', () => {
  it('stops after one byte beyond the budget and cancels an endless stream', async () => {
    let pulls = 0;
    const cancelled = vi.fn();
    const endless = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(100).fill(65));
        },
        cancel: cancelled,
      },
      { highWaterMark: 0 },
    );
    const { bytes, truncated } = await readBounded(endless, 250);
    expect(truncated).toBe(true);
    expect(bytes.byteLength).toBe(250);
    // 250 bytes need 3 chunks of 100; the third crosses the budget, so nothing more is requested.
    expect(pulls).toBe(3);
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());
  });

  it('does not wait for a producer that never settles its cancellation', async () => {
    const stuck = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(10));
      },
      cancel: () => new Promise(() => {}),
    });
    const { truncated } = await readBounded(stuck, 5);
    expect(truncated).toBe(true);
  });

  it('returns a short stream whole, untruncated', async () => {
    const { bytes, truncated } = await readBounded(new Response('hello').body!, 100);
    expect(new TextDecoder().decode(bytes)).toBe('hello');
    expect(truncated).toBe(false);
  });

  it('treats a body of exactly the budget as complete', async () => {
    const { bytes, truncated } = await readBounded(new Response('x'.repeat(100)).body!, 100);
    expect(bytes.byteLength).toBe(100);
    expect(truncated).toBe(false);
  });
});

describe('request bodies are previewed in bounded reads and never consumed', () => {
  let server: Server;
  let url: string;
  const received: { bytes: number; type: string | undefined }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let bytes = 0;
      req.on('data', (c: Buffer) => (bytes += c.length));
      req.on('end', () => {
        received.push({ bytes, type: req.headers['content-type'] });
        res.end(String(bytes));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  const BIG = 3 * 1024 * 1024;
  const big = 'a'.repeat(BIG);

  /** Previews `fetch(input, init)` the way the SDK does (before fetch starts), then really sends it. */
  async function previewAndSend(input: RequestInfo | URL, init?: RequestInit, reader = raw) {
    const before = received.length;
    const preview = reader.request(input, init);
    const sent = await (await fetch(input, init)).text();
    return { preview: await preview, sent: Number(sent), upstream: received.slice(before) };
  }

  it('a Request object: bounded preview, upstream still gets every byte', async () => {
    const { preview, sent } = await previewAndSend(new Request(url, { method: 'POST', body: big, headers: { 'content-type': 'text/plain' } }));
    expect(sent).toBe(BIG);
    expect(preview).toMatchObject({ mime: 'text/plain', truncated: true });
    expect(preview!.preview).toHaveLength(MAX);
  });

  it('a Blob: only the head is read, size is the real size', async () => {
    const blob = new Blob([big], { type: 'text/plain' });
    const slice = vi.spyOn(blob, 'slice');
    const arrayBuffer = vi.spyOn(blob, 'arrayBuffer');
    const { preview, sent } = await previewAndSend(url, { method: 'POST', body: blob });
    expect(sent).toBe(BIG);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(slice).toHaveBeenCalledWith(0, MAX);
    expect(preview).toMatchObject({ mime: 'text/plain', truncated: true, sizeBytes: BIG });
    expect(preview!.preview).toHaveLength(MAX);
  });

  it('a large string: bounded preview with the true byte size', async () => {
    const text = 'é'.repeat(BIG / 2);
    const { preview, sent } = await previewAndSend(url, { method: 'POST', body: text });
    expect(sent).toBe(Buffer.byteLength(text));
    expect(preview).toMatchObject({ truncated: true, sizeBytes: Buffer.byteLength(text) });
    expect(Buffer.byteLength(preview!.preview!)).toBeLessThanOrEqual(MAX);
  });

  it('serialized FormData: bounded preview of the multipart stream', async () => {
    const form = new FormData();
    form.append('note', 'hello');
    form.append('file', new Blob([big], { type: 'text/plain' }), 'big.txt');
    const { preview, sent } = await previewAndSend(url, { method: 'POST', body: form });
    expect(sent).toBeGreaterThan(BIG);
    expect(preview).toMatchObject({ mime: 'multipart/form-data', truncated: true });
    expect(preview!.preview).toContain('name="note"');
    expect(Buffer.byteLength(preview!.preview!)).toBeLessThanOrEqual(MAX);
  });

  it('multipart under masking is omitted without reading the form', async () => {
    const form = new FormData();
    form.append('password', 'hunter2');
    const { preview, sent } = await previewAndSend(url, { method: 'POST', body: form }, masked);
    expect(sent).toBeGreaterThan(0);
    expect(preview).toMatchObject({ unavailableReason: 'omitted-by-policy', mime: 'multipart/form-data' });
    expect(preview!.preview).toBeUndefined();
  });

  it('known binary bodies are not read at all', async () => {
    const blob = new Blob([big], { type: 'image/png' });
    const slice = vi.spyOn(blob, 'slice');
    const arrayBuffer = vi.spyOn(blob, 'arrayBuffer');
    const { preview, sent } = await previewAndSend(url, { method: 'POST', body: blob });
    expect(sent).toBe(BIG);
    expect(slice).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(preview).toEqual({ mime: 'image/png', sizeBytes: BIG, truncated: false, unavailableReason: 'binary' });

    const req = new Request(url, { method: 'POST', body: big, headers: { 'content-type': 'application/octet-stream', 'content-length': String(BIG) } });
    const clone = vi.spyOn(req, 'clone');
    expect(await raw.request(req, undefined)).toMatchObject({ unavailableReason: 'binary', sizeBytes: BIG });
    expect(clone).not.toHaveBeenCalled();
  });

  it('small bodies are previewed whole', async () => {
    const { preview } = await previewAndSend(url, { method: 'POST', body: JSON.stringify({ a: 1 }), headers: { 'content-type': 'application/json' } });
    expect(preview).toEqual({ mime: 'application/json', sizeBytes: 7, preview: '{"a":1}', truncated: false });
  });

  it('keeps a body of exactly the budget untruncated', async () => {
    const { preview } = await previewAndSend(url, { method: 'POST', body: 'b'.repeat(MAX) });
    expect(preview).toMatchObject({ truncated: false, sizeBytes: MAX });
  });
});

describe('response bodies', () => {
  it('a large response is previewed from a clone; the caller still reads all of it', async () => {
    const size = 4 * 1024 * 1024;
    const res = new Response('z'.repeat(size), { headers: { 'content-type': 'text/plain' } });
    const preview = await raw.response(res);
    expect(preview).toMatchObject({ mime: 'text/plain', truncated: true });
    expect(preview.preview).toHaveLength(MAX);
    expect((await res.text()).length).toBe(size);
  });

  it('skips binary and event-stream responses without cloning', async () => {
    const png = new Response('x'.repeat(10), { headers: { 'content-type': 'image/png', 'content-length': '10' } });
    const clone = vi.spyOn(png, 'clone');
    expect(await raw.response(png)).toMatchObject({ unavailableReason: 'binary', sizeBytes: 10 });
    expect(clone).not.toHaveBeenCalled();

    const sse = new Response('data: 1\n\n', { headers: { 'content-type': 'text/event-stream' } });
    expect(await raw.response(sse)).toMatchObject({ unavailableReason: 'streamed' });
  });

  it('a multipart response is omitted under masking and kept when masking is off', async () => {
    const make = () => new Response('--b\r\nContent-Disposition: form-data; name="password"\r\n\r\nhunter2\r\n--b--', {
      headers: { 'content-type': 'multipart/form-data; boundary=b' },
    });
    const omitted = await masked.response(make());
    expect(omitted).toMatchObject({ unavailableReason: 'omitted-by-policy', mime: 'multipart/form-data' });
    expect(JSON.stringify(omitted)).not.toContain('hunter2');
    expect((await raw.response(make())).preview).toContain('hunter2');
  });
});
