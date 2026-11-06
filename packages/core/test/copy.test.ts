import { describe, expect, it } from 'vitest';
import {
  MASK,
  exchangeAsText,
  jsonPathToString,
  parseCookies,
  toCurl,
  toFetch,
  toHar,
  toHarEntry,
  type NetworkEvent,
} from '../src/index.ts';

const ev = (over: Partial<NetworkEvent> = {}): NetworkEvent => ({
  id: 'e1',
  sessionId: 's',
  source: 'browser',
  state: 'complete',
  timestamp: '2026-11-05T10:00:00.000Z',
  method: 'GET',
  urlSanitized: 'https://api.example.test/v1/items?page=1',
  domain: 'api.example.test',
  status: 200,
  statusText: 'OK',
  type: 'fetch',
  isNavigation: false,
  redactionApplied: false,
  ...over,
});

describe('toCurl', () => {
  it('writes a plain GET with its headers', () => {
    const out = toCurl(ev({ requestHeadersSanitized: { accept: 'application/json' } }));
    expect(out).toBe(["curl 'https://api.example.test/v1/items?page=1' \\", "  -H 'accept: application/json'"].join('\n'));
  });

  it('adds method and body, escapes single quotes and keeps masked values masked', () => {
    const out = toCurl(
      ev({
        method: 'POST',
        requestHeadersSanitized: { authorization: `Bearer ${MASK}`, 'x-note': "it's" },
        requestBody: { mime: 'application/json', preview: `{"name":"O'Neil"}`, truncated: false },
        redactionApplied: true,
      }),
    );
    expect(out).toContain('-X POST');
    expect(out).toContain(`-H 'authorization: Bearer ${MASK}'`);
    const q = "'\\''"; // how a single quote is written inside a single-quoted shell string
    expect(out).toContain(`-H 'x-note: it${q}s'`);
    expect(out).toContain(`--data-raw '{"name":"O${q}Neil"}'`);
  });

  it('omits the body flag when there is no readable request body', () => {
    expect(toCurl(ev({ method: 'POST', requestBody: { truncated: false, unavailableReason: 'omitted-by-policy' } }))).not.toContain('--data-raw');
  });

  it('splits multi-value headers into one flag each', () => {
    const out = toCurl(ev({ requestHeadersSanitized: { 'x-multi': 'a\nb' } }));
    expect(out).toContain(`-H 'x-multi: a'`);
    expect(out).toContain(`-H 'x-multi: b'`);
  });
});

describe('toFetch', () => {
  it('includes method, headers and body', () => {
    const out = toFetch(
      ev({ method: 'post', requestHeadersSanitized: { 'content-type': 'application/json' }, requestBody: { preview: '{"a":1}', truncated: false } }),
    );
    expect(out).toContain('await fetch("https://api.example.test/v1/items?page=1"');
    expect(out).toContain('"method": "POST"');
    expect(out).toContain('"content-type": "application/json"');
    expect(out).toContain('"body": "{\\"a\\":1}"');
  });
});

describe('parseCookies', () => {
  it('reads sent cookies and set-cookie lines, case-insensitively', () => {
    const cookies = parseCookies(
      ev({
        requestHeadersSanitized: { Cookie: 'sid=abc; theme=dark' },
        responseHeadersSanitized: { 'Set-Cookie': 'sid=new; Path=/; HttpOnly\nflag=1' },
      }),
    );
    expect(cookies).toEqual([
      { kind: 'sent', name: 'sid', value: 'abc' },
      { kind: 'sent', name: 'theme', value: 'dark' },
      { kind: 'set', name: 'sid', value: 'new', attributes: 'Path=/; HttpOnly' },
      { kind: 'set', name: 'flag', value: '1' },
    ]);
  });

  it('keeps = inside values and returns nothing without cookie headers', () => {
    expect(parseCookies(ev({ requestHeadersSanitized: { cookie: 'a=b=c' } }))[0]).toMatchObject({ name: 'a', value: 'b=c' });
    expect(parseCookies(ev())).toEqual([]);
  });
});

describe('jsonPathToString', () => {
  it('builds accessors, bracketing indexes and non-identifier keys', () => {
    expect(jsonPathToString([])).toBe('');
    expect(jsonPathToString(['data', 'items', 0, 'name'])).toBe('data.items[0].name');
    expect(jsonPathToString(['data', 'x-id', 'a b'])).toBe('data["x-id"]["a b"]');
    expect(jsonPathToString([0, 'id'])).toBe('[0].id');
  });
});

describe('exchangeAsText', () => {
  it('lays out request then response', () => {
    const out = exchangeAsText(
      ev({
        method: 'POST',
        requestHeadersSanitized: { accept: '*/*' },
        requestBody: { preview: 'in', truncated: false },
        responseHeadersSanitized: { 'content-type': 'text/plain' },
        responseBody: { preview: 'out', truncated: false },
      }),
    );
    expect(out).toBe(
      ['POST https://api.example.test/v1/items?page=1', 'accept: */*', '', 'in', '', '200 OK', 'content-type: text/plain', '', 'out'].join('\n'),
    );
  });

  it('says why a body is missing', () => {
    expect(exchangeAsText(ev({ responseBody: { truncated: false, unavailableReason: 'binary' } }))).toContain('[body unavailable: binary]');
  });
});

describe('toHarEntry', () => {
  it('matches the entry toHar produces', () => {
    const e = ev({ requestHeadersSanitized: { accept: '*/*' } });
    expect(toHarEntry(e)).toEqual(toHar([e]).log.entries[0]);
  });
});
