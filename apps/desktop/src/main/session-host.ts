import { CaptureSession, InvalidTargetUrlError, validateTargetUrl, type BrowserChannel } from '@tracelens/capture';
import { toHar, toSessionExport, type NetworkEvent, type ServerEventInput } from '@tracelens/core';
import { IPC, type EventBatch, type ExportFormat, type SessionStatus, type StartOptions, type StartResult } from '../shared/api';

export interface SessionHostOptions {
  headless?: boolean;
  channel?: BrowserChannel;
  /** How long updates are coalesced before being sent to the renderer. */
  flushIntervalMs?: number;
  appVersion?: string;
}

type Send = (channel: string, payload: unknown) => void;

/**
 * Owns the single capture session for a window and streams coalesced, already-redacted
 * updates to the renderer. Raw traffic never crosses this boundary.
 */
export class SessionHost {
  #session: CaptureSession | undefined;
  #status: SessionStatus = { state: 'idle', dropped: 0 };
  readonly #pending = new Map<string, NetworkEvent>();
  readonly #removed: string[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly send: Send,
    private readonly opts: SessionHostOptions = {},
  ) {}

  get status(): SessionStatus {
    return this.#status;
  }

  async start(url: unknown, options?: unknown): Promise<StartResult> {
    if (typeof url !== 'string') return { ok: false, error: 'URL must be a string' };
    let target: URL;
    try {
      target = validateTargetUrl(url);
    } catch (err) {
      if (err instanceof InvalidTargetUrlError) return { ok: false, error: err.message };
      throw err;
    }
    if (this.#status.state === 'starting') return { ok: false, error: 'A session is already starting' };
    const connect = !!(options && typeof options === 'object' && (options as Partial<StartOptions>).connect === true);
    const connectedOrigin = connect ? target.origin : undefined;

    await this.#disposeSession();
    this.#setStatus({ state: 'starting', url, connectedOrigin, dropped: 0 });
    try {
      const session = await CaptureSession.start({
        url,
        headless: this.opts.headless,
        channel: this.opts.channel,
        connectedOrigin,
      });
      this.#session = session;
      // Exchanges captured during start() (the initial navigation) predate these listeners.
      for (const e of session.buffer.all()) this.#queue(e);
      session.on('event', (e) => this.#queue(e));
      session.on('evicted', (id) => {
        this.#pending.delete(id);
        this.#removed.push(id);
        this.#scheduleFlush();
      });
      session.on('closed', () => {
        if (this.#session !== session) return;
        this.#flush();
        this.#setStatus({ ...this.#status, state: 'stopped', dropped: session.buffer.dropped });
      });
      this.#setStatus({ state: 'recording', sessionId: session.id, url, channel: session.channel, connectedOrigin, dropped: 0 });
      return { ok: true };
    } catch (err) {
      const error = (err as Error).message;
      this.#setStatus({ state: 'idle', dropped: 0, error });
      return { ok: false, error };
    }
  }

  /**
   * Routes App Connect events into the recording session. Returns how many were accepted; events
   * arriving with no recording session are ignored (the SDK stays enabled for the next session).
   */
  ingest(events: readonly ServerEventInput[]): number {
    const session = this.#session;
    if (!session || this.#status.state !== 'recording') return 0;
    let accepted = 0;
    for (const e of events) if (session.ingestServerEvent(e)) accepted++;
    return accepted;
  }

  async stop(): Promise<void> {
    await this.#session?.stop();
  }

  /** Discards captured exchanges; recording (if active) continues. */
  clear(): void {
    this.#pending.clear();
    this.#removed.length = 0;
    this.#session?.buffer.clear();
    this.#setStatus({ ...this.#status, dropped: 0 });
  }

  /** Serialized export of the current (already redacted) buffer, or undefined when empty. */
  exportData(format: ExportFormat): string | undefined {
    const session = this.#session;
    if (!session || session.buffer.size === 0) return undefined;
    const events = session.buffer.all();
    const doc = format === 'har' ? toHar(events, this.opts.appVersion) : toSessionExport(session.id, events, session.buffer.dropped);
    return JSON.stringify(doc, null, 2);
  }

  async dispose(): Promise<void> {
    await this.#disposeSession();
  }

  async #disposeSession() {
    const old = this.#session;
    this.#session = undefined;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#pending.clear();
    this.#removed.length = 0;
    await old?.stop();
  }

  #queue(e: NetworkEvent) {
    this.#pending.set(e.id, e);
    this.#scheduleFlush();
  }

  #scheduleFlush() {
    this.#timer ??= setTimeout(() => this.#flush(), this.opts.flushIntervalMs ?? 50);
  }

  #flush() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#pending.size === 0 && this.#removed.length === 0) return;
    const batch: EventBatch = { upserts: [...this.#pending.values()], removed: this.#removed.splice(0) };
    this.#pending.clear();
    this.send(IPC.events, batch);
    const dropped = this.#session?.buffer.dropped ?? 0;
    if (dropped !== this.#status.dropped) this.#setStatus({ ...this.#status, dropped });
  }

  #setStatus(status: SessionStatus) {
    this.#status = status;
    this.send(IPC.status, status);
  }
}
