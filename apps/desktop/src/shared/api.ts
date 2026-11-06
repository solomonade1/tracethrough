import type { NetworkEvent } from '@tracethrough/core';

/** IPC channel names shared by main, preload and renderer. */
export const IPC = {
  start: 'tl:start',
  stop: 'tl:stop',
  clear: 'tl:clear',
  export: 'tl:export',
  saveFile: 'tl:save-file',
  connectInfo: 'tl:connect-info',
  regenerateToken: 'tl:regenerate-token',
  environment: 'tl:environment',
  openExternal: 'tl:open-external',
  events: 'tl:events',
  status: 'tl:status',
} as const;

export type ExportFormat = 'har' | 'json';

/** Which exchanges an export covers. `ids` omitted means the whole session. */
export interface ExportScope {
  ids?: string[];
}

/** A text file the renderer already holds (a body, one request as HAR) that the user chose to save. */
export interface SaveFileRequest {
  suggestedName: string;
  content: string;
  kind: 'har' | 'json' | 'text';
}

/** Upper bound for ids in one export and for a saved file, enforced in main and in web mode. */
export const MAX_EXPORT_IDS = 10_000;
export const MAX_SAVE_BYTES = 32 * 1024 * 1024;

export interface StartOptions {
  /** App Connect: treat the target URL's origin as the developer's own app and link server events. */
  connect: boolean;
  /** Mask cookies, tokens, API keys and sensitive body fields. Off (values shown as captured) when omitted. */
  mask?: boolean;
}

export interface SessionStatus {
  state: 'idle' | 'starting' | 'recording' | 'stopped';
  sessionId?: string;
  url?: string;
  /** Browser actually launched (bundled Chromium, Chrome or Edge). */
  channel?: string;
  /** Origin receiving `traceparent` when App Connect is on for this session. */
  connectedOrigin?: string;
  /** True when this session masks secrets; false when values are shown exactly as captured. */
  masked?: boolean;
  /** Exchanges evicted by the session cap since the session started. */
  dropped: number;
  error?: string;
}

/** A coalesced batch of exchange updates; `removed` are ids evicted by the ring buffer. */
export interface EventBatch {
  upserts: NetworkEvent[];
  removed: string[];
}

/** Local collector details shown on the Connect App panel. */
export interface ConnectInfo {
  listening: boolean;
  collectorUrl?: string;
  token?: string;
  /** Server events accepted into a session since launch. */
  received: number;
  /** Server events that arrived while no session was recording. */
  ignored: number;
  /** Requests the collector refused since it started (wrong token, wrong path, malformed batch). */
  rejected: number;
  error?: string;
}

/** Facts about this machine the UI needs before a session starts. */
export interface AppEnvironment {
  version: string;
  /** `process.platform` of the machine running capture; picks the default shell for setup commands. */
  platform: string;
  /** Desktop window, or the local web mode served to the developer's own browser. */
  runtime: 'desktop' | 'web';
  /** Browsers that can host a capture session, in the order they will be tried. */
  browsers: { channel: string; label: string }[];
}

export type StartResult = { ok: true } | { ok: false; error: string };
export type ExportResult = { saved: false } | { saved: true; path: string };

/** The only surface the renderer has into the app (exposed as `window.tracethrough`). */
export interface TraceThroughApi {
  startSession(url: string, options?: StartOptions): Promise<StartResult>;
  stopSession(): Promise<void>;
  clearSession(): Promise<void>;
  exportSession(format: ExportFormat, scope?: ExportScope): Promise<ExportResult>;
  saveFile(request: SaveFileRequest): Promise<ExportResult>;
  getConnectInfo(): Promise<ConnectInfo>;
  regenerateToken(): Promise<ConnectInfo>;
  getEnvironment(): Promise<AppEnvironment>;
  /** Opens an allowlisted TraceThrough link (docs, releases, npm) in the user's own browser. */
  openExternal(url: string): Promise<void>;
  onEvents(listener: (batch: EventBatch) => void): () => void;
  onStatus(listener: (status: SessionStatus) => void): () => void;
}
