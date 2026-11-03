import { create } from 'zustand';
import type { EventFilter, NetworkEvent } from '@tracethrough/core';
import type { EventBatch, SessionStatus } from '../../shared/api';

export type DetailTab = 'overview' | 'headers' | 'request' | 'response' | 'timing';

interface InspectorState {
  status: SessionStatus;
  /** Exchanges in arrival order; replaced (not mutated) on every batch so React sees the change. */
  events: NetworkEvent[];
  selectedId: string | undefined;
  detailTab: DetailTab;
  filter: EventFilter;
  setStatus(status: SessionStatus): void;
  applyBatch(batch: EventBatch): void;
  reset(): void;
  select(id: string | undefined): void;
  setDetailTab(tab: DetailTab): void;
  setFilter(patch: Partial<EventFilter>): void;
  resetFilter(): void;
}

export const useInspector = create<InspectorState>((set) => ({
  status: { state: 'idle', dropped: 0 },
  events: [],
  selectedId: undefined,
  detailTab: 'overview',
  filter: {},

  setStatus: (status) => set({ status }),

  applyBatch: ({ upserts, removed }) =>
    set((s) => {
      let events = s.events;
      if (removed.length) {
        const gone = new Set(removed);
        events = events.filter((e) => !gone.has(e.id));
      } else {
        events = events.slice();
      }
      const index = new Map(events.map((e, i) => [e.id, i]));
      for (const e of upserts) {
        const i = index.get(e.id);
        if (i === undefined) {
          index.set(e.id, events.length);
          events.push(e);
        } else {
          events[i] = e;
        }
      }
      const selectedId = s.selectedId && index.has(s.selectedId) ? s.selectedId : undefined;
      return { events, selectedId };
    }),

  reset: () => set({ events: [], selectedId: undefined }),
  select: (selectedId) => set({ selectedId }),
  setDetailTab: (detailTab) => set({ detailTab }),
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  resetFilter: () => set({ filter: {} }),
}));
