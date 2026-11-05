import { describe, expect, it } from 'vitest';
import {
  MASK,
  NetworkEvent,
  SessionBuffer,
  applyBodyPolicy,
  buildBodyPreview,
  createRedactor,
  estimateEventBytes,
  type BodyPreview,
} from '../src/index.ts';

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

describe('applyBodyPolicy', () => {
  const multipart: BodyPreview = {
    mime: 'multipart/form-data',
    sizeBytes: 321,
    preview: ['--b', 'Content-Disposition: form-data; name="password"', '', 'hunter2', '--b--'].join('\r\n'),
    truncated: true,
  };

  it('drops a multipart preview when masking, keeping the MIME type and known size', () => {
    expect(applyBodyPolicy(multipart, r)).toEqual({
      mime: 'multipart/form-data',
      sizeBytes: 321,
      truncated: false,
      unavailableReason: 'omitted-by-policy',
    });
  });

  it.each(['multipart/form-data; boundary=----x', 'Multipart/Mixed;boundary="a b"', ' multipart/related ; boundary=x'])(
    'recognises %j from the header when the body claims another MIME',
    (header) => {
      const out = applyBodyPolicy({ ...multipart, mime: 'text/plain' }, r, header)!;
      expect(out.unavailableReason).toBe('omitted-by-policy');
      expect(out.preview).toBeUndefined();
      expect(out.mime).toMatch(/^multipart\//);
    },
  );

  it('recognises a MIME that still carries boundary parameters', () => {
    const out = applyBodyPolicy({ ...multipart, mime: 'multipart/form-data; boundary=zzz' }, r)!;
    expect(out).toMatchObject({ mime: 'multipart/form-data', unavailableReason: 'omitted-by-policy' });
  });

  it('leaves multipart alone when masking is off', () => {
    expect(applyBodyPolicy(multipart, createRedactor(false), 'multipart/form-data; boundary=b')).toBe(multipart);
  });

  it('leaves other bodies, empty bodies and missing bodies alone', () => {
    const json: BodyPreview = { mime: 'application/json', sizeBytes: 2, preview: '{}', truncated: false };
    expect(applyBodyPolicy(json, r, 'application/json')).toBe(json);
    expect(applyBodyPolicy(undefined, r)).toBeUndefined();
    const empty: BodyPreview = { mime: 'multipart/form-data', sizeBytes: 0, truncated: false, unavailableReason: 'empty' };
    expect(applyBodyPolicy(empty, r)).toBe(empty);
  });
});

describe('SessionBuffer byte budget', () => {
  const withBody = (id: string, previewChars: number): NetworkEvent => ({
    ...ev(id),
    responseBody: { mime: 'text/plain', preview: 'x'.repeat(previewChars), truncated: false },
  });
  /** Estimated bytes of an event whose preview has this many characters. */
  const cost = (previewChars: number) => estimateEventBytes(withBody('a', previewChars));
  /** An event costing exactly `bytes` estimated bytes. */
  const sized = (id: string, bytes: number) => withBody(id, bytes - cost(0));
  const E = 4000;

  it('estimates bigger events as bigger', () => {
    expect(cost(10_000)).toBeGreaterThan(cost(100) + 9_000);
    expect(estimateEventBytes(sized('a', E))).toBe(E);
  });

  it('evicts several oldest events at once until the budget holds', () => {
    const b = new SessionBuffer(100, 3 * E);
    expect(b.upsert(sized('a', E))).toEqual([]);
    b.upsert(sized('b', E));
    b.upsert(sized('c', E));
    // One event nearly the size of the whole budget: everything older has to go.
    expect(b.upsert(sized('d', 3 * E - 1))).toEqual(['a', 'b', 'c']);
    expect(b.all().map((e) => e.id)).toEqual(['d']);
    expect(b.dropped).toBe(3);
    expect(b.bytes).toBeLessThanOrEqual(b.maxBytes);
  });

  it('evicts only as many as needed', () => {
    const b = new SessionBuffer(100, 3 * E);
    for (const id of ['a', 'b', 'c']) b.upsert(sized(id, E));
    expect(b.upsert(sized('d', E))).toEqual(['a']);
    expect(b.all().map((e) => e.id)).toEqual(['b', 'c', 'd']);
  });

  it('enforces the byte budget when an existing event grows, without evicting that event', () => {
    const b = new SessionBuffer(100, 3 * E);
    for (const id of ['a', 'b', 'c']) b.upsert(sized(id, E / 2));
    // The oldest event itself grows: the others are evicted, it stays (in its original position).
    expect(b.upsert(sized('a', 3 * E - 1))).toEqual(['b', 'c']);
    expect(b.all().map((e) => e.id)).toEqual(['a']);
    expect(b.dropped).toBe(2);
  });

  it('shrinking an event frees budget', () => {
    const b = new SessionBuffer(100, 2 * E);
    b.upsert(sized('a', 2 * E - 1));
    b.upsert(sized('a', E / 4));
    expect(b.bytes).toBe(E / 4);
    expect(b.upsert(sized('b', E))).toEqual([]);
  });

  it('keeps a single event larger than the whole budget, alone, until a newer one arrives', () => {
    const b = new SessionBuffer(100, E);
    b.upsert(sized('small', E / 4));
    expect(b.upsert(sized('huge', 10 * E))).toEqual(['small']);
    expect(b.all().map((e) => e.id)).toEqual(['huge']);
    expect(b.bytes).toBeGreaterThan(b.maxBytes);
    expect(b.upsert(sized('next', E / 4))).toEqual(['huge']);
    expect(b.all().map((e) => e.id)).toEqual(['next']);
    expect(b.dropped).toBe(2);
  });

  it('applies the count limit when it binds first, and the byte limit when that binds first', () => {
    const byCount = new SessionBuffer(2, 100 * E);
    byCount.upsert(sized('a', E));
    byCount.upsert(sized('b', E));
    expect(byCount.upsert(sized('c', E))).toEqual(['a']);

    const byBytes = new SessionBuffer(100, 2 * E);
    byBytes.upsert(sized('a', E));
    byBytes.upsert(sized('b', E));
    expect(byBytes.upsert(sized('c', E))).toEqual(['a']);
  });

  it('clear() resets events, bytes and the dropped count', () => {
    const b = new SessionBuffer(1, 10 * E);
    b.upsert(sized('a', E / 4));
    b.upsert(sized('b', E / 4));
    expect(b.dropped).toBe(1);
    b.clear();
    expect([b.size, b.bytes, b.dropped, b.all()]).toEqual([0, 0, 0, []]);
    expect(b.upsert(sized('c', E / 4))).toEqual([]);
  });

  it('rejects nonsensical limits', () => {
    expect(() => new SessionBuffer(0)).toThrow(RangeError);
    expect(() => new SessionBuffer(1, 0)).toThrow(RangeError);
  });
});
