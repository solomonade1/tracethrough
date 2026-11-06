export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** Schemes written without `//`; left untouched so the capture engine reports them as unsupported. */
const OPAQUE_SCHEME = /^(?:file|javascript|data|about|blob|mailto|view-source|chrome):/i;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

/**
 * Checks what the user typed before a session is started. Only obvious mistakes are caught here (empty,
 * spaces, unparseable); which schemes are allowed stays the capture engine's call, so there is one rule.
 * A bare host gets `https://` (or `http://` for localhost), which is what the user meant.
 */
export function checkUrlInput(raw: string): UrlCheck {
  const value = raw.trim();
  if (!value) return { ok: false, error: 'Enter a URL to inspect, for example https://example.com.' };
  if (/\s/.test(value)) return { ok: false, error: 'A URL cannot contain spaces.' };
  let candidate = value;
  if (!HAS_SCHEME.test(value) && !OPAQUE_SCHEME.test(value)) {
    candidate = `${LOCAL_HOST.test(value) ? 'http' : 'https'}://${value}`;
  }
  try {
    new URL(candidate);
  } catch {
    return { ok: false, error: `"${value}" is not a valid URL. Try something like https://example.com.` };
  }
  return { ok: true, url: candidate };
}
