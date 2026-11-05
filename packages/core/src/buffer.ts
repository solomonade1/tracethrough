import type { BodyPreview, NetworkEvent } from './schema.ts';

/** Default retention budget per session: 128 MiB of estimated serialized event bytes. */
export const DEFAULT_MAX_BUFFER_BYTES = 128 * 1024 * 1024;

/** Rough per-event cost of the fixed fields, ids and object overhead. */
const EVENT_OVERHEAD_BYTES = 512;

const headersBytes = (h: Record<string, string> | undefined): number => {
  if (!h) return 0;
  let n = 0;
  for (const k in h) n += k.length + (h[k]?.length ?? 0) + 8;
  return n;
};

const bodyBytes = (b: BodyPreview | undefined): number => (b ? 64 + (b.mime?.length ?? 0) + (b.preview?.length ?? 0) : 0);

/**
 * Estimates how many bytes an event adds to the retained data (roughly its serialized size).
 * Body previews and headers dominate, so those are measured by string length and everything else
 * is a flat allowance. It is a retention estimate, not a measurement of process memory.
 */
export function estimateEventBytes(e: NetworkEvent): number {
  return (
    EVENT_OVERHEAD_BYTES +
    e.urlSanitized.length +
    (e.handler?.length ?? 0) +
    (e.error?.message.length ?? 0) +
    headersBytes(e.requestHeadersSanitized) +
    headersBytes(e.responseHeadersSanitized) +
    bodyBytes(e.requestBody) +
    bodyBytes(e.responseBody)
  );
}

interface Entry {
  event: NetworkEvent;
  bytes: number;
}

/**
 * Bounded, insertion-ordered store of exchanges keyed by id. It holds at most `capacity` events
 * and about `maxBytes` of estimated serialized data (see {@link estimateEventBytes}); whenever an
 * insert or an update pushes it past either limit, the oldest exchanges are evicted until both
 * hold. Each eviction is counted as dropped so the UI can show loss instead of hiding it
 * (PRD §11 "Loss handling").
 *
 * The event being inserted or updated is never evicted by its own write, so a single event larger
 * than the whole byte budget is kept alone (the budget is soft by at most that one event) and goes
 * as soon as a newer event arrives. Updates keep an event's position.
 */
export class SessionBuffer {
  readonly #entries = new Map<string, Entry>();
  #bytes = 0;
  #dropped = 0;

  constructor(
    readonly capacity = 10_000,
    readonly maxBytes = DEFAULT_MAX_BUFFER_BYTES,
  ) {
    if (capacity < 1) throw new RangeError('capacity must be >= 1');
    if (!(maxBytes >= 1)) throw new RangeError('maxBytes must be >= 1');
  }

  /** Stores or updates an exchange. Returns the ids evicted to make room, oldest first. */
  upsert(event: NetworkEvent): string[] {
    const bytes = estimateEventBytes(event);
    const previous = this.#entries.get(event.id);
    if (previous) this.#bytes -= previous.bytes;
    this.#entries.set(event.id, { event, bytes });
    this.#bytes += bytes;

    const evicted: string[] = [];
    if (this.#entries.size > this.capacity || this.#bytes > this.maxBytes) {
      for (const [id, entry] of this.#entries) {
        if (this.#entries.size <= this.capacity && this.#bytes <= this.maxBytes) break;
        if (id === event.id) continue;
        this.#entries.delete(id);
        this.#bytes -= entry.bytes;
        this.#dropped++;
        evicted.push(id);
      }
    }
    return evicted;
  }

  get(id: string): NetworkEvent | undefined {
    return this.#entries.get(id)?.event;
  }

  all(): NetworkEvent[] {
    return [...this.#entries.values()].map((e) => e.event);
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Estimated serialized bytes currently retained. */
  get bytes(): number {
    return this.#bytes;
  }

  get dropped(): number {
    return this.#dropped;
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
    this.#dropped = 0;
  }
}
