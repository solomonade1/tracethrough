import type { NetworkEvent } from './schema.ts';

/** Header lines. Multi-value headers (joined with "\n" by the browser layer) become separate lines. */
export function headerLines(h: Record<string, string> | undefined): [string, string][] {
  return Object.entries(h ?? {}).flatMap(([name, value]) => value.split('\n').map((v): [string, string] => [name, v]));
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A curl command for the request exactly as captured (masked values stay masked). */
export function toCurl(e: NetworkEvent): string {
  const parts = [`curl ${shellQuote(e.urlSanitized)}`];
  if (e.method.toUpperCase() !== 'GET') parts.push(`-X ${e.method.toUpperCase()}`);
  for (const [name, value] of headerLines(e.requestHeadersSanitized)) parts.push(`-H ${shellQuote(`${name}: ${value}`)}`);
  const body = e.requestBody;
  if (body && !body.unavailableReason && body.preview !== undefined) parts.push(`--data-raw ${shellQuote(body.preview)}`);
  return parts.join(' \\\n  ');
}

/** A fetch() call for the request exactly as captured. */
export function toFetch(e: NetworkEvent): string {
  const headers = Object.fromEntries(headerLines(e.requestHeadersSanitized));
  const init: Record<string, unknown> = { method: e.method.toUpperCase() };
  if (Object.keys(headers).length) init.headers = headers;
  const body = e.requestBody;
  if (body && !body.unavailableReason && body.preview !== undefined) init.body = body.preview;
  return `await fetch(${JSON.stringify(e.urlSanitized)}, ${JSON.stringify(init, null, 2)});`;
}

export interface ParsedCookie {
  kind: 'sent' | 'set';
  name: string;
  value: string;
  /** Attributes of a Set-Cookie line, for example `Path=/; HttpOnly`. */
  attributes?: string;
}

function splitPair(s: string): [string, string] {
  const i = s.indexOf('=');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

/** Cookies the request sent and the response set, in that order. Header names match case-insensitively. */
export function parseCookies(e: NetworkEvent): ParsedCookie[] {
  const find = (h: Record<string, string> | undefined, name: string) =>
    Object.entries(h ?? {}).find(([k]) => k.toLowerCase() === name)?.[1];
  const out: ParsedCookie[] = [];
  const sent = find(e.requestHeadersSanitized, 'cookie');
  if (sent) {
    for (const part of sent.split(/;\s*/)) {
      if (!part) continue;
      const [name, value] = splitPair(part);
      out.push({ kind: 'sent', name, value });
    }
  }
  const set = find(e.responseHeadersSanitized, 'set-cookie');
  if (set) {
    for (const line of set.split('\n')) {
      if (!line.trim()) continue;
      const [pair, ...attrs] = line.split(/;\s*/);
      const [name, value] = splitPair(pair!);
      out.push({ kind: 'set', name, value, ...(attrs.length ? { attributes: attrs.join('; ') } : {}) });
    }
  }
  return out;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** A JavaScript accessor from the root, for example `data.items[0].name`. The root is the empty string. */
export function jsonPathToString(segments: readonly (string | number)[]): string {
  let out = '';
  for (const seg of segments) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else if (IDENT.test(seg)) out += out ? `.${seg}` : seg;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

function bodyText(b: NetworkEvent['requestBody']): string {
  if (!b) return '';
  if (b.unavailableReason) return `[body unavailable: ${b.unavailableReason}]`;
  return b.preview ?? '';
}

/** The request line, headers and body, then the status line, headers and body. */
export function exchangeAsText(e: NetworkEvent): string {
  const lines = (h: Record<string, string> | undefined) => headerLines(h).map(([k, v]) => `${k}: ${v}`);
  const status = e.state === 'complete' ? `${e.status ?? ''} ${e.statusText ?? ''}`.trim() : e.state;
  return [
    `${e.method} ${e.urlSanitized}`,
    ...lines(e.requestHeadersSanitized),
    '',
    bodyText(e.requestBody),
    '',
    status,
    ...lines(e.responseHeadersSanitized),
    '',
    bodyText(e.responseBody),
  ].join('\n');
}
