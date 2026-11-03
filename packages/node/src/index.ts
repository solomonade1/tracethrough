import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import diagnostics from 'node:diagnostics_channel';
import type { IncomingMessage } from 'node:http';
import {
  DEFAULT_REDACTION_POLICY,
  createRedactor,
  newSpanId,
  normalizeMime,
  parseTraceparent,
  unavailableBody,
  type RedactionPolicy,
  type ServerEventInput,
} from '@tracelens/core';
import { Exporter } from './exporter.js';

export interface TraceLensNodeOptions {
  /** Defaults to TRACELENS_COLLECTOR_URL. Must be a loopback http URL in v1. */
  collectorUrl?: string;
  /** Defaults to TRACELENS_TOKEN. */
  token?: string;
  /** Allow running when NODE_ENV=production (or set TRACELENS_ALLOW_PRODUCTION=1). */
  allowProduction?: boolean;
  /** Only record calls to these hosts (exact hostname or pattern). Default: all hosts. */
  allowTargets?: readonly (string | RegExp)[];
  redaction?: RedactionPolicy;
  flushIntervalMs?: number;
  maxQueue?: number;
  logger?: Pick<Console, 'warn'>;
}

export interface TraceLensHandle {
  readonly enabled: boolean;
  /** Why the SDK is (or became) inactive. */
  readonly disabledReason: string | undefined;
  /** Events discarded because the queue was full. */
  readonly dropped: number;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

interface RequestContext {
  traceId?: string;
  handler?: string;
}

interface InFlight {
  event: ServerEventInput;
  start: number;
  headersAt?: number;
}

/** Shape of undici's diagnostics `request` object (Node's fetch). Headers are an array or a raw string depending on version. */
interface UndiciRequest {
  origin: string | URL;
  path: string;
  method: string;
  headers: string[] | string;
}
interface UndiciResponse {
  statusCode: number;
  statusText?: string;
  headers: Buffer[];
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const REGISTERED = Symbol.for('tracelens.node.handle');

function pairsToRecord(pairs: readonly (string | Buffer)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const k = String(pairs[i]).toLowerCase();
    const v = String(pairs[i + 1]);
    out[k] = k in out ? `${out[k]}\n${v}` : v;
  }
  return out;
}

function requestHeaders(raw: string[] | string): Record<string, string> {
  if (Array.isArray(raw)) return pairsToRecord(raw);
  return pairsToRecord(
    raw.split('\r\n').flatMap((line) => {
      const i = line.indexOf(':');
      return i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1).trim()] : [];
    }),
  );
}

function disabledHandle(reason: string): TraceLensHandle {
  return { enabled: false, disabledReason: reason, dropped: 0, flush: async () => {}, shutdown: async () => {} };
}

function checkConfig(opts: TraceLensNodeOptions): { url: string; token: string } | string {
  const env = process.env;
  if (env.TRACELENS_DISABLED === '1') return 'TRACELENS_DISABLED=1';
  const url = opts.collectorUrl ?? env.TRACELENS_COLLECTOR_URL;
  const token = opts.token ?? env.TRACELENS_TOKEN;
  if (!url || !token) return 'TRACELENS_COLLECTOR_URL and TRACELENS_TOKEN are not set';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'collector URL is invalid';
  }
  if (parsed.protocol !== 'http:' || !LOOPBACK.has(parsed.hostname)) {
    return 'collector URL must be a loopback http:// address (remote collection is not supported)';
  }
  if (env.NODE_ENV === 'production' && !opts.allowProduction && env.TRACELENS_ALLOW_PRODUCTION !== '1') {
    return 'NODE_ENV=production (set TRACELENS_ALLOW_PRODUCTION=1 to opt in)';
  }
  return { url, token };
}

/**
 * Starts App Connect instrumentation for this process. Idempotent: later calls return the
 * first handle. Never throws and never blocks the application's own requests.
 */
export function register(opts: TraceLensNodeOptions = {}): TraceLensHandle {
  const g = globalThis as { [REGISTERED]?: TraceLensHandle };
  if (g[REGISTERED]) return g[REGISTERED];

  const logger = opts.logger ?? console;
  const config = checkConfig(opts);
  if (typeof config === 'string') {
    if (process.env.TRACELENS_COLLECTOR_URL || opts.collectorUrl) logger.warn(`[tracelens] App Connect disabled: ${config}`);
    return disabledHandle(config);
  }

  const redactor = createRedactor(opts.redaction ?? DEFAULT_REDACTION_POLICY);
  const context = new AsyncLocalStorage<RequestContext>();
  const inflight = new WeakMap<object, InFlight>();
  let disabledReason: string | undefined;

  const exporter = new Exporter({
    collectorUrl: config.url,
    token: config.token,
    flushIntervalMs: opts.flushIntervalMs ?? 250,
    maxQueue: opts.maxQueue ?? 1000,
    onDisable: (reason) => {
      disabledReason = reason;
      unsubscribe();
      logger.warn(`[tracelens] App Connect stopped: ${reason}`);
    },
  });

  const allowed = (host: string) =>
    !opts.allowTargets?.length || opts.allowTargets.some((t) => (typeof t === 'string' ? t === host : t.test(host)));

  // --- incoming requests: establish trace context for the handler's async lifetime ---------
  const onServerRequest = (message: unknown) => {
    const { request } = message as { request: IncomingMessage };
    const ctx = parseTraceparent(request.headers.traceparent);
    const path = redactor.url(`http://handler${request.url ?? '/'}`).value.slice('http://handler'.length);
    // Always enter (even with an empty store) so context never carries over between keep-alive requests.
    context.enterWith({ traceId: ctx?.traceId, handler: `${request.method} ${path}` });
  };

  // --- outgoing fetch (undici) ----------------------------------------------------------------
  const onCreate = (message: unknown) => {
    const { request } = message as { request: UndiciRequest };
    const origin = String(request.origin).replace(/\/$/, '');
    let url: URL;
    try {
      url = new URL(origin + request.path);
    } catch {
      return;
    }
    if (!allowed(url.hostname)) return;
    const store = context.getStore();
    const headers = redactor.headers(requestHeaders(request.headers));
    const safeUrl = redactor.url(url.href);
    inflight.set(request, {
      start: performance.now(),
      event: {
        id: randomUUID(),
        state: 'pending',
        timestamp: new Date().toISOString(),
        method: request.method,
        urlSanitized: safeUrl.value,
        domain: url.hostname,
        type: 'fetch',
        resourceType: 'server-fetch',
        requestHeadersSanitized: headers.value,
        isNavigation: false,
        traceId: store?.traceId,
        spanId: newSpanId(),
        handler: store?.handler,
        redactionApplied: safeUrl.redacted || headers.redacted,
      },
    });
  };

  const onHeaders = (message: unknown) => {
    const { request, response } = message as { request: object; response: UndiciResponse };
    const f = inflight.get(request);
    if (!f) return;
    f.headersAt = performance.now();
    const raw = pairsToRecord(response.headers);
    const headers = redactor.headers(raw);
    const length = Number(raw['content-length']);
    f.event = {
      ...f.event,
      state: 'complete',
      status: response.statusCode,
      statusText: response.statusText,
      durationMs: round(f.headersAt - f.start),
      timing: { ttfbMs: round(f.headersAt - f.start) },
      responseHeadersSanitized: headers.value,
      // v1 is metadata-only: server bodies are never read (RFC-001).
      responseBody: unavailableBody('omitted-by-policy', normalizeMime(raw['content-type']), Number.isFinite(length) ? length : undefined),
      redactionApplied: f.event.redactionApplied || headers.redacted,
    };
    exporter.push(f.event);
  };

  const onTrailers = (message: unknown) => {
    const { request } = message as { request: object };
    const f = inflight.get(request);
    if (!f) return;
    inflight.delete(request);
    const end = performance.now();
    exporter.push({
      ...f.event,
      durationMs: round(end - f.start),
      timing: { ...f.event.timing, downloadMs: f.headersAt ? round(end - f.headersAt) : undefined },
    });
  };

  const onError = (message: unknown) => {
    const { request, error } = message as { request: object; error: Error & { code?: string; cause?: { code?: string } } };
    const f = inflight.get(request);
    if (!f) return;
    inflight.delete(request);
    exporter.push({
      ...f.event,
      state: 'failed',
      durationMs: round(performance.now() - f.start),
      error: { code: error.code ?? error.cause?.code, message: redactor.url(error.message).value },
    });
  };

  const subscriptions: [string, (m: unknown) => void][] = [
    ['http.server.request.start', onServerRequest],
    ['undici:request:create', onCreate],
    ['undici:request:headers', onHeaders],
    ['undici:request:trailers', onTrailers],
    ['undici:request:error', onError],
  ];
  // Instrumentation must never break the host app.
  const guarded = subscriptions.map(([name, fn]) => {
    const safe = (m: unknown) => {
      try {
        fn(m);
      } catch {
        /* ignore */
      }
    };
    diagnostics.subscribe(name, safe);
    return [name, safe] as const;
  });
  let subscribed = true;
  function unsubscribe() {
    if (!subscribed) return;
    subscribed = false;
    for (const [name, fn] of guarded) diagnostics.unsubscribe(name, fn);
  }

  const handle: TraceLensHandle = {
    get enabled() {
      return disabledReason === undefined;
    },
    get disabledReason() {
      return disabledReason;
    },
    get dropped() {
      return exporter.dropped;
    },
    flush: () => exporter.flush(),
    async shutdown() {
      unsubscribe();
      await exporter.flush();
      disabledReason ??= 'shut down';
      delete g[REGISTERED];
    },
  };
  g[REGISTERED] = handle;
  return handle;
}

function round(ms: number) {
  return Math.round(ms * 10) / 10;
}
