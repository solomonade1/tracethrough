import type { ConnectInfo } from '../../../shared/api';

/** Collector counters when verification began; only changes since then count as evidence. */
export interface VerifyBase {
  received: number;
  ignored: number;
  rejected: number;
  at: number;
}

export type VerifyState = 'waiting' | 'detected' | 'connected' | 'issue' | 'none';

export interface Verification {
  state: VerifyState;
  title: string;
  detail: string;
  /** True when the collector itself is down or unreachable (as opposed to the SDK not reaching it). */
  collectorProblem: boolean;
}

/** How long to wait for a first server event before saying none arrived. */
export const NO_EVENTS_AFTER_MS = 30_000;

export function baseFrom(info: ConnectInfo | undefined, now: number): VerifyBase {
  return { received: info?.received ?? 0, ignored: info?.ignored ?? 0, rejected: info?.rejected ?? 0, at: now };
}

/**
 * Turns real collector counters into the state shown on the Verify step. Nothing is simulated: every state
 * except "waiting" needs the collector to have counted something since verification began.
 */
export function deriveVerification(input: { info?: ConnectInfo; unreachable?: boolean; base?: VerifyBase; now: number }): Verification {
  const { info, unreachable, base, now } = input;
  if (unreachable) {
    return { state: 'issue', collectorProblem: true, title: 'Connection issue', detail: 'TraceThrough could not read the collector status. Restart TraceThrough and try again.' };
  }
  if (!info) return { state: 'waiting', collectorProblem: false, title: 'Waiting for connection', detail: 'Checking the collector…' };
  if (!info.listening) {
    return {
      state: 'issue',
      collectorProblem: true,
      title: 'Connection issue',
      detail: info.error ?? 'The collector is not running, so your app has nowhere to send events. Restart TraceThrough.',
    };
  }
  const b = base ?? baseFrom(info, now);
  if (info.received > b.received) {
    return {
      state: 'connected',
      collectorProblem: false,
      title: 'Connected and receiving requests',
      detail: `${info.received - b.received} server request${info.received - b.received === 1 ? '' : 's'} received from your app.`,
    };
  }
  if (info.ignored > b.ignored) {
    return {
      state: 'detected',
      collectorProblem: false,
      title: 'SDK activity detected',
      detail: 'Your app is reaching the collector, but no session was recording, so those requests were not kept. Start a session for your app with “This is my app” ticked.',
    };
  }
  if (info.rejected > b.rejected) {
    return {
      state: 'issue',
      collectorProblem: false,
      title: 'Connection issue',
      detail: `The collector refused ${info.rejected - b.rejected} request${info.rejected - b.rejected === 1 ? '' : 's'}. This is usually a wrong token or collector URL.`,
    };
  }
  if (now - b.at >= NO_EVENTS_AFTER_MS) {
    return {
      state: 'none',
      collectorProblem: false,
      title: 'No server events yet',
      detail: 'Nothing has reached the collector. Check your SDK setup below, then make a server-side request and retry.',
    };
  }
  return { state: 'waiting', collectorProblem: false, title: 'Waiting for connection', detail: 'Start or restart your app, then load a page that makes a server-side fetch.' };
}
