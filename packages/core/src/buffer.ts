import type { NetworkEvent } from './schema.js';

/**
 * Bounded, insertion-ordered store of exchanges keyed by id. Updates to an existing id keep
 * its position; a new id beyond capacity evicts the oldest exchange and counts it as dropped
 * so the UI can show loss instead of hiding it (PRD §11 "Loss handling").
 */
export class SessionBuffer {
  readonly #events = new Map<string, NetworkEvent>();
  #dropped = 0;

  constructor(readonly capacity = 10_000) {
    if (capacity < 1) throw new RangeError('capacity must be >= 1');
  }

  /** Returns the id of the exchange evicted to make room, if any. */
  upsert(event: NetworkEvent): string | undefined {
    let evicted: string | undefined;
    if (!this.#events.has(event.id) && this.#events.size >= this.capacity) {
      evicted = this.#events.keys().next().value;
      if (evicted !== undefined) this.#events.delete(evicted);
      this.#dropped++;
    }
    this.#events.set(event.id, event);
    return evicted;
  }

  get(id: string): NetworkEvent | undefined {
    return this.#events.get(id);
  }

  all(): NetworkEvent[] {
    return [...this.#events.values()];
  }

  get size(): number {
    return this.#events.size;
  }

  get dropped(): number {
    return this.#dropped;
  }

  clear(): void {
    this.#events.clear();
    this.#dropped = 0;
  }
}
