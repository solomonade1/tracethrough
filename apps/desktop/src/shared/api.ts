import type { NetworkEvent } from '@tracelens/core';

/** IPC channel names shared by main, preload and renderer. */
export const IPC = {
  start: 'tl:start',
  stop: 'tl:stop',
  clear: 'tl:clear',
  export: 'tl:export',
  events: 'tl:events',
  status: 'tl:status',
} as const;

export type ExportFormat = 'har' | 'json';

export interface SessionStatus {
  state: 'idle' | 'starting' | 'recording' | 'stopped';
  sessionId?: string;
  url?: string;
  /** Browser actually launched (bundled Chromium, Chrome or Edge). */
  channel?: string;
  /** Exchanges evicted by the session cap since the session started. */
  dropped: number;
  error?: string;
}

/** A coalesced batch of exchange updates; `removed` are ids evicted by the ring buffer. */
export interface EventBatch {
  upserts: NetworkEvent[];
  removed: string[];
}

export type StartResult = { ok: true } | { ok: false; error: string };
export type ExportResult = { saved: false } | { saved: true; path: string };

/** The only surface the renderer has into the app (exposed as `window.tracelens`). */
export interface TraceLensApi {
  startSession(url: string): Promise<StartResult>;
  stopSession(): Promise<void>;
  clearSession(): Promise<void>;
  exportSession(format: ExportFormat): Promise<ExportResult>;
  onEvents(listener: (batch: EventBatch) => void): () => void;
  onStatus(listener: (status: SessionStatus) => void): () => void;
}
