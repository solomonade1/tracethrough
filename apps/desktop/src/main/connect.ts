import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { generateToken, startCollector, type Collector } from '@tracelens/collector';
import type { ServerEventInput } from '@tracelens/core';
import type { ConnectInfo } from '../shared/api';

interface ConnectOptions {
  /** File holding the persisted collector token (inside the app's userData directory). */
  tokenFile: string;
  /** Overrides for development and tests. */
  port?: number;
  token?: string;
  ingest(events: readonly ServerEventInput[]): number;
}

/**
 * Owns the App Connect collector for the app's lifetime. The token persists across launches so a
 * developer's `.env` keeps working; regenerating it immediately locks out SDKs using the old one.
 */
export class ConnectService {
  #collector: Collector | undefined;
  #error: string | undefined;
  #received = 0;
  #ignored = 0;

  constructor(private readonly opts: ConnectOptions) {}

  async start(): Promise<void> {
    const token = this.opts.token ?? (await this.#loadToken());
    await this.#listen(token);
  }

  async regenerate(): Promise<ConnectInfo> {
    const token = generateToken();
    await this.#saveToken(token);
    await this.#collector?.close();
    this.#collector = undefined;
    await this.#listen(token);
    return this.info();
  }

  info(): ConnectInfo {
    return {
      listening: !!this.#collector,
      collectorUrl: this.#collector?.url,
      token: this.#collector?.token,
      received: this.#received,
      ignored: this.#ignored,
      error: this.#error,
    };
  }

  async close(): Promise<void> {
    await this.#collector?.close();
    this.#collector = undefined;
  }

  async #listen(token: string) {
    try {
      this.#collector = await startCollector({
        port: this.opts.port,
        token,
        onEvents: (events) => {
          const accepted = this.opts.ingest(events);
          this.#received += accepted;
          this.#ignored += events.length - accepted;
        },
      });
      this.#error = undefined;
    } catch (err) {
      this.#error = `Collector could not start: ${(err as Error).message}`;
    }
  }

  async #loadToken(): Promise<string> {
    try {
      const saved = JSON.parse(await readFile(this.opts.tokenFile, 'utf8')) as { token?: unknown };
      if (typeof saved.token === 'string' && saved.token.length >= 24) return saved.token;
    } catch {
      // First launch or unreadable file: mint a new token.
    }
    const token = generateToken();
    await this.#saveToken(token);
    return token;
  }

  async #saveToken(token: string) {
    await mkdir(dirname(this.opts.tokenFile), { recursive: true });
    await writeFile(this.opts.tokenFile, JSON.stringify({ token }), { encoding: 'utf8', mode: 0o600 });
  }
}
