/**
 * When masking is on, redaction runs before an event is buffered, persisted, exported or sent to
 * the UI. It is fail-closed: anything whose key *looks* sensitive is masked, even at the cost of
 * over-redaction. Redaction is defence in depth, not a guarantee (PRD §10.10). Masking can be
 * turned off per session (`createRedactor(false)`), in which case values are kept as captured.
 */

export const MASK = '[REDACTED]';

export interface RedactionPolicy {
  /** Header names always masked (case-insensitive). */
  headerNames: readonly string[];
  /** Query/fragment/form keys always masked (case-insensitive). */
  queryKeys: readonly string[];
  /** Dotted JSON paths always masked; `*` matches any key or array index, e.g. `items.*.pan`. */
  jsonPaths: readonly string[];
  /** Catch-all: any header/query/form/JSON key matching this is masked. Must not use the `g` flag. */
  sensitiveKeyPattern: RegExp;
  /** Credential-shaped values masked wherever they appear (JWTs, bearer tokens). Must use the `g` flag. */
  sensitiveValuePatterns: readonly RegExp[];
}

export const DEFAULT_REDACTION_POLICY: RedactionPolicy = {
  headerNames: [
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-csrf-token',
    'x-xsrf-token',
    'x-amz-security-token',
  ],
  queryKeys: ['code', 'sig', 'key'],
  jsonPaths: [],
  sensitiveKeyPattern:
    /passw(or)?d|passphrase|secret|token|api[-_]?key|(^|[-_.])auth($|[-_.])|authoriz|authenticat|session|cookie|csrf|xsrf|credential|private[-_]?key|card[-_]?num|^pan$|cvv|cvc|^ssn$|signature/i,
  sensitiveValuePatterns: [
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
    /(?<=\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  ],
};

export interface Redacted<T> {
  value: T;
  redacted: boolean;
}

export interface Redactor {
  /** False for the pass-through redactor: values are kept exactly as captured. */
  readonly masking: boolean;
  headers(headers: Record<string, string>): Redacted<Record<string, string>>;
  url(url: string): Redacted<string>;
  /** Redacts a decoded text body according to its MIME type. */
  body(text: string, mime: string | undefined): Redacted<string>;
}

const keep = <T>(value: T): Redacted<T> => ({ value, redacted: false });

/** Keeps every header, URL and body exactly as captured (masking turned off). */
export const PASSTHROUGH_REDACTOR: Redactor = {
  masking: false,
  headers: (headers) => keep({ ...headers }),
  url: keep,
  body: (text) => keep(text),
};

/** `false` turns masking off and returns {@link PASSTHROUGH_REDACTOR}. */
export function createRedactor(policy: RedactionPolicy | false = DEFAULT_REDACTION_POLICY): Redactor {
  return policy === false ? PASSTHROUGH_REDACTOR : createMaskingRedactor(policy);
}

function createMaskingRedactor(policy: RedactionPolicy): Redactor {
  const headerSet = new Set(policy.headerNames.map((h) => h.toLowerCase()));
  const querySet = new Set(policy.queryKeys.map((k) => k.toLowerCase()));
  const jsonPaths = policy.jsonPaths.map((p) => p.split('.'));

  const isSensitiveKey = (key: string) => policy.sensitiveKeyPattern.test(key);

  function scrubValues(text: string): Redacted<string> {
    let redacted = false;
    let value = text;
    for (const pattern of policy.sensitiveValuePatterns) {
      value = value.replace(pattern, () => {
        redacted = true;
        return MASK;
      });
    }
    return { value, redacted };
  }

  function paramString(s: string): Redacted<string> {
    let redacted = false;
    const value = s
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq < 0) return pair;
        const rawKey = pair.slice(0, eq);
        const key = safeDecode(rawKey.replace(/\+/g, ' '));
        if (querySet.has(key.toLowerCase()) || isSensitiveKey(key)) {
          redacted = true;
          return `${rawKey}=${MASK}`;
        }
        const scrubbed = scrubValues(pair.slice(eq + 1));
        redacted ||= scrubbed.redacted;
        return `${rawKey}=${scrubbed.value}`;
      })
      .join('&');
    return { value, redacted };
  }

  function headers(input: Record<string, string>): Redacted<Record<string, string>> {
    let redacted = false;
    const out: Record<string, string> = {};
    for (const [name, raw] of Object.entries(input)) {
      const lower = name.toLowerCase();
      let value: string;
      if (lower === 'cookie') {
        value = raw
          .split(/;\s*/)
          .filter(Boolean)
          .map((pair) => `${pair.split('=')[0]}=${MASK}`)
          .join('; ');
      } else if (lower === 'set-cookie') {
        // Playwright joins multiple Set-Cookie headers with "\n". Keep cookie names and attributes.
        value = raw
          .split('\n')
          .map((line) => line.replace(/^([^=;]+)=[^;]*/, `$1=${MASK}`))
          .join('\n');
      } else if (lower === 'authorization' || lower === 'proxy-authorization') {
        const space = raw.indexOf(' ');
        value = space > 0 ? `${raw.slice(0, space)} ${MASK}` : MASK;
      } else if (headerSet.has(lower) || isSensitiveKey(lower)) {
        value = MASK;
      } else {
        const scrubbed = scrubValues(raw);
        out[name] = scrubbed.value;
        redacted ||= scrubbed.redacted;
        continue;
      }
      out[name] = value;
      redacted = true;
    }
    return { value: out, redacted };
  }

  function url(raw: string): Redacted<string> {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return scrubValues(raw);
    }
    let redacted = false;
    const userinfo = parsed.username || parsed.password ? `${MASK}@` : '';
    if (userinfo) redacted = true;

    const path = scrubValues(parsed.pathname);
    redacted ||= path.redacted;

    let search = '';
    if (parsed.search) {
      const r = paramString(parsed.search.slice(1));
      redacted ||= r.redacted;
      search = `?${r.value}`;
    }

    let hash = '';
    if (parsed.hash) {
      const fragment = parsed.hash.slice(1);
      // OAuth implicit flow puts tokens in the fragment as key=value pairs.
      const r = fragment.includes('=') ? paramString(fragment) : scrubValues(fragment);
      redacted ||= r.redacted;
      hash = `#${r.value}`;
    }

    return { value: `${parsed.protocol}//${userinfo}${parsed.host}${path.value}${search}${hash}`, redacted };
  }

  function json(text: string): Redacted<string> | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return undefined;
    }
    let redacted = false;
    const matchesPath = (path: string[]) =>
      jsonPaths.some((p) => p.length === path.length && p.every((seg, i) => seg === '*' || seg === path[i]));

    const walk = (node: unknown, path: string[]): unknown => {
      if (Array.isArray(node)) return node.map((v, i) => walk(v, [...path, String(i)]));
      if (node && typeof node === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node)) {
          const childPath = [...path, k];
          if (isSensitiveKey(k) || matchesPath(childPath)) {
            out[k] = MASK;
            redacted = true;
          } else {
            out[k] = walk(v, childPath);
          }
        }
        return out;
      }
      if (typeof node === 'string') {
        const r = scrubValues(node);
        redacted ||= r.redacted;
        return r.value;
      }
      return node;
    };

    const value = JSON.stringify(walk(parsed, []));
    return { value, redacted };
  }

  /** Fallback for JSON-looking text that does not parse (e.g. truncated). Handles an unterminated final string. */
  function jsonLikeText(text: string): Redacted<string> {
    let redacted = false;
    const value = text.replace(
      /"((?:[^"\\]|\\.)*)"(\s*:\s*)("(?:[^"\\]|\\.)*(?:"|$)|[^,{}[\]\s"]+)/g,
      (match, key: string, sep: string) => {
        if (!isSensitiveKey(key)) return match;
        redacted = true;
        return `"${key}"${sep}"${MASK}"`;
      },
    );
    const scrubbed = scrubValues(value);
    return { value: scrubbed.value, redacted: redacted || scrubbed.redacted };
  }

  /**
   * Source-like text (inline scripts, JS bundles, logs): masks quoted values assigned to sensitive
   * keys (`apiKey: "…"`, `token = '…'`) and sensitive params in embedded URLs (`?api_key=…`).
   */
  function sourceText(text: string): Redacted<string> {
    let redacted = false;
    let value = text.replace(
      // The key length is capped: unbounded, a long run of word characters made this quadratic
      // (a 64 KB base64 blob took seconds). Real keys are far shorter than 128 characters.
      /(["']?)([A-Za-z_$][\w$-]{0,127})\1(\s*[:=]\s*)(["'`])((?:\\.|(?!\4)[^\\])*)\4/g,
      (match, q: string, key: string, sep: string, quote: string) => {
        if (!isSensitiveKey(key)) return match;
        redacted = true;
        return `${q}${key}${q}${sep}${quote}${MASK}${quote}`;
      },
    );
    value = value.replace(/([?&#])([^=&#\s"'<>]+)=([^&#\s"'<>]*)/g, (match, lead: string, rawKey: string) => {
      const key = safeDecode(rawKey);
      if (!querySet.has(key.toLowerCase()) && !isSensitiveKey(key)) return match;
      redacted = true;
      return `${lead}${rawKey}=${MASK}`;
    });
    const scrubbed = scrubValues(value);
    return { value: scrubbed.value, redacted: redacted || scrubbed.redacted };
  }

  /** Masks value/content attributes of <input>/<meta> tags whose name/id looks sensitive (CSRF tokens etc.). */
  function html(text: string): Redacted<string> {
    let redacted = false;
    const value = text.replace(/<(input|meta)\b[^>]*>/gi, (tag) => {
      const names = [...tag.matchAll(/\b(?:name|id|property)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1] ?? '');
      if (!names.some(isSensitiveKey)) return tag;
      redacted = true;
      return tag.replace(/\b(value|content)\s*=\s*(["'])[^"']*\2/gi, `$1=$2${MASK}$2`);
    });
    const rest = sourceText(value);
    return { value: rest.value, redacted: redacted || rest.redacted };
  }

  function body(text: string, mime: string | undefined): Redacted<string> {
    const m = (mime ?? '').toLowerCase();
    const trimmed = text.trimStart();
    if (m.includes('json') || (!m && (trimmed.startsWith('{') || trimmed.startsWith('[')))) {
      return json(text) ?? jsonLikeText(text);
    }
    if (m.includes('x-www-form-urlencoded')) return paramString(text);
    if (m.includes('html') || m.includes('xml')) return html(text);
    return sourceText(text);
  }

  return { masking: true, headers, url, body };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
