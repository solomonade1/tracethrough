import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Response } from 'playwright';
import {
  DEFAULT_BODY_LIMITS,
  DEFAULT_REDACTION_POLICY,
  SessionBuffer,
  buildBodyPreview,
  createRedactor,
  normalizeMime,
  unavailableBody,
  type BodyLimits,
  type BodyPreview,
  type NetworkEvent,
  type RedactionPolicy,
  type Redactor,
  type RequestType,
  type Timing,
} from '@tracelens/core';

/** `chromium` = Playwright's bundled build; `chrome` / `msedge` = the user's installed browser (fresh, isolated profile). */
export type BrowserChannel = 'chromium' | 'chrome' | 'msedge';

export interface CaptureOptions {
  url: string;
  /** Headed is the default: the developer browses the site interactively. */
  headless?: boolean;
  /** Omit to try bundled Chromium, then Chrome, then Edge. */
  channel?: BrowserChannel;
  redaction?: RedactionPolicy;
  bodyLimits?: BodyLimits;
  /** Responses whose Content-Length exceeds this are not read at all. */
  maxBodyReadBytes?: number;
  /** Ring-buffer capacity; older exchanges are dropped (and counted) beyond this. */
  maxEvents?: number;
}

export class InvalidTargetUrlError extends Error {}

/** URL-01: only absolute http(s) URLs may start a session. */
export function validateTargetUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidTargetUrlError(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidTargetUrlError(`Unsupported scheme "${url.protocol}" — only http and https are allowed`);
  }
  return url;
}

async function launchBrowser(headless: boolean, channel?: BrowserChannel) {
  const candidates: BrowserChannel[] = channel ? [channel] : ['chromium', 'chrome', 'msedge'];
  const errors: string[] = [];
  for (const c of candidates) {
    try {
      const browser = await chromium.launch({ headless, channel: c === 'chromium' ? undefined : c });
      return { browser, channel: c };
    } catch (err) {
      errors.push(`${c}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  throw new Error(`No supported Chromium browser could be launched.\n${errors.join('\n')}`);
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

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * One isolated browser context capturing every request made by its pages, popups and
 * service workers. Only redacted events leave this class.
 */
export class CaptureSession extends EventEmitter<{ event: [NetworkEvent]; closed: [] }> {
  readonly id = randomUUID();
  readonly buffer: SessionBuffer;

  readonly #browser: Browser;
  readonly #context: BrowserContext;
  readonly #redactor: Redactor;
  readonly #bodyLimits: BodyLimits;
  readonly #maxBodyReadBytes: number;
  readonly #ids = new WeakMap<Request, string>();
  readonly #startedAt = new WeakMap<Request, number>();
  readonly #navigationByPage = new WeakMap<Page, string>();
  readonly #inFlight = new Set<Promise<void>>();
  #page: Page | undefined;
  #closed = false;

  private constructor(browser: Browser, context: BrowserContext, readonly channel: BrowserChannel, opts: CaptureOptions) {
    super();
    this.#browser = browser;
    this.#context = context;
    this.#redactor = createRedactor(opts.redaction ?? DEFAULT_REDACTION_POLICY);
    this.#bodyLimits = opts.bodyLimits ?? DEFAULT_BODY_LIMITS;
    this.#maxBodyReadBytes = opts.maxBodyReadBytes ?? 10 * 1024 * 1024;
    this.buffer = new SessionBuffer(opts.maxEvents ?? 10_000);

    context.on('request', (req) => this.#onRequest(req));
    context.on('requestfinished', (req) => this.#track(this.#onFinished(req)));
    context.on('requestfailed', (req) => this.#onFailed(req));
    context.on('page', (page) =>
      page.on('close', () => {
        if (context.pages().length === 0) void this.stop();
      }),
    );
    browser.on('disconnected', () => void this.stop());
  }

  static async start(opts: CaptureOptions): Promise<CaptureSession> {
    const target = validateTargetUrl(opts.url);
    const headless = opts.headless ?? false;
    const { browser, channel } = await launchBrowser(headless, opts.channel);
    // A fresh context never shares cookies/storage with the user's own browser profile.
    const context = await browser.newContext({ serviceWorkers: 'allow', viewport: headless ? undefined : null });
    const session = new CaptureSession(browser, context, channel, opts);
    session.#page = await context.newPage();
    // Navigation failures (DNS, TLS…) are captured as failed events, so they do not reject start().
    await session.#page.goto(target.href, { waitUntil: 'commit' }).catch(() => {});
    return session;
  }

  get page(): Page {
    if (!this.#page) throw new Error('Session has no page');
    return this.#page;
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
    await this.#context.close().catch(() => {});
    await this.#browser.close().catch(() => {});
    this.emit('closed');
  }

  #track(p: Promise<void>) {
    this.#inFlight.add(p);
    void p.finally(() => this.#inFlight.delete(p));
  }

  #emit(event: NetworkEvent) {
    if (this.#closed) return;
    this.buffer.upsert(event);
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

    this.#emit({
      id,
      sessionId: this.id,
      source: 'browser',
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
      responseBody = await this.#readBody(response, rawResHeaders);
    }

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
      requestHeadersSanitized: reqHeaders.value,
      responseHeadersSanitized: resHeaders?.value,
      responseBody: responseBody.body,
      fromServiceWorker: response?.fromServiceWorker() || base.fromServiceWorker,
      redactionApplied: base.redactionApplied || reqHeaders.redacted || !!resHeaders?.redacted || responseBody.redacted,
    });
  }

  async #readBody(response: Response, headers: Record<string, string>): Promise<{ body: BodyPreview; redacted: boolean }> {
    const contentType = headers['content-type'];
    const mime = normalizeMime(contentType);
    if (mime === 'text/event-stream') return { body: unavailableBody('streamed', mime), redacted: false };

    const declared = Number(headers['content-length']);
    if (Number.isFinite(declared) && declared > this.#maxBodyReadBytes) {
      return { body: unavailableBody('too-large', mime, declared), redacted: false };
    }
    let bytes: Buffer;
    try {
      bytes = await response.body();
    } catch {
      return { body: unavailableBody('read-failed', mime), redacted: false };
    }
    if (bytes.length > this.#maxBodyReadBytes) {
      return { body: unavailableBody('too-large', mime, bytes.length), redacted: false };
    }
    return buildBodyPreview(bytes, contentType, this.#redactor, this.#bodyLimits);
  }

  #onFailed(req: Request) {
    const id = this.#ids.get(req);
    const base = id ? this.buffer.get(id) : undefined;
    if (!base) return;
    const errorText = req.failure()?.errorText ?? 'unknown';
    this.#emit({
      ...base,
      state: 'failed',
      durationMs: Date.now() - (this.#startedAt.get(req) ?? Date.now()),
      error: { code: errorText, message: describeFailure(errorText) },
    });
  }
}
