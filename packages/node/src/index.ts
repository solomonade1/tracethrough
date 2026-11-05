import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import diagnostics from 'node:diagnostics_channel';
import type { IncomingMessage } from 'node:http';
import {
  createRedactor,
  newSpanId,
  normalizeMime,
  parseTraceparent,
  unavailableBody,
  type BodyPreview,
  type RedactionPolicy,
  type ServerEventInput,
} from '@tracethrough/core';
import { DEFAULT_SERVER_BODY_BYTES, MAX_SERVER_BODY_BYTES, createBodyReader } from './bodies.ts';
import { Exporter } from './exporter.ts';

export interface TraceThroughNodeOptions {
  /** Defaults to TRACETHROUGH_COLLECTOR_URL. Must be a loopback http URL in v1. */
  collectorUrl?: string;
  /** Defaults to TRACETHROUGH_TOKEN. */
  token?: string;
  /** Allow running when NODE_ENV=production (or set TRACETHROUGH_ALLOW_PRODUCTION=1). */
  allowProduction?: boolean;
  /** Only record calls to these hosts (exact hostname or pattern). Default: all hosts. */
  allowTargets?: readonly (string | RegExp)[];
  /**
   * Mask values in the SDK before they leave the process. Default `false`: headers, URLs and bodies
   * are sent as captured to the local collector, and the TraceThrough app decides per session
   * whether to mask them ("Mask secrets").
   */
  redaction?: RedactionPolicy | false;
  /** Capture request and response body previews (default true; TRACETHROUGH_CAPTURE_BODIES=0 turns it off). */
  captureBodies?: boolean;
  /** Max bytes of each body preview (default 64 KB, at most 512 KB). Longer bodies are truncated. */
  maxBodyBytes?: number;
  flushIntervalMs?: number;
  maxQueue?: number;
  logger?: Pick<Console, 'warn'>;
  /**
   * Framework hook: the incoming request currently being handled, if the framework tracks it
   * itself. When it returns a value it takes precedence over the SDK's own tracking, because a
   * framework that defers work (e.g. Next.js dev compiling a page) can run it outside the
   * original request's async context.
   */
  requestContext?: () => FrameworkRequestContext | undefined;
}

export interface FrameworkRequestContext {
  /** Raw incoming `traceparent` header, if any. */
  traceparent?: string;
  /** Request path including query, e.g. "/products?page=2". */
  path?: string;
}

export interface TraceThroughHandle {
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
  /** Headers have been reported, so later updates (bodies, trailers) must be re-sent. */
  sent?: boolean;
}

/** One `fetch()` call: the undici requests it made (redirects add more) and its request body. */
interface FetchScope {
  flights: InFlight[];
  requestBody?: BodyPreview;
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
const REGISTERED = Symbol.for('tracethrough.node.handle');

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

function disabledHandle(reason: string): TraceThroughHandle {
  return { enabled: false, disabledReason: reason, dropped: 0, flush: async () => {}, shutdown: async () => {} };
}

function checkConfig(opts: TraceThroughNodeOptions): { url: string; token: string } | string {
  const env = process.env;
  if (env.TRACETHROUGH_DISABLED === '1') return 'TRACETHROUGH_DISABLED=1';
  const url = opts.collectorUrl ?? env.TRACETHROUGH_COLLECTOR_URL;
  const token = opts.token ?? env.TRACETHROUGH_TOKEN;
  if (!url || !token) return 'TRACETHROUGH_COLLECTOR_URL and TRACETHROUGH_TOKEN are not set';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'collector URL is invalid';
  }
  if (parsed.protocol !== 'http:' || !LOOPBACK.has(parsed.hostname)) {
    return 'collector URL must be a loopback http:// address (remote collection is not supported)';
  }
  if (env.NODE_ENV === 'production' && !opts.allowProduction && env.TRACETHROUGH_ALLOW_PRODUCTION !== '1') {
    return 'NODE_ENV=production (set TRACETHROUGH_ALLOW_PRODUCTION=1 to opt in)';
  }
  return { url, token };
}

/**
 * Starts App Connect instrumentation for this process. Idempotent: later calls return the
 * first handle. Never throws and never blocks the application's own requests.
 */
export function register(opts: TraceThroughNodeOptions = {}): TraceThroughHandle {
  const g = globalThis as { [REGISTERED]?: TraceThroughHandle };
  if (g[REGISTERED]) return g[REGISTERED];

  const logger = opts.logger ?? console;
  const config = checkConfig(opts);
  if (typeof config === 'string') {
    if (process.env.TRACETHROUGH_COLLECTOR_URL || opts.collectorUrl) logger.warn(`[tracethrough] App Connect disabled: ${config}`);
    return disabledHandle(config);
  }

  const redactor = createRedactor(opts.redaction ?? false);
  const context = new AsyncLocalStorage<RequestContext>();
  const fetchScope = new AsyncLocalStorage<FetchScope>();
  const inflight = new WeakMap<object, InFlight>();
  const captureBodies = (opts.captureBodies ?? true) && process.env.TRACETHROUGH_CAPTURE_BODIES !== '0';
  const maxBodyBytes = Math.min(Math.max(1, Math.floor(opts.maxBodyBytes ?? DEFAULT_SERVER_BODY_BYTES)), MAX_SERVER_BODY_BYTES);
  const bodies = createBodyReader(redactor, maxBodyBytes);
  let disabledReason: string | undefined;

  const exporter = new Exporter({
    collectorUrl: config.url,
    token: config.token,
    flushIntervalMs: opts.flushIntervalMs ?? 250,
    maxQueue: opts.maxQueue ?? 1000,
    onDisable: (reason) => {
      disabledReason = reason;
      unsubscribe();
      logger.warn(`[tracethrough] App Connect stopped: ${reason}`);
    },
  });

  const allowed = (host: string) =>
    !opts.allowTargets?.length || opts.allowTargets.some((t) => (typeof t === 'string' ? t === host : t.test(host)));

  const redactPath = (path: string) => redactor.url(`http://handler${path}`).value.slice('http://handler'.length);

  // --- incoming requests: establish trace context for the handler's async lifetime ---------
  const onServerRequest = (message: unknown) => {
    const { request } = message as { request: IncomingMessage };
    const ctx = parseTraceparent(request.headers.traceparent);
    // Always enter (even with an empty store) so context never carries over between keep-alive requests.
    context.enterWith({ traceId: ctx?.traceId, handler: `${request.method} ${redactPath(request.url ?? '/')}` });
  };

  /** The framework's view of the current request wins when it has one (see `requestContext`). */
  const currentContext = (): RequestContext | undefined => {
    const own = context.getStore();
    let framework: FrameworkRequestContext | undefined;
    try {
      framework = opts.requestContext?.();
    } catch {
      framework = undefined;
    }
    if (!framework) return own;
    const path = framework.path !== undefined ? redactPath(framework.path) : undefined;
    // Our handler label includes the method; keep it when it describes the same request.
    const handler = own?.handler && path && own.handler.endsWith(` ${path}`) ? own.handler : path;
    return { traceId: parseTraceparent(framework.traceparent)?.traceId, handler };
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
    const store = currentContext();
    const headers = redactor.headers(requestHeaders(request.headers));
    const safeUrl = redactor.url(url.href);
    const scope = fetchScope.getStore();
    const flight: InFlight = {
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
        requestBody: scope?.requestBody,
        redactionApplied: safeUrl.redacted || headers.redacted,
      },
    };
    inflight.set(request, flight);
    scope?.flights.push(flight);
  };

  /** Merges a late update (a body read after the headers arrived) and re-sends it if already reported. */
  const update = (f: InFlight, patch: Partial<ServerEventInput>) => {
    f.event = { ...f.event, ...patch };
    if (f.sent) exporter.push(f.event);
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
      // The fetch wrapper fills the body in once it has been read (or reports why it was not).
      responseBody:
        f.event.responseBody ??
        (captureBodies
          ? undefined
          : unavailableBody('omitted-by-policy', normalizeMime(raw['content-type']), Number.isFinite(length) ? length : undefined)),
      redactionApplied: f.event.redactionApplied || headers.redacted,
    };
    f.sent = true;
    exporter.push(f.event);
  };

  const onTrailers = (message: unknown) => {
    const { request } = message as { request: object };
    const f = inflight.get(request);
    if (!f) return;
    inflight.delete(request);
    const end = performance.now();
    f.sent = true;
    update(f, {
      durationMs: round(end - f.start),
      timing: { ...f.event.timing, downloadMs: f.headersAt ? round(end - f.headersAt) : undefined },
    });
  };

  const onError = (message: unknown) => {
    const { request, error } = message as { request: object; error: Error & { code?: string; cause?: { code?: string } } };
    const f = inflight.get(request);
    if (!f) return;
    inflight.delete(request);
    f.sent = true;
    update(f, {
      state: 'failed',
      durationMs: round(performance.now() - f.start),
      error: { code: error.code ?? error.cause?.code, message: redactor.url(error.message).value },
    });
  };

  // --- bodies: undici's diagnostics channels carry no body bytes, so wrap fetch itself ---------
  const originalFetch = globalThis.fetch;
  const readRequestBody = (scope: FetchScope, input: unknown, init: RequestInit | undefined) =>
    bodies.request(input, init).then(
      (body) => {
        if (!body) return;
        scope.requestBody = body;
        for (const f of scope.flights) update(f, { requestBody: body });
      },
      () => {},
    );
  const readResponseBody = (scope: FetchScope, res: Response) => {
    // Redirects create one undici request each; the response belongs to the last one.
    const f = scope.flights.at(-1);
    if (!f) return; // Not an undici request we observed (e.g. served from a framework cache).
    void bodies.response(res).then(
      (body) => update(f, { responseBody: body }),
      () => update(f, { responseBody: unavailableBody('read-failed', normalizeMime(res.headers.get('content-type') ?? undefined)) }),
    );
  };
  const wrappedFetch = function fetch(this: unknown, input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) {
    if (!subscribed) return originalFetch.call(this, input, init);
    const scope: FetchScope = { flights: [] };
    return fetchScope.run(scope, () => {
      // Read the request body before fetch starts consuming it; never let it delay or break the call.
      try {
        void readRequestBody(scope, input, init);
      } catch {
        /* ignore */
      }
      const pending = originalFetch.call(this, input, init);
      void pending.then(
        (res) => {
          try {
            readResponseBody(scope, res);
          } catch {
            /* ignore */
          }
        },
        () => {},
      );
      return pending;
    });
  } as typeof globalThis.fetch;
  // Frameworks tag fetch with their own properties (Next.js: __nextPatched); keep them visible.
  if (typeof originalFetch === 'function') {
    Object.defineProperties(wrappedFetch, Object.getOwnPropertyDescriptors(originalFetch));
  }
  const fetchWrapped = captureBodies && typeof originalFetch === 'function';
  if (fetchWrapped) globalThis.fetch = wrappedFetch;

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
    // Put fetch back unless something wrapped it after us (then ours stays a harmless pass-through).
    if (fetchWrapped && globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
  }

  const handle: TraceThroughHandle = {
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
