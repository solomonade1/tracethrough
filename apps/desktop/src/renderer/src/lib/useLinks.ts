import type { NetworkEvent } from '@tracethrough/core';
import { useInspector } from '../store';
import { buildLinks, type TraceLinks } from './rows';

const cache = new WeakMap<NetworkEvent[], TraceLinks>();

/** Trace links for the current events, computed once per batch however many components ask. */
export function useLinks(): TraceLinks {
  const events = useInspector((s) => s.events);
  let links = cache.get(events);
  if (!links) {
    links = buildLinks(events);
    cache.set(events, links);
  }
  return links;
}
