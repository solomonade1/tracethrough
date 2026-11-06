import { describe, expect, it } from 'vitest';
import type { NetworkEvent } from '@tracethrough/core';
import { buildLinks, buildRows, serverCallsOf, triggerOf } from '../src/renderer/src/lib/rows';
import { extForMime, saveNameFor } from '../src/renderer/src/format';

let n = 0;
const ev = (over: Partial<NetworkEvent> = {}): NetworkEvent => ({
  id: `e${n++}`,
  sessionId: 's',
  source: 'browser',
  state: 'complete',
  timestamp: `2026-11-05T10:00:0${n % 10}.000Z`,
  method: 'GET',
  urlSanitized: 'https://app.test/x',
  domain: 'app.test',
  status: 200,
  isNavigation: false,
  redactionApplied: false,
  ...over,
});

const TRACE = 'a'.repeat(32);
const page = ev({ id: 'page', urlSanitized: 'https://app.test/shop', isNavigation: true, navigationId: 'n1', traceId: TRACE });
const asset = ev({ id: 'asset', urlSanitized: 'https://app.test/app.js', navigationId: 'n1' });
const linked = ev({ id: 'srv1', source: 'server', traceId: TRACE, timestamp: '2026-11-05T10:00:05.000Z' });
const linked2 = ev({ id: 'srv2', source: 'server', traceId: TRACE, timestamp: '2026-11-05T10:00:04.000Z' });
const orphan = ev({ id: 'orphan', source: 'server', traceId: 'b'.repeat(32) });
const all = [page, linked, asset, orphan, linked2];

describe('trace links (COR-01)', () => {
  const links = buildLinks(all);
  it('link only on an exact trace id', () => {
    expect(triggerOf(links, linked)?.id).toBe('page');
    expect(triggerOf(links, orphan)).toBeUndefined();
    expect(serverCallsOf(links, page).map((e) => e.id)).toEqual(['srv1', 'srv2']);
    expect(serverCallsOf(links, asset)).toEqual([]);
  });
});

describe('buildRows', () => {
  const links = buildLinks(all);
  const ids = (rows: ReturnType<typeof buildRows>) => rows.map((r) => (r.kind === 'event' ? `${r.child ? '  ' : ''}${r.event.id}` : `# ${r.label}`));

  it('nests server calls under their trigger, ordered by time, and keeps arrival order otherwise', () => {
    expect(ids(buildRows(all, links, false))).toEqual(['page', '  srv2', '  srv1', 'asset', 'orphan']);
  });

  it('shows a server call on its own when its trigger is filtered out', () => {
    expect(ids(buildRows([linked, asset], links, false))).toEqual(['srv1', 'asset']);
  });

  it('groups by page, putting server calls with their trigger and the rest last', () => {
    expect(ids(buildRows(all, links, true))).toEqual(['# /shop', 'page', 'srv1', 'asset', 'srv2', '# Not tied to a page', 'orphan']);
  });
});

describe('save file names', () => {
  it('picks an extension from the MIME type', () => {
    expect(extForMime('application/json; charset=utf-8')).toBe('json');
    expect(extForMime('text/html')).toBe('html');
    expect(extForMime(undefined)).toBe('txt');
  });

  it('builds a readable name from the method and last path segment', () => {
    const name = saveNameFor(ev({ urlSanitized: 'https://app.test/api/v1/products?page=2' }), 'json');
    expect(name).toMatch(/^tracethrough-get-products-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
  });
});
