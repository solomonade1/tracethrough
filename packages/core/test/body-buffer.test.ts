import { describe, expect, it } from 'vitest';
import { MASK, NetworkEvent, SessionBuffer, buildBodyPreview, createRedactor } from '../src/index.ts';

const r = createRedactor();
const bytes = (s: string) => new TextEncoder().encode(s);

describe('buildBodyPreview', () => {
  it('redacts and keeps small JSON bodies whole', () => {
    const { body, redacted } = buildBodyPreview(bytes('{"token":"t","a":1}'), 'application/json; charset=utf-8', r);
    expect(redacted).toBe(true);
    expect(body).toEqual({ mime: 'application/json', sizeBytes: 19, preview: `{"token":"${MASK}","a":1}`, truncated: false });
  });

  it('truncates at the preview cap and flags it', () => {
    const big = JSON.stringify({ data: 'x'.repeat(5000) });
    const { body } = buildBodyPreview(bytes(big), 'application/json', r, { previewBytes: 100, maxParseBytes: 10_000 });
    expect(body.truncated).toBe(true);
    expect(body.preview).toHaveLength(100);
    expect(body.sizeBytes).toBe(big.length);
  });

  it('redacts oversize bodies via the text fallback', () => {
    const big = `{"password":"hunter2","data":"${'x'.repeat(5000)}"}`;
    const { body } = buildBodyPreview(bytes(big), 'application/json', r, { previewBytes: 200, maxParseBytes: 1000 });
    expect(body.truncated).toBe(true);
    expect(body.preview).not.toContain('hunter2');
  });

  it('marks binary, empty and multipart bodies with a reason instead of content', () => {
    expect(buildBodyPreview(new Uint8Array([0x89, 0x50, 0, 1]), 'image/png', r).body).toEqual({
      mime: 'image/png', sizeBytes: 4, truncated: false, unavailableReason: 'binary',
    });
    expect(buildBodyPreview(undefined, 'text/plain', r).body.unavailableReason).toBe('empty');
    expect(buildBodyPreview(bytes('--x\r\n'), 'multipart/form-data; boundary=x', r).body.unavailableReason).toBe(
      'omitted-by-policy',
    );
  });

  it('sniffs text when there is no content type', () => {
    expect(buildBodyPreview(bytes('hello'), undefined, r).body.preview).toBe('hello');
    expect(buildBodyPreview(new Uint8Array([104, 0, 105]), undefined, r).body.unavailableReason).toBe('binary');
  });
});

const ev = (id: string): NetworkEvent => ({
  id, sessionId: 's', source: 'browser', state: 'pending', timestamp: new Date(0).toISOString(),
  method: 'GET', urlSanitized: `https://x.test/${id}`, domain: 'x.test', isNavigation: false, redactionApplied: false,
});

describe('buildBodyPreview with masking off', () => {
  const off = createRedactor(false);
  const enc = (t: string) => new TextEncoder().encode(t);

  it('shows sensitive fields and textual multipart bodies', () => {
    expect(buildBodyPreview(enc('{"password":"p"}'), 'application/json', off).body.preview).toBe('{"password":"p"}');
    const form = ['--x', 'Content-Disposition: form-data; name="token"', '', 'abc', '--x--', ''].join('\r\n');
    expect(buildBodyPreview(enc(form), 'multipart/form-data; boundary=x', off).body).toMatchObject({ preview: form });
  });

  it('still reports binary multipart bodies instead of showing them', () => {
    const bytes = new Uint8Array([45, 45, 120, 0, 1, 2]);
    expect(buildBodyPreview(bytes, 'multipart/form-data; boundary=x', off).body.unavailableReason).toBe('binary');
  });
});

describe('SessionBuffer', () => {
  it('evicts the oldest exchange beyond capacity and counts drops', () => {
    const b = new SessionBuffer(2);
    b.upsert(ev('a'));
    b.upsert(ev('b'));
    b.upsert(ev('c'));
    expect(b.all().map((e) => e.id)).toEqual(['b', 'c']);
    expect(b.dropped).toBe(1);
  });

  it('updates in place without reordering or dropping', () => {
    const b = new SessionBuffer(2);
    b.upsert(ev('a'));
    b.upsert(ev('b'));
    b.upsert({ ...ev('a'), state: 'complete', status: 200 });
    expect(b.all().map((e) => [e.id, e.state])).toEqual([['a', 'complete'], ['b', 'pending']]);
    expect(b.dropped).toBe(0);
  });

  it('produces schema-valid events', () => {
    expect(NetworkEvent.parse(ev('a')).id).toBe('a');
  });
});
