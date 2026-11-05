import { describe, expect, it } from 'vitest';
import { EXPORT_WARNING, filterEvents, statusClassOf, toHar, toSessionExport, type NetworkEvent } from '../src/index.ts';

let n = 0;
const ev = (over: Partial<NetworkEvent> = {}): NetworkEvent => ({
  id: `e${n++}`,
  sessionId: 's',
  source: 'browser',
  state: 'complete',
  timestamp: '2026-11-03T10:00:00.000Z',
  method: 'GET',
  urlSanitized: 'https://api.example.test/v1/items?page=1',
  domain: 'api.example.test',
  status: 200,
  type: 'fetch',
  isNavigation: false,
  redactionApplied: false,
  ...over,
});

describe('filterEvents', () => {
  const events = [
    ev({ id: 'ok' }),
    ev({ id: 'notfound', status: 404, method: 'POST', urlSanitized: 'https://api.example.test/v1/login' }),
    ev({ id: 'err', status: 503, type: 'xhr' }),
    ev({ id: 'fail', state: 'failed', status: undefined, domain: 'cdn.test', urlSanitized: 'https://cdn.test/a.js', type: 'asset' }),
    ev({ id: 'pending', state: 'pending', status: undefined }),
    ev({ id: 'body', responseBody: { preview: '{"needle":"haystack"}', truncated: false } }),
  ];
  const ids = (f: Parameters<typeof filterEvents>[1]) => filterEvents(events, f).map((e) => e.id);

  it('classifies statuses', () => {
    expect(events.map(statusClassOf)).toEqual(['2xx', '4xx', '5xx', 'failed', 'pending', '2xx']);
  });

  it('treats empty filters as match-all', () => {
    expect(ids({})).toHaveLength(events.length);
    expect(ids({ methods: [], text: '  ' })).toHaveLength(events.length);
  });

  it('ANDs across facets and ORs within a facet', () => {
    expect(ids({ statusClasses: ['4xx', '5xx', 'failed'] })).toEqual(['notfound', 'err', 'fail']);
    expect(ids({ statusClasses: ['4xx', '5xx'], types: ['xhr'] })).toEqual(['err']);
    expect(ids({ methods: ['POST'] })).toEqual(['notfound']);
    expect(ids({ domains: ['cdn.test'] })).toEqual(['fail']);
    expect(ids({ sources: ['server'] })).toEqual([]);
  });

  it('searches URL, method and status; bodies only when asked', () => {
    expect(ids({ text: 'LOGIN' })).toEqual(['notfound']);
    expect(ids({ text: '503' })).toEqual(['err']);
    expect(ids({ text: 'haystack' })).toEqual([]);
    expect(ids({ text: 'haystack', searchBodies: true })).toEqual(['body']);
  });

  it('filters 2,000 events well under the 200 ms budget (UI-02)', () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      ev({ urlSanitized: `https://h${i % 40}.test/path/${i}?q=${i}`, status: [200, 301, 404, 500][i % 4], domain: `h${i % 40}.test` }),
    );
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      filterEvents(many, { text: `path/${i}`, statusClasses: ['2xx', '4xx'], methods: ['GET'] });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)]!).toBeLessThan(50);
  });
});

describe('toHar', () => {
  it('maps exchanges to HAR 1.2 entries with redirects, failures and body notes', () => {
    const a = ev({ id: 'a', status: 302, urlSanitized: 'https://x.test/a', responseBody: { truncated: false, unavailableReason: 'redirect' } });
    const b = ev({
      id: 'b',
      urlSanitized: 'https://x.test/b?token=[REDACTED]&p=1',
      redirectedFromId: 'a',
      redactionApplied: true,
      requestHeadersSanitized: { cookie: 'sid=[REDACTED]' },
      responseHeadersSanitized: { 'set-cookie': 'a=[REDACTED]\nb=[REDACTED]', 'content-type': 'application/json' },
      responseBody: { mime: 'application/json', sizeBytes: 9000, preview: '{"a":1', truncated: true },
      timing: { dnsMs: 1, ttfbMs: 20, downloadMs: 3 },
      durationMs: 25,
    });
    const c = ev({ id: 'c', method: 'POST', state: 'failed', status: undefined, error: { code: 'net::ERR_FAILED', message: 'x' } });

    const har = toHar([a, b, c], '1.0.0');
    expect(har.log).toMatchObject({ version: '1.2', creator: { name: 'TraceThrough', version: '1.0.0' }, comment: EXPORT_WARNING });
    const [ha, hb, hc] = har.log.entries;

    expect(ha!.response).toMatchObject({ status: 302, redirectURL: b.urlSanitized });
    expect(ha!.response.content.comment).toContain('redirect');

    expect(hb!.request.queryString).toEqual([{ name: 'token', value: '[REDACTED]' }, { name: 'p', value: '1' }]);
    expect(hb!.response.headers.filter((h) => h.name === 'set-cookie')).toHaveLength(2);
    expect(hb!.response.content).toMatchObject({ size: 9000, mimeType: 'application/json', text: '{"a":1' });
    expect(hb!.response.content.comment).toContain('truncated');
    expect(hb!.timings).toMatchObject({ dns: 1, connect: -1, wait: 20, receive: 3 });
    expect(hb!.comment).toContain('Redirected from https://x.test/a');

    expect(hc!.response.status).toBe(0);
    expect(hc!._error).toEqual({ code: 'net::ERR_FAILED', message: 'x' });
  });

  it('wraps native exports with format metadata', () => {
    expect(toSessionExport('s1', [ev()], 3)).toMatchObject({ format: 'tracethrough-session', version: 1, sessionId: 's1', droppedEvents: 3 });
  });
});

describe('exports with masking off', () => {
  it('say so in the HAR comment and the session export', () => {
    expect(toHar([], '1.0.0').log.comment).toBe(EXPORT_WARNING);
    expect(toHar([], '1.0.0', false).log.comment).toContain('Masking was off');
    expect(toSessionExport('s', [], 0).masked).toBe(true);
    expect(toSessionExport('s', [], 0, false).masked).toBe(false);
  });
});
