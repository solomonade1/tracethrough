import type { EventSource, NetworkEvent, RequestType } from './schema.ts';

export type StatusClass = 'pending' | 'failed' | '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

export interface EventFilter {
  /** Case-insensitive substring over URL, method and status (and bodies when `searchBodies`). */
  text?: string;
  /** Opt-in because body previews can be large; URL search stays fast at any session size. */
  searchBodies?: boolean;
  /** Each list is "any of"; empty or absent means no constraint. */
  methods?: readonly string[];
  statusClasses?: readonly StatusClass[];
  types?: readonly RequestType[];
  sources?: readonly EventSource[];
  domains?: readonly string[];
}

export function statusClassOf(e: NetworkEvent): StatusClass {
  if (e.state === 'failed') return 'failed';
  if (e.state === 'pending' || e.status === undefined) return 'pending';
  const hundreds = Math.floor(e.status / 100);
  return hundreds >= 1 && hundreds <= 5 ? (`${hundreds}xx` as StatusClass) : 'failed';
}

const anyOf = <T>(list: readonly T[] | undefined, value: T | undefined) =>
  !list || list.length === 0 || (value !== undefined && list.includes(value));

export function matchesFilter(e: NetworkEvent, f: EventFilter): boolean {
  if (!anyOf(f.methods, e.method)) return false;
  if (!anyOf(f.statusClasses, statusClassOf(e))) return false;
  if (!anyOf(f.types, e.type)) return false;
  if (!anyOf(f.sources, e.source)) return false;
  if (!anyOf(f.domains, e.domain)) return false;

  const needle = f.text?.trim().toLowerCase();
  if (!needle) return true;
  if (e.urlSanitized.toLowerCase().includes(needle)) return true;
  if (e.method.toLowerCase() === needle || String(e.status ?? '') === needle) return true;
  if (f.searchBodies) {
    return [e.requestBody?.preview, e.responseBody?.preview].some((p) => p?.toLowerCase().includes(needle));
  }
  return false;
}

export function filterEvents(events: readonly NetworkEvent[], f: EventFilter): NetworkEvent[] {
  return events.filter((e) => matchesFilter(e, f));
}
