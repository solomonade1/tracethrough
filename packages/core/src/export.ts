import type { BodyPreview, NetworkEvent } from './schema.js';

export const EXPORT_WARNING =
  'Exports contain captured traffic. Known secrets are masked, but redaction is defence in depth, not a guarantee: ' +
  'review the file before sharing it.';

export interface SessionExport {
  format: 'tracelens-session';
  version: 1;
  exportedAt: string;
  sessionId: string;
  droppedEvents: number;
  events: NetworkEvent[];
}

export function toSessionExport(sessionId: string, events: readonly NetworkEvent[], droppedEvents = 0): SessionExport {
  return { format: 'tracelens-session', version: 1, exportedAt: new Date().toISOString(), sessionId, droppedEvents, events: [...events] };
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
  if (body.unavailableReason) return `TraceLens: body unavailable (${body.unavailableReason})`;
  if (body.truncated) return `TraceLens: body truncated from ${body.sizeBytes ?? '?'} bytes`;
  return undefined;
}

const orMinus1 = (n: number | undefined) => (n === undefined ? -1 : n);

export function toHar(events: readonly NetworkEvent[], creatorVersion = '0.0.0'): Har {
  const byId = new Map(events.map((e) => [e.id, e]));
  const redirectTarget = new Map<string, string>();
  for (const e of events) if (e.redirectedFromId) redirectTarget.set(e.redirectedFromId, e.urlSanitized);

  const entries = events.map((e): HarEntry => {
    const t = e.timing ?? {};
    const reqBody = e.requestBody;
    const resBody = e.responseBody;
    const resMime = resBody?.mime ?? e.responseHeadersSanitized?.['content-type'] ?? '';
    const comment = [
      e.redactionApplied ? 'Redacted by TraceLens' : undefined,
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
        httpVersion: 'HTTP/1.1',
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
        httpVersion: 'HTTP/1.1',
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
  });

  return {
    log: {
      version: '1.2',
      creator: { name: 'TraceLens', version: creatorVersion },
      pages: [],
      entries,
      comment: EXPORT_WARNING,
    },
  };
}
