import type { BodyPreview, NetworkEvent } from './schema.ts';

export const EXPORT_WARNING =
  'Exports contain captured traffic. Known secrets are masked, but redaction is defence in depth, not a guarantee: ' +
  'review the file before sharing it.';

export const EXPORT_WARNING_UNMASKED =
  'Masking was off for this session: the export contains cookies, tokens, API keys and request/response bodies exactly ' +
  'as captured. Treat the file as a secret and do not share it.';

/** The warning for an export of a session captured with masking on or off. */
export function exportWarning(masked: boolean): string {
  return masked ? EXPORT_WARNING : EXPORT_WARNING_UNMASKED;
}

export interface SessionExport {
  format: 'tracethrough-session';
  version: 1;
  exportedAt: string;
  sessionId: string;
  droppedEvents: number;
  /** False when the session was captured with masking off (values are exactly as captured). */
  masked: boolean;
  events: NetworkEvent[];
}

export function toSessionExport(
  sessionId: string,
  events: readonly NetworkEvent[],
  droppedEvents = 0,
  masked = true,
): SessionExport {
  return {
    format: 'tracethrough-session',
    version: 1,
    exportedAt: new Date().toISOString(),
    sessionId,
    droppedEvents,
    masked,
    events: [...events],
  };
}

// --- HAR 1.2 (http://www.softwareishard.com/blog/har-12-spec/) -------------------------------

interface HarNameValue {
  name: string;
  value: string;
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    cookies: HarNameValue[];
    headers: HarNameValue[];
    queryString: HarNameValue[];
    postData?: { mimeType: string; text: string; comment?: string };
    headersSize: -1;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    cookies: HarNameValue[];
    headers: HarNameValue[];
    content: { size: number; mimeType: string; text?: string; comment?: string };
    redirectURL: string;
    headersSize: -1;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: { blocked: number; dns: number; connect: number; ssl: number; send: number; wait: number; receive: number };
  comment?: string;
  /** Custom fields (HAR allows `_`-prefixed extensions). */
  _source: NetworkEvent['source'];
  _state: NetworkEvent['state'];
  _resourceType?: string;
  _navigationId?: string;
  _error?: NetworkEvent['error'];
}

export interface Har {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    pages: [];
    entries: HarEntry[];
    comment: string;
  };
}

const pairs = (h: Record<string, string> | undefined): HarNameValue[] =>
  Object.entries(h ?? {}).flatMap(([name, value]) =>
    // Set-Cookie values are joined with "\n" by the browser layer; HAR wants one entry each.
    value.split('\n').map((v) => ({ name, value: v })),
  );

function queryOf(url: string): HarNameValue[] {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function bodyComment(body: BodyPreview | undefined): string | undefined {
  if (!body) return undefined;
  if (body.unavailableReason) return `TraceThrough: body unavailable (${body.unavailableReason})`;
  if (body.truncated) return `TraceThrough: body truncated from ${body.sizeBytes ?? '?'} bytes`;
  return undefined;
}

/** What HAR `httpVersion` holds when the protocol was not observed. HTTP/1.1 is never assumed. */
export const HAR_UNKNOWN_HTTP_VERSION = 'unknown';

const HAR_HTTP_VERSIONS: Record<string, string> = {
  'http/0.9': 'HTTP/0.9',
  'http/1.0': 'HTTP/1.0',
  'http/1.1': 'HTTP/1.1',
  h2: 'HTTP/2.0',
  h3: 'HTTP/3.0',
};

/** Maps an event's observed protocol to HAR's `httpVersion`; {@link HAR_UNKNOWN_HTTP_VERSION} when absent. */
export function harHttpVersion(protocol: string | undefined): string {
  if (!protocol) return HAR_UNKNOWN_HTTP_VERSION;
  return HAR_HTTP_VERSIONS[protocol.toLowerCase()] ?? protocol;
}

const orMinus1 = (n: number | undefined) => (n === undefined ? -1 : n);

/** One HAR entry. `context` supplies redirect neighbours; without it redirect links are omitted. */
export function toHarEntry(e: NetworkEvent, context: readonly NetworkEvent[] = []): HarEntry {
  const byId = new Map(context.map((x) => [x.id, x]));
  const redirectTarget = new Map<string, string>();
  for (const x of context) if (x.redirectedFromId) redirectTarget.set(x.redirectedFromId, x.urlSanitized);
  return buildHarEntry(e, byId, redirectTarget);
}

export function toHar(events: readonly NetworkEvent[], creatorVersion = '0.0.0', masked = true): Har {
  const byId = new Map(events.map((e) => [e.id, e]));
  const redirectTarget = new Map<string, string>();
  for (const e of events) if (e.redirectedFromId) redirectTarget.set(e.redirectedFromId, e.urlSanitized);

  const entries = events.map((e) => buildHarEntry(e, byId, redirectTarget));
  return {
    log: {
      version: '1.2',
      creator: { name: 'TraceThrough', version: creatorVersion },
      pages: [],
      entries,
      comment: exportWarning(masked),
    },
  };
}

function buildHarEntry(e: NetworkEvent, byId: Map<string, NetworkEvent>, redirectTarget: Map<string, string>): HarEntry {
  {
    const t = e.timing ?? {};
    const reqBody = e.requestBody;
    const resBody = e.responseBody;
    const resMime = resBody?.mime ?? e.responseHeadersSanitized?.['content-type'] ?? '';
    const comment = [
      e.redactionApplied ? 'Redacted by TraceThrough' : undefined,
      e.redirectedFromId && byId.has(e.redirectedFromId) ? `Redirected from ${byId.get(e.redirectedFromId)!.urlSanitized}` : undefined,
    ]
      .filter(Boolean)
      .join('; ');

    return {
      startedDateTime: e.timestamp,
      time: e.durationMs ?? 0,
      request: {
        method: e.method,
        url: e.urlSanitized,
        httpVersion: harHttpVersion(e.protocol),
        cookies: [],
        headers: pairs(e.requestHeadersSanitized),
        queryString: queryOf(e.urlSanitized),
        ...(reqBody && !reqBody.unavailableReason
          ? { postData: { mimeType: reqBody.mime ?? '', text: reqBody.preview ?? '', comment: bodyComment(reqBody) } }
          : {}),
        headersSize: -1,
        bodySize: reqBody?.sizeBytes ?? 0,
      },
      response: {
        // HAR has no "failed" state; status 0 with _error is the convention browsers use.
        status: e.state === 'complete' ? (e.status ?? 0) : 0,
        statusText: e.statusText ?? '',
        httpVersion: harHttpVersion(e.protocol),
        cookies: [],
        headers: pairs(e.responseHeadersSanitized),
        content: {
          size: resBody?.sizeBytes ?? 0,
          mimeType: resMime,
          ...(resBody?.preview !== undefined ? { text: resBody.preview } : {}),
          ...(bodyComment(resBody) ? { comment: bodyComment(resBody) } : {}),
        },
        redirectURL: redirectTarget.get(e.id) ?? '',
        headersSize: -1,
        bodySize: resBody?.sizeBytes ?? -1,
      },
      cache: {},
      timings: {
        blocked: -1,
        dns: orMinus1(t.dnsMs),
        connect: orMinus1(t.connectMs),
        ssl: orMinus1(t.tlsMs),
        send: 0,
        wait: t.ttfbMs ?? e.durationMs ?? 0,
        receive: t.downloadMs ?? 0,
      },
      ...(comment ? { comment } : {}),
      _source: e.source,
      _state: e.state,
      _resourceType: e.resourceType,
      _navigationId: e.navigationId,
      _error: e.error,
    };
  }
}
