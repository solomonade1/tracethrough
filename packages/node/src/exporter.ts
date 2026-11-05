import { request } from 'node:http';
import type { ServerEventInput } from '@tracethrough/core';

export interface ExporterOptions {
  collectorUrl: string;
  token: string;
  flushIntervalMs: number;
  maxQueue: number;
  onDisable(reason: string): void;
}

const MAX_BATCH = 500;
/** Keeps a batch well under the collector's request limit now that events can carry body previews. */
const MAX_BATCH_BYTES = 1024 * 1024;
const FAILURES_BEFORE_PAUSE = 3;
const PAUSE_MS = 30_000;

/**
 * Bounded, coalescing, never-throwing exporter. Uses node:http rather than fetch so the SDK
 * never observes its own traffic through the undici diagnostics channels.
 */
export class Exporter {
  readonly #queue = new Map<string, ServerEventInput>();
  readonly #opts: ExporterOptions;
  readonly #url: URL;
  #timer: NodeJS.Timeout | undefined;
  #inFlight: Promise<void> | undefined;
  #failures = 0;
  #pausedUntil = 0;
  #disabled = false;
  dropped = 0;

  constructor(opts: ExporterOptions) {
    this.#opts = opts;
    this.#url = new URL('/v1/events', opts.collectorUrl);
  }

  push(event: ServerEventInput) {
    if (this.#disabled) return;
    if (!this.#queue.has(event.id) && this.#queue.size >= this.#opts.maxQueue) {
      const oldest = this.#queue.keys().next().value;
      if (oldest !== undefined) this.#queue.delete(oldest);
      this.dropped++;
    }
    this.#queue.set(event.id, event);
    this.#schedule(this.#opts.flushIntervalMs);
  }

  /**
   * Sends everything queued now and resolves once the collector has answered (used by tests,
   * shutdown and callers that must know their events were delivered). A batch the background timer
   * already started counts too: its events have left the queue but are not delivered until it ends.
   */
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    for (;;) {
      const sending = this.#inFlight;
      if (sending) {
        await sending;
        if (this.#failures) break;
        continue;
      }
      if (!this.#queue.size || this.#disabled || Date.now() < this.#pausedUntil) break;
      this.#inFlight = this.#sendBatch().finally(() => (this.#inFlight = undefined));
    }
  }

  disable(reason: string) {
    if (this.#disabled) return;
    this.#disabled = true;
    this.#queue.clear();
    clearTimeout(this.#timer);
    this.#opts.onDisable(reason);
  }

  #schedule(ms: number) {
    if (this.#timer || this.#disabled) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush().then(() => {
        if (this.#queue.size) this.#schedule(Math.max(this.#opts.flushIntervalMs, this.#pausedUntil - Date.now()));
      });
    }, ms);
    this.#timer.unref();
  }

  async #sendBatch() {
    // Always send at least one event; stop adding once the batch would pass the size budget.
    const batch: ServerEventInput[] = [];
    const parts: string[] = [];
    let bytes = 0;
    for (const e of this.#queue.values()) {
      const json = JSON.stringify(e);
      if (batch.length && (batch.length >= MAX_BATCH || bytes + json.length > MAX_BATCH_BYTES)) break;
      batch.push(e);
      parts.push(json);
      bytes += json.length + 1;
    }
    for (const e of batch) this.#queue.delete(e.id);
    try {
      const { status, body } = await this.#post(`{"events":[${parts.join(',')}]}`);
      if (status === 401 || status === 403) return this.disable(`collector rejected the request (${status})`);
      // Too large even on its own: retrying cannot help, so count it as dropped.
      if (status === 413) {
        this.dropped += batch.length;
        this.#failures = 0;
        return;
      }
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
      this.#failures = 0;
      if (body?.enabled === false) this.disable('collector asked the SDK to stop (kill switch)');
    } catch {
      // Put the batch back unless newer versions arrived meanwhile; the bound still applies.
      for (const e of batch) if (!this.#queue.has(e.id) && this.#queue.size < this.#opts.maxQueue) this.#queue.set(e.id, e);
      if (++this.#failures >= FAILURES_BEFORE_PAUSE) {
        this.#failures = 0;
        this.#pausedUntil = Date.now() + PAUSE_MS;
      }
    }
  }

  #post(payload: string): Promise<{ status: number; body: { enabled?: boolean } | undefined }> {
    return new Promise((resolve, reject) => {
      const req = request(
        this.#url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
            authorization: `Bearer ${this.#opts.token}`,
          },
          timeout: 2_000,
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => (text += c));
          res.on('end', () => {
            let body: { enabled?: boolean } | undefined;
            try {
              body = JSON.parse(text);
            } catch {
              body = undefined;
            }
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end(payload);
    });
  }
}
