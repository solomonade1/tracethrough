import type { NetworkEvent } from '@tracethrough/core';
import { nameOf } from '../format';

/** Browser and server events that share a trace id (COR-01: linked only on an exact match). */
export interface TraceLinks {
  browser: Map<string, NetworkEvent>;
  servers: Map<string, NetworkEvent[]>;
}

export function buildLinks(events: readonly NetworkEvent[]): TraceLinks {
  const browser = new Map<string, NetworkEvent>();
  const servers = new Map<string, NetworkEvent[]>();
  for (const e of events) {
    if (!e.traceId) continue;
    if (e.source === 'browser') {
      if (!browser.has(e.traceId)) browser.set(e.traceId, e);
    } else {
      const list = servers.get(e.traceId);
      if (list) list.push(e);
      else servers.set(e.traceId, [e]);
    }
  }
  return { browser, servers };
}

export const triggerOf = (links: TraceLinks, e: NetworkEvent): NetworkEvent | undefined =>
  e.source === 'server' && e.traceId ? links.browser.get(e.traceId) : undefined;

export const serverCallsOf = (links: TraceLinks, e: NetworkEvent): NetworkEvent[] =>
  e.source === 'browser' && e.traceId ? (links.servers.get(e.traceId) ?? []) : [];

export type RowItem =
  | { kind: 'event'; event: NetworkEvent; child: boolean }
  | { kind: 'group'; key: string; label: string; count: number; note?: string };

/**
 * Table rows for the filtered events. By default server calls sit directly under the browser request
 * that triggered them (when that request is also shown). With `group`, rows are grouped by page.
 */
export function buildRows(visible: readonly NetworkEvent[], links: TraceLinks, group: boolean): RowItem[] {
  if (group) {
    const groups = new Map<string, NetworkEvent[]>();
    for (const e of visible) {
      const key = e.navigationId ?? triggerOf(links, e)?.navigationId ?? 'none';
      const list = groups.get(key);
      if (list) list.push(e);
      else groups.set(key, [e]);
    }
    const keys = [...groups.keys()].sort((a, b) => Number(a === 'none') - Number(b === 'none'));
    const rows: RowItem[] = [];
    for (const key of keys) {
      const list = groups.get(key)!;
      const head = list.find((e) => e.isNavigation) ?? list[0]!;
      rows.push(
        key === 'none'
          ? { kind: 'group', key, label: 'Not tied to a page', count: list.length, note: 'server calls without trace context' }
          : { kind: 'group', key, label: nameOf(head.urlSanitized), count: list.length },
      );
      for (const event of list) rows.push({ kind: 'event', event, child: false });
    }
    return rows;
  }

  const shown = new Set(visible.map((e) => e.id));
  const rows: RowItem[] = [];
  for (const e of visible) {
    const trigger = triggerOf(links, e);
    if (trigger && shown.has(trigger.id)) continue; // placed under its trigger
    rows.push({ kind: 'event', event: e, child: false });
    const children = serverCallsOf(links, e)
      .filter((x) => shown.has(x.id))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (const child of children) rows.push({ kind: 'event', event: child, child: true });
  }
  return rows;
}
