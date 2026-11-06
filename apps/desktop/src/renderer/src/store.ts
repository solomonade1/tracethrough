import { create } from 'zustand';
import type { EventFilter, NetworkEvent } from '@tracethrough/core';
import type { EventBatch, ExportFormat, SessionStatus } from '../../shared/api';

export type DetailTab = 'overview' | 'headers' | 'request' | 'response' | 'timing';
export type BodyViewMode = 'tree' | 'pretty' | 'raw';
export type ExportScopeChoice = 'all' | 'view' | 'sel';

interface InspectorState {
  status: SessionStatus;
  /** Exchanges in arrival order; replaced (not mutated) on every batch so React sees the change. */
  events: NetworkEvent[];
  selectedId: string | undefined;
  detailTab: DetailTab;
  filter: EventFilter;
  /** Rows ticked for copy and export. Survives filter changes; evicted ids are dropped. */
  picked: Set<string>;
  groupByPage: boolean;
  requestView: BodyViewMode;
  responseView: BodyViewMode;
  toast: { n: number; text: string } | undefined;
  /** "Exported to …" message shown in the session strip for a few seconds. */
  notice: string | undefined;
  exportDialog: { scope: ExportScopeChoice; format: ExportFormat } | undefined;
  setStatus(status: SessionStatus): void;
  applyBatch(batch: EventBatch): void;
  reset(): void;
  select(id: string | undefined): void;
  setDetailTab(tab: DetailTab): void;
  setFilter(patch: Partial<EventFilter>): void;
  resetFilter(): void;
  togglePick(id: string): void;
  setPicked(ids: Iterable<string>, on: boolean): void;
  clearPicked(): void;
  setGroupByPage(on: boolean): void;
  setBodyView(which: 'request' | 'response', mode: BodyViewMode): void;
  showToast(text: string): void;
  setNotice(text: string | undefined): void;
  openExport(scope: ExportScopeChoice, format?: ExportFormat): void;
  closeExport(): void;
}

let toastCount = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useInspector = create<InspectorState>((set) => ({
  status: { state: 'idle', dropped: 0 },
  events: [],
  selectedId: undefined,
  detailTab: 'overview',
  filter: {},
  picked: new Set(),
  groupByPage: false,
  requestView: 'tree',
  responseView: 'tree',
  toast: undefined,
  notice: undefined,
  exportDialog: undefined,

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
      let picked = s.picked;
      if (removed.length && [...picked].some((id) => !index.has(id))) picked = new Set([...picked].filter((id) => index.has(id)));
      return { events, selectedId, picked };
    }),

  reset: () => set({ events: [], selectedId: undefined, picked: new Set(), notice: undefined, exportDialog: undefined }),
  select: (selectedId) => set({ selectedId }),
  setDetailTab: (detailTab) => set({ detailTab }),
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  resetFilter: () => set({ filter: {} }),

  togglePick: (id) =>
    set((s) => {
      const picked = new Set(s.picked);
      if (!picked.delete(id)) picked.add(id);
      return { picked };
    }),
  setPicked: (ids, on) =>
    set((s) => {
      const picked = new Set(s.picked);
      for (const id of ids) {
        if (on) picked.add(id);
        else picked.delete(id);
      }
      return { picked };
    }),
  clearPicked: () => set({ picked: new Set() }),
  setGroupByPage: (groupByPage) => set({ groupByPage }),
  setBodyView: (which, mode) => set(which === 'request' ? { requestView: mode } : { responseView: mode }),
  showToast: (text) => set({ toast: { n: ++toastCount, text } }),
  setNotice: (text) => {
    clearTimeout(noticeTimer);
    set({ notice: text });
    if (text) noticeTimer = setTimeout(() => set({ notice: undefined }), 6000);
  },
  openExport: (scope, format = 'har') => set({ exportDialog: { scope, format } }),
  closeExport: () => set({ exportDialog: undefined }),
}));
