import type { Redactor } from './redact.ts';
import type { BodyPreview, BodyUnavailableReason } from './schema.ts';

export interface BodyLimits {
  /** Max bytes of redacted text kept as a preview (PRD default 256 KB). */
  previewBytes: number;
  /** Bodies up to this size are fully parsed before redaction; larger ones are truncated first and scrubbed as text. */
  maxParseBytes: number;
}

export const DEFAULT_BODY_LIMITS: BodyLimits = {
  previewBytes: 256 * 1024,
  maxParseBytes: 2 * 1024 * 1024,
};

/** Lower-cased MIME type without parameters, e.g. "application/json". */
export function normalizeMime(contentType: string | undefined): string | undefined {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase();
  return mime || undefined;
}

export function isTextualMime(mime: string | undefined): boolean {
  if (!mime) return false;
  return (
    mime.startsWith('text/') ||
    /[/+](json|xml|javascript|ecmascript|graphql)$/.test(mime) ||
    mime === 'application/x-www-form-urlencoded' ||
    mime === 'image/svg+xml'
  );
}

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 1024);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false };
  return { text: buf.subarray(0, maxBytes).toString('utf8'), truncated: true };
}

export function unavailableBody(
  reason: BodyUnavailableReason,
  mime?: string,
  sizeBytes?: number,
): BodyPreview {
  return { mime, sizeBytes, truncated: false, unavailableReason: reason };
}

/**
 * Turns raw body bytes into a bounded preview, redacted unless the redactor is the pass-through one.
 */
export function buildBodyPreview(
  bytes: Uint8Array | undefined | null,
  contentType: string | undefined,
  redactor: Redactor,
  limits: BodyLimits = DEFAULT_BODY_LIMITS,
): { body: BodyPreview; redacted: boolean } {
  const mime = normalizeMime(contentType);
  if (!bytes || bytes.length === 0) return { body: unavailableBody('empty', mime, 0), redacted: false };

  const sizeBytes = bytes.length;
  const multipart = mime?.startsWith('multipart/') ?? false;
  // Multipart form fields cannot be masked reliably, so they are only shown with masking off.
  if (multipart && redactor.masking) {
    return { body: unavailableBody('omitted-by-policy', mime, sizeBytes), redacted: false };
  }
  const textual = isTextualMime(mime) || ((!mime || multipart) && !looksBinary(bytes));
  if (!textual) return { body: unavailableBody('binary', mime, sizeBytes), redacted: false };

  // Large bodies are cut before redaction so we never hold a huge decoded string; the
  // redactor's text fallback copes with the resulting partial JSON.
  const source =
    sizeBytes <= limits.maxParseBytes
      ? Buffer.from(bytes).toString('utf8')
      : Buffer.from(bytes.subarray(0, limits.previewBytes)).toString('utf8');
  const r = redactor.body(source, mime);
  const cut = truncateUtf8(r.value, limits.previewBytes);
  return {
    body: {
      mime,
      sizeBytes,
      preview: cut.text,
      truncated: cut.truncated || sizeBytes > limits.maxParseBytes,
    },
    redacted: r.redacted,
  };
}
