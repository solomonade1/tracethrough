import { exportWarning } from '@tracethrough/core';
import { IPC, type EventBatch, type SessionStatus, type TraceThroughApi } from '../shared/api';

type Listener = (payload: unknown) => void;

/**
 * `TraceThroughApi` over HTTP for local web mode: calls are POSTs to `/api/<name>`, and the main
 * process's pushes (`events`, `status`) arrive on one long-lived NDJSON stream.
 * `onLost` is called when the server stops or no longer accepts this tab's token.
 */
export function createWebApi(token: string, onLost: (reason: string) => void): TraceThroughApi {
  const auth = { authorization: `Bearer ${token}` };
  const listeners = new Map<string, Set<Listener>>();
  let streaming = false;
  /** Whether the current session masks secrets, from the latest status push (picks the export warning). */
  let masked = true;

  async function call<T>(name: string, ...args: unknown[]): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`/api/${name}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch (err) {
      onLost('TraceThrough is not running. Start it again and open the link it prints.');
      throw err;
    }
    if (res.status === 401) onLost('This link has expired. Open the link TraceThrough printed when it started.');
    const body = (await res.json()) as { result?: T; error?: string };
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
    return body.result as T;
  }

  async function stream() {
    let res: Response;
    try {
      res = await fetch('/api/stream', { headers: auth });
    } catch {
      return onLost('TraceThrough is not running. Start it again and open the link it prints.');
    }
    if (res.status === 401) return onLost('This link has expired. Open the link TraceThrough printed when it started.');
    if (!res.ok || !res.body) return onLost(`Could not connect to TraceThrough (${res.status}).`);

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        let end: number;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line) continue;
          const { channel, payload } = JSON.parse(line) as { channel: string; payload: unknown };
          if (channel === IPC.status) masked = (payload as SessionStatus).masked ?? true;
          for (const listener of listeners.get(channel) ?? []) listener(payload);
        }
      }
    } catch {
      // Connection dropped mid-read; reported below.
    }
    onLost('TraceThrough stopped. Start it again and open the link it prints.');
  }

  function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
    const set = listeners.get(channel) ?? new Set<Listener>();
    listeners.set(channel, set);
    set.add(listener as Listener);
    // Start streaming once someone listens, so the initial status and snapshot are not missed.
    if (!streaming) {
      streaming = true;
      void stream();
    }
    return () => set.delete(listener as Listener);
  }

  return {
    startSession: (url, options) => call('start', url, options),
    stopSession: () => call('stop'),
    clearSession: () => call('clear'),
    async exportSession(format) {
      const data = await call<string | null>('export', format);
      const question = masked ? 'Export sanitized session?' : 'Export session with unmasked secrets?';
      if (!data || !confirm(`${question}\n\n${exportWarning(masked)}`)) return { saved: false };
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const name = `tracethrough-${stamp}.${format === 'har' ? 'har' : 'json'}`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      return { saved: true, path: `${name} (your browser's downloads)` };
    },
    getConnectInfo: () => call('connectInfo'),
    regenerateToken: () => call('regenerateToken'),
    getEnvironment: () => call('environment'),
    onEvents: (listener) => subscribe<EventBatch>(IPC.events, listener),
    onStatus: (listener) => subscribe<SessionStatus>(IPC.status, listener),
  };
}
