/** Runs at most `limit` async tasks at once; the rest wait their turn in order. */
export class Limiter {
  #active = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(readonly limit: number) {
    if (!(limit >= 1)) throw new RangeError('limit must be >= 1');
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#active >= this.limit) await new Promise<void>((resolve) => this.#waiting.push(resolve));
    else this.#active++;
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next waiter (active count is unchanged) or free it.
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active--;
    }
  }
}
