import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Response, type Route } from 'playwright';
import {
  DEFAULT_BODY_LIMITS,
  DEFAULT_REDACTION_POLICY,
  SessionBuffer,
  applyBodyPolicy,
  buildBodyPreview,
  createRedactor,
  formatTraceparent,
  isMultipartMime,
  isTextualMime,
  omitsMultipart,
  newTraceContext,
  normalizeMime,
  unavailableBody,
  type BodyLimits,
  type BodyPreview,
  type NetworkEvent,
  type RedactionPolicy,
  type Redactor,
  type RequestType,
  type ServerEventInput,
  type Timing,
  type TraceContext,
} from '@tracethrough/core';
import { findBrowsers, type BrowserChannel } from './browsers.ts';
import { Limiter } from './limiter.ts';

export interface CaptureOptions {
  url: string;
  /** Headed is the default: the developer browses the site interactively. */
  headless?: boolean;
  /** Omit to use the first detected of bundled Chromium, Chrome, Edge. */
  channel?: BrowserChannel;
  /** Masking policy; `false` keeps headers, URLs and bodies exactly as captured. Default: masked. */
  redaction?: RedactionPolicy | false;
  bodyLimits?: BodyLimits;
  /**
   * Responses whose declared size (Content-Length, or the transfer size the browser reports)
   * exceeds this are not read at all. Playwright cannot cap a read in progress: a body of unknown
   * or understated size is still fetched whole and only then discarded, so this limit is a
   * pre-read filter, not a hard memory bound.
   */
  maxBodyReadBytes?: number;
  /** Ring-buffer capacity; older exchanges are dropped (and counted) beyond this. */
  maxEvents?: number;
  /**
   * Retention budget in estimated serialized event bytes (default 128 MiB). Oldest exchanges are
   * dropped (and counted) beyond it. This bounds what the session keeps, not process memory.
   */
  maxBufferBytes?: number;
  /** How many response bodies may be fetched from the browser at once (default 4). */
  maxConcurrentBodyReads?: number;
  /**
   * App Connect: an origin the developer owns (e.g. "http://localhost:3000"). Requests to it get a
   * fresh W3C `traceparent` so server events can be linked. Never applied to other origins.
   * Note: Playwright routing bypasses the HTTP cache for these requests.
   */
  connectedOrigin?: string;
}

export class InvalidTargetUrlError extends Error {}

/** URL-01: only absolute http(s) URLs may start a session. */
export function validateTargetUrl(input: string): URL {
  let url: URL;
  try {
    // The URL box is prefilled with "https://", so a pasted full URL arrives as "https://https://host".
    url = new URL(input.trim().replace(/^(?:https?:\/\/)+(?=https?:\/\/)/i, ''));
  } catch {
    throw new InvalidTargetUrlError(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidTargetUrlError(`Unsupported scheme "${url.protocol}" — only http and https are allowed`);
  }
  return url;
}

async function launchBrowser(headless: boolean, channel?: BrowserChannel) {
  // Detected browsers first; if detection finds nothing (unusual install path), still try each.
  const detected = findBrowsers();
  const candidates: BrowserChannel[] = channel ? [channel] : detected.length ? detected : ['chromium', 'chrome', 'msedge'];
  const errors: string[] = [];
  for (const c of candidates) {
    try {
      const browser = await chromium.launch({ headless, channel: c === 'chromium' ? undefined : c });
      return { browser, channel: c };
    } catch (err) {
      errors.push(`${c}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  throw new Error(`Could not start a browser. Install Google Chrome or Microsoft Edge and try again.\n${errors.join('\n')}`);
}

function toRequestType(resourceType: string): RequestType {
  switch (resourceType) {
    case 'document':
    case 'fetch':
    case 'xhr':
      return resourceType;
    case 'stylesheet':
    case 'script':
    case 'image':
    case 'font':
    case 'media':
    case 'texttrack':
    case 'manifest':
      return 'asset';
    default:
      return 'other';
  }
}

function toTiming(t: ReturnType<Request['timing']>): Timing {
  const span = (a: number, b: number) => (a >= 0 && b >= 0 && b >= a ? Math.round((b - a) * 10) / 10 : undefined);
  return {
    dnsMs: span(t.domainLookupStart, t.domainLookupEnd),
    connectMs: span(t.connectStart, t.connectEnd),
    tlsMs: span(t.secureConnectionStart, t.connectEnd),
    ttfbMs: span(t.requestStart, t.responseStart),
    downloadMs: span(t.responseStart, t.responseEnd),
  };
}

const FAILURE_MESSAGES: [RegExp, string][] = [
  [/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/, 'DNS lookup failed'],
  [/ERR_CONNECTION_REFUSED/, 'Connection refused'],
  [/ERR_CONNECTION_(RESET|CLOSED)/, 'Connection reset by peer'],
  [/ERR_(CONNECTION_)?TIMED_OUT/, 'Timed out'],
  [/ERR_CERT_|ERR_SSL_/, 'TLS / certificate error'],
  [/ERR_BLOCKED_BY_(CLIENT|RESPONSE|ORB)/, 'Blocked by the browser'],
  [/ERR_ABORTED/, 'Cancelled (navigation, abort or page close)'],
  [/ERR_INTERNET_DISCONNECTED/, 'No network connection'],
  [/ERR_FAILED/, 'Request failed (commonly CORS or a blocked request)'],
];

function describeFailure(errorText: string): string {
  return FAILURE_MESSAGES.find(([re]) => re.test(errorText))?.[1] ?? errorText;
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

/** Replaces a body's preview, leaving an already-omitted body (no preview) exactly as it is. */
function withPreview(body: BodyPreview, preview: string | undefined): BodyPreview {
  return body.preview === undefined ? body : { ...body, preview };
}

/**
 * Normalizes the version string Playwright reports ("HTTP/1.1", "HTTP/2.0", "h3"…) to the
 * event's lower-case ALPN-style protocol id. Unrecognized or empty values are dropped rather
 * than guessed.
 */
export function toProtocol(httpVersion: string | undefined): string | undefined {
  const v = httpVersion?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'h2' || v === 'http/2' || v === 'http/2.0') return 'h2';
  if (v === 'h3' || v === 'http/3' || v === 'http/3.0') return 'h3';
  if (v === 'http/1.1' || v === 'http/1.0' || v === 'http/0.9') return v;
  return undefined;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * One isolated browser context capturing every request made by its pages, popups and
 * service workers. Events are masked before they leave this class unless masking is off.
 */
export class CaptureSession extends EventEmitter<{ event: [NetworkEvent]; evicted: [id: string]; closed: [] }> {
  readonly id = randomUUID();
  readonly buffer: SessionBuffer;

  readonly #browser: Browser;
  readonly #context: BrowserContext;
  readonly #redactor: Redactor;
  readonly #bodyLimits: BodyLimits;
  readonly #maxBodyReadBytes: number;
  readonly #bodyReads: Limiter;
  readonly #ids = new WeakMap<Request, string>();
  readonly #startedAt = new WeakMap<Request, number>();
  readonly #navigationByPage = new WeakMap<Page, string>();
  readonly #inFlight = new Set<Promise<void>>();
  readonly #traces = new WeakMap<Request, TraceContext>();
  /** Origin that receives `traceparent` (App Connect), normalized; undefined when not connected. */
  readonly connectedOrigin: string | undefined;
  #page: Page | undefined;
  #closed = false;

  private constructor(browser: Browser, context: BrowserContext, readonly channel: BrowserChannel, opts: CaptureOptions) {
    super();
    this.#browser = browser;
    this.#context = context;
    this.connectedOrigin = opts.connectedOrigin ? validateTargetUrl(opts.connectedOrigin).origin : undefined;
    this.#redactor = createRedactor(opts.redaction ?? DEFAULT_REDACTION_POLICY);
    this.#bodyLimits = opts.bodyLimits ?? DEFAULT_BODY_LIMITS;
    this.#maxBodyReadBytes = opts.maxBodyReadBytes ?? 10 * 1024 * 1024;
    this.#bodyReads = new Limiter(opts.maxConcurrentBodyReads ?? 4);
    this.buffer = new SessionBuffer(opts.maxEvents ?? 10_000, opts.maxBufferBytes);

    context.on('request', (req) => this.#onRequest(req));
    context.on('requestfinished', (req) => this.#track(this.#onFinished(req)));
    context.on('requestfailed', (req) => this.#track(this.#onFailed(req)));
    context.on('page', (page) =>
      page.on('close', () => {
        if (context.pages().length === 0) void this.stop();
      }),
    );
    browser.on('disconnected', () => void this.stop());
  }

  /**
   * Launches the isolated browser and opens a blank page, without navigating. Capture is already
   * active, so a caller can attach its listeners (and start accepting App Connect events) before
   * calling {@link navigate}. Disposes the browser if setup fails.
   */
  static async create(opts: CaptureOptions): Promise<CaptureSession> {
    validateTargetUrl(opts.url);
    const headless = opts.headless ?? false;
    const { browser, channel } = await launchBrowser(headless, opts.channel);
    try {
      // A fresh context never shares cookies/storage with the user's own browser profile.
      const context = await browser.newContext({ serviceWorkers: 'allow', viewport: headless ? undefined : null });
      const session = new CaptureSession(browser, context, channel, opts);
      const origin = session.connectedOrigin;
      if (origin) await context.route((url) => url.origin === origin, (route) => session.#injectTrace(route));
      session.#page = await context.newPage();
      return session;
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  }

  /**
   * Starts the initial navigation (resolves once the document response has started). Navigation
   * failures (DNS, TLS…) are captured as failed events, so they do not reject. A no-op once stopped.
   */
  async navigate(url: string): Promise<void> {
    const target = validateTargetUrl(url);
    if (this.#closed) return;
    await this.page.goto(target.href, { waitUntil: 'commit' }).catch(() => {});
  }

  /** {@link create} followed by {@link navigate}. Stops the session if navigation cannot start. */
  static async start(opts: CaptureOptions): Promise<CaptureSession> {
    const session = await CaptureSession.create(opts);
    try {
      await session.navigate(opts.url);
    } catch (err) {
      await session.stop();
      throw err;
    }
    return session;
  }

  get page(): Page {
    if (!this.#page) throw new Error('Session has no page');
    return this.#page;
  }

  /** False when this session keeps values exactly as captured. */
  get masking(): boolean {
    return this.#redactor.masking;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Resolves once every exchange that has finished so far has been fully processed. */
  async settled(): Promise<void> {
    while (this.#inFlight.size) await Promise.allSettled([...this.#inFlight]);
  }

  async stop(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    // Closing the context ends all capture within tens of ms; the browser process can take seconds
    // to exit on Windows, so announce the stop before waiting for it.
    await this.#context.close().catch(() => {});
    this.emit('closed');
    await this.#browser.close().catch(() => {});
  }

  /**
   * Adds a server event reported by an App Connect SDK. The sender is not trusted: source and
   * session are forced, ids are namespaced so they cannot overwrite browser events, and this
   * session's masking policy is applied again (a no-op when masking is off).
   */
  ingestServerEvent(input: ServerEventInput): boolean {
    if (this.#closed) return false;
    const r = this.#redactor;
    const url = r.url(input.urlSanitized);
    const reqHeaders = input.requestHeadersSanitized ? r.headers(input.requestHeadersSanitized) : undefined;
    const resHeaders = input.responseHeadersSanitized ? r.headers(input.responseHeadersSanitized) : undefined;
    // Multipart previews are dropped before anything else sees them (same policy as browser capture).
    const reqSource = applyBodyPolicy(input.requestBody, r, headerValue(input.requestHeadersSanitized, 'content-type'));
    const resSource = applyBodyPolicy(input.responseBody, r, headerValue(input.responseHeadersSanitized, 'content-type'));
    const reqBody = reqSource?.preview !== undefined ? r.body(reqSource.preview, reqSource.mime) : undefined;
    const resBody = resSource?.preview !== undefined ? r.body(resSource.preview, resSource.mime) : undefined;
    const space = input.handler?.indexOf(' ') ?? -1;
    const handler =
      input.handler && space > 0
        ? `${input.handler.slice(0, space)} ${r.url(`http://h${input.handler.slice(space + 1)}`).value.slice('http://h'.length)}`
        : input.handler;
    const error = input.error ? { ...input.error, message: r.url(input.error.message).value } : undefined;

    this.#emit({
      ...input,
      id: `server:${input.id}`,
      sessionId: this.id,
      source: 'server',
      urlSanitized: url.value,
      domain: hostnameOf(url.value) || input.domain,
      requestHeadersSanitized: reqHeaders?.value,
      responseHeadersSanitized: resHeaders?.value,
      requestBody: reqSource && withPreview(reqSource, reqBody?.value),
      responseBody: resSource && withPreview(resSource, resBody?.value),
      handler,
      error,
      isNavigation: false,
      navigationId: undefined,
      redirectedFromId: undefined,
      redactionApplied:
        !!input.redactionApplied || url.redacted || !!reqHeaders?.redacted || !!resHeaders?.redacted || !!reqBody?.redacted || !!resBody?.redacted,
    });
    return true;
  }

  #traceFor(req: Request): TraceContext {
    let t = this.#traces.get(req);
    if (!t) this.#traces.set(req, (t = newTraceContext()));
    return t;
  }

  #isConnected(url: string): boolean {
    if (!this.connectedOrigin) return false;
    try {
      return new URL(url).origin === this.connectedOrigin;
    } catch {
      return false;
    }
  }

  async #injectTrace(route: Route) {
    const req = route.request();
    const traceparent = formatTraceparent(this.#traceFor(req));
    await route.continue({ headers: { ...req.headers(), traceparent } }).catch(() => {});
  }

  #track(p: Promise<void>) {
    this.#inFlight.add(p);
    void p.finally(() => this.#inFlight.delete(p));
  }

  #emit(event: NetworkEvent) {
    if (this.#closed) return;
    for (const id of this.buffer.upsert(event)) this.emit('evicted', id);
    this.emit('event', event);
  }

  #onRequest(req: Request) {
    const id = randomUUID();
    this.#ids.set(req, id);
    this.#startedAt.set(req, Date.now());

    const redirectedFrom = req.redirectedFrom();
    const redirectedFromId = redirectedFrom ? this.#ids.get(redirectedFrom) : undefined;
    const isNavigation = req.isNavigationRequest();

    let navigationId: string | undefined;
    let page: Page | undefined;
    try {
      page = req.frame().page();
    } catch {
      // Service-worker requests have no frame.
    }
    if (page) {
      if (isNavigation && req.frame() === page.mainFrame()) {
        navigationId = (redirectedFromId && this.buffer.get(redirectedFromId)?.navigationId) || randomUUID();
        this.#navigationByPage.set(page, navigationId);
      } else {
        navigationId = this.#navigationByPage.get(page);
      }
    }

    const url = this.#redactor.url(req.url());
    const headers = this.#redactor.headers(req.headers());
    const postData = req.postDataBuffer();
    const requestBody = postData
      ? buildBodyPreview(postData, req.headers()['content-type'], this.#redactor, this.#bodyLimits)
      : undefined;
    const trace = this.#isConnected(req.url()) ? this.#traceFor(req) : undefined;

    this.#emit({
      id,
      sessionId: this.id,
      source: 'browser',
      traceId: trace?.traceId,
      spanId: trace?.spanId,
      state: 'pending',
      timestamp: new Date().toISOString(),
      method: req.method(),
      urlSanitized: url.value,
      domain: hostnameOf(req.url()),
      type: toRequestType(req.resourceType()),
      resourceType: req.resourceType(),
      requestHeadersSanitized: headers.value,
      requestBody: requestBody?.body,
      redirectedFromId,
      navigationId,
      isNavigation,
      fromServiceWorker: req.serviceWorker() ? true : undefined,
      redactionApplied: url.redacted || headers.redacted || !!requestBody?.redacted,
    });
  }

  async #onFinished(req: Request) {
    const id = this.#ids.get(req);
    const base = id ? this.buffer.get(id) : undefined;
    if (!base) return;

    const response = await req.response().catch(() => null);
    const [rawReqHeaders, rawResHeaders] = await Promise.all([
      req.allHeaders().catch(() => req.headers()),
      response?.allHeaders().catch(() => response.headers()) ?? Promise.resolve(undefined),
    ]);
    const reqHeaders = this.#redactor.headers(rawReqHeaders);
    const resHeaders = rawResHeaders ? this.#redactor.headers(rawResHeaders) : undefined;

    let responseBody: { body: BodyPreview; redacted: boolean };
    if (!response || !rawResHeaders) {
      responseBody = { body: unavailableBody('read-failed'), redacted: false };
    } else if (response.status() >= 300 && response.status() < 400 && rawResHeaders['location']) {
      responseBody = { body: unavailableBody('redirect', normalizeMime(rawResHeaders['content-type'])), redacted: false };
    } else {
      responseBody = await this.#readBody(req, response, rawResHeaders);
    }

    // Playwright answers "HTTP/1.1" when the browser did not say, and a service worker's reply is
    // not the network exchange, so only a plain network response counts as an observation.
    const protocol =
      response && !response.fromServiceWorker() ? toProtocol(await response.httpVersion().catch(() => undefined)) : undefined;

    const timing = req.timing();
    const durationMs =
      timing.responseEnd >= 0 ? Math.round(timing.responseEnd * 10) / 10 : Date.now() - (this.#startedAt.get(req) ?? Date.now());

    this.#emit({
      ...base,
      state: 'complete',
      status: response?.status(),
      statusText: response?.statusText(),
      durationMs,
      timing: toTiming(timing),
      protocol,
      requestHeadersSanitized: reqHeaders.value,
      responseHeadersSanitized: resHeaders?.value,
      responseBody: responseBody.body,
      fromServiceWorker: response?.fromServiceWorker() || base.fromServiceWorker,
      redactionApplied: base.redactionApplied || reqHeaders.redacted || !!resHeaders?.redacted || responseBody.redacted,
    });
  }

  async #readBody(req: Request, response: Response, headers: Record<string, string>): Promise<{ body: BodyPreview; redacted: boolean }> {
    const contentType = headers['content-type'];
    const mime = normalizeMime(contentType);
    if (mime === 'text/event-stream') return { body: unavailableBody('streamed', mime), redacted: false };

    const declared = Number(headers['content-length']);
    const declaredSize = headers['content-length'] !== undefined && Number.isFinite(declared) ? declared : undefined;
    // Outcomes decided by the headers alone never need the bytes, so they are not fetched.
    if (omitsMultipart(this.#redactor, contentType)) return { body: unavailableBody('omitted-by-policy', mime, declaredSize), redacted: false };
    if (mime && !isTextualMime(mime) && !isMultipartMime(mime)) return { body: unavailableBody('binary', mime, declaredSize), redacted: false };

    // Advisory pre-read check: the browser knows the transfer size once the request has finished.
    const transferred = await req.sizes().then((s) => s.responseBodySize, () => -1);
    const knownSize = Math.max(declaredSize ?? -1, transferred);
    if (knownSize > this.#maxBodyReadBytes) return { body: unavailableBody('too-large', mime, knownSize), redacted: false };

    let bytes: Buffer;
    try {
      bytes = await this.#bodyReads.run(() => response.body());
    } catch {
      return { body: unavailableBody('read-failed', mime), redacted: false };
    }
    if (bytes.length > this.#maxBodyReadBytes) {
      return { body: unavailableBody('too-large', mime, bytes.length), redacted: false };
    }
    return buildBodyPreview(bytes, contentType, this.#redactor, this.#bodyLimits);
  }

  async #onFailed(req: Request) {
    const id = this.#ids.get(req);
    if (!id || !this.buffer.get(id)) return;
    const durationMs = Date.now() - (this.#startedAt.get(req) ?? Date.now());
    // headers() omits cookies; allHeaders() has the full set when the browser still knows it.
    const raw = await req.allHeaders().catch(() => undefined);
    const base = this.buffer.get(id);
    if (!base) return;
    const headers = raw ? this.#redactor.headers(raw) : undefined;
    const errorText = req.failure()?.errorText ?? 'unknown';
    this.#emit({
      ...base,
      state: 'failed',
      durationMs,
      requestHeadersSanitized: headers?.value ?? base.requestHeadersSanitized,
      error: { code: errorText, message: describeFailure(errorText) },
      redactionApplied: base.redactionApplied || !!headers?.redacted,
    });
  }
}
