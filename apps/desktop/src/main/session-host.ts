import { CaptureSession, InvalidTargetUrlError, validateTargetUrl, type BrowserChannel } from '@tracethrough/capture';
import { toHar, toSessionExport, type NetworkEvent, type ServerEventInput } from '@tracethrough/core';
import { IPC, type EventBatch, type ExportFormat, type SessionStatus, type StartOptions, type StartResult } from '../shared/api';

export interface SessionHostOptions {
  headless?: boolean;
  channel?: BrowserChannel;
  /** How long updates are coalesced before being sent to the renderer. */
  flushIntervalMs?: number;
  appVersion?: string;
  /** Capture-session retention limits (see CaptureOptions); defaults apply when omitted. */
  maxEvents?: number;
  maxBufferBytes?: number;
}

type Send = (channel: string, payload: unknown) => void;

/**
 * Owns the single capture session for a window and streams coalesced updates to the renderer,
 * masked or exactly as captured depending on the session's `mask` option.
 */
export class SessionHost {
  #session: CaptureSession | undefined;
  #status: SessionStatus = { state: 'idle', dropped: 0 };
  readonly #pending = new Map<string, NetworkEvent>();
  readonly #removed: string[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every start and dispose, so a startup that finishes late can tell it was superseded. */
  #generation = 0;

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
    const opts = options && typeof options === 'object' ? (options as Partial<StartOptions>) : {};
    const connectedOrigin = opts.connect === true ? target.origin : undefined;
    const masked = opts.mask === true;

    await this.#disposeSession();
    const generation = ++this.#generation;
    this.#setStatus({ state: 'starting', url, connectedOrigin, masked, dropped: 0 });
    let session: CaptureSession | undefined;
    try {
      session = await CaptureSession.create({
        url,
        headless: this.opts.headless,
        channel: this.opts.channel,
        connectedOrigin,
        maxEvents: this.opts.maxEvents,
        maxBufferBytes: this.opts.maxBufferBytes,
        // Masking off keeps cookies, tokens and bodies exactly as captured (default policy otherwise).
        redaction: masked ? undefined : false,
      });
      // dispose() ran while the browser was launching: this session was never adopted, so close it.
      if (generation !== this.#generation) {
        await session.stop();
        return { ok: false, error: 'Session start was cancelled' };
      }
      // Adopt the session and attach its listeners before the first navigation, so server events
      // sent while a slow document is still being served (SSR) are already accepted and linked.
      this.#adopt(session);
      await session.navigate(url);
      // Stopped or replaced while the document was loading: never reactivate it.
      if (this.#session !== session || session.closed) return { ok: false, error: 'Session was stopped while starting' };
      this.#setStatus({
        state: 'recording',
        sessionId: session.id,
        url,
        channel: session.channel,
        connectedOrigin,
        masked: session.masking,
        dropped: session.buffer.dropped,
      });
      return { ok: true };
    } catch (err) {
      const error = (err as Error).message;
      if (session) {
        if (this.#session === session) this.#session = undefined;
        await session.stop();
      }
      if (generation === this.#generation) this.#setStatus({ state: 'idle', dropped: 0, error });
      return { ok: false, error };
    }
  }

  #adopt(session: CaptureSession) {
    this.#session = session;
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
  }

  /**
   * Routes App Connect events into the current session, including while its first page is still
   * loading. Returns how many were accepted; events arriving with no active session are ignored
   * (the SDK stays enabled for the next session). There is deliberately no queue for them, so an
   * event can never be attached to a later, unrelated session.
   */
  ingest(events: readonly ServerEventInput[]): number {
    // The session is adopted before its first navigation, so this also covers the `starting` phase.
    const session = this.#session;
    if (!session || session.closed) return 0;
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

  /** Everything currently buffered, for a UI that attaches mid-session (e.g. a reloaded browser tab). */
  snapshot(): EventBatch {
    return { upserts: this.#session?.buffer.all() ?? [], removed: [] };
  }

  /** True when the current session masks secrets (exports then carry the sanitized warning). */
  get masked(): boolean {
    return this.#session?.masking ?? true;
  }

  /** Serialized export of the current buffer (masked or as captured, per session), or undefined when empty. */
  exportData(format: ExportFormat, ids?: readonly string[]): string | undefined {
    const session = this.#session;
    if (!session || session.buffer.size === 0) return undefined;
    const wanted = ids ? new Set(ids) : undefined;
    const events = wanted ? session.buffer.all().filter((e) => wanted.has(e.id)) : session.buffer.all();
    if (!events.length) return undefined;
    const doc =
      format === 'har'
        ? toHar(events, this.opts.appVersion, session.masking)
        : toSessionExport(session.id, events, session.buffer.dropped, session.masking);
    return JSON.stringify(doc, null, 2);
  }

  async dispose(): Promise<void> {
    await this.#disposeSession();
  }

  async #disposeSession() {
    this.#generation++;
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
