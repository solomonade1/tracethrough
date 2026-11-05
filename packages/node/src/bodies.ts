import {
  buildBodyPreview,
  isMultipartMime,
  isTextualMime,
  normalizeMime,
  omitsMultipart,
  unavailableBody,
  type BodyPreview,
  type Redactor,
} from '@tracethrough/core';

/** Largest preview the SDK will send per body, whatever `maxBodyBytes` says (keeps batches under the collector limit). */
export const MAX_SERVER_BODY_BYTES = 512 * 1024;
export const DEFAULT_SERVER_BODY_BYTES = 64 * 1024;

export interface BodyReader {
  /** Preview of what `fetch(input, init)` sends. Never consumes the caller's body. */
  request(input: unknown, init: RequestInit | undefined): Promise<BodyPreview | undefined>;
  /** Preview of a response, read from a clone so the caller still gets the full body. */
  response(res: Response): Promise<BodyPreview>;
}

const encoder = new TextEncoder();

function contentTypeOf(input: unknown, init: RequestInit | undefined): string | undefined {
  try {
    const own = init?.headers ? new Headers(init.headers).get('content-type') : null;
    if (own) return own;
    return input instanceof Request ? (input.headers.get('content-type') ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

function contentLengthOf(input: unknown, init: RequestInit | undefined): number | undefined {
  try {
    const raw =
      (init?.headers ? new Headers(init.headers).get('content-length') : null) ??
      (input instanceof Request ? input.headers.get('content-length') : null);
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

export interface BoundedRead {
  /** At most `maxBytes` bytes from the start of the stream. */
  bytes: Uint8Array;
  /** The stream held more than `maxBytes`. */
  truncated: boolean;
}

/**
 * Reads at most `maxBytes` from a stream: it stops as soon as one byte beyond the budget has
 * arrived (the minimum needed to know the body is longer) and cancels the stream in the background,
 * so a huge or endless body is never pulled into memory and a slow producer cannot hold us up.
 * Only ever give it a branch you own (a clone), never the caller's own body.
 */
export async function readBounded(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<BoundedRead> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  let truncated = false;
  try {
    while (read <= maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      read += value.byteLength;
    }
    truncated = read > maxBytes;
  } finally {
    // Not awaited: cancelling a stream with a stalled producer may never settle.
    if (truncated) void reader.cancel().catch(() => {});
    else reader.releaseLock();
  }
  const bytes = new Uint8Array(Math.min(read, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    if (offset >= bytes.length) break;
    const part = c.byteLength > bytes.length - offset ? c.subarray(0, bytes.length - offset) : c;
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return { bytes, truncated };
}

export function createBodyReader(redactor: Redactor, maxBytes: number): BodyReader {
  const limits = { previewBytes: maxBytes, maxParseBytes: Math.max(maxBytes, 2 * 1024 * 1024) };

  /**
   * A body that is not worth reading, decided from its type alone: known binary, or multipart that
   * the masking policy omits. Returns undefined when the bytes are needed.
   */
  const skipRead = (contentType: string | undefined, size: number | undefined): BodyPreview | undefined => {
    const mime = normalizeMime(contentType);
    if (omitsMultipart(redactor, contentType)) return unavailableBody('omitted-by-policy', mime, size);
    if (mime && !isTextualMime(mime) && !isMultipartMime(mime)) return unavailableBody('binary', mime, size);
    return undefined;
  };

  /** Preview of the first bytes of a body whose full size is `size` (unknown for some streams). */
  const previewOf = (read: BoundedRead, contentType: string | undefined, size: number | undefined): BodyPreview => {
    const { body } = buildBodyPreview(read.bytes, contentType, redactor, limits);
    if (!read.truncated) return body;
    // The prefix says nothing about the real length, so replace the size buildBodyPreview derived from it.
    return { ...body, sizeBytes: size, truncated: !body.unavailableReason };
  };

  const fromBytes = (bytes: Uint8Array, contentType: string | undefined) =>
    previewOf({ bytes: bytes.subarray(0, maxBytes), truncated: bytes.byteLength > maxBytes }, contentType, bytes.byteLength);

  async function request(input: unknown, init: RequestInit | undefined): Promise<BodyPreview | undefined> {
    let contentType = contentTypeOf(input, init);
    const body = init?.body ?? undefined;
    if (body == null) {
      // A Request object carries its own body; read a clone so fetch can still send the original.
      if (!(input instanceof Request) || input.body === null) return undefined;
      const length = contentLengthOf(input, init);
      const skipped = skipRead(contentType, length);
      if (skipped) return skipped;
      // clone() must run before fetch starts consuming the original (this runs synchronously up to here).
      const read = await readBounded(input.clone().body!, maxBytes);
      return previewOf(read, contentType, length);
    }
    if (typeof body === 'string' || body instanceof URLSearchParams) {
      const text = typeof body === 'string' ? body : body.toString();
      contentType ??=
        typeof body === 'string' ? 'text/plain;charset=UTF-8' : 'application/x-www-form-urlencoded;charset=UTF-8';
      // Only the head is encoded: a string of N chars is at least N bytes, so maxBytes + 1 chars suffice.
      const head = encoder.encode(text.length > maxBytes + 1 ? text.slice(0, maxBytes + 1) : text);
      const size = text.length > maxBytes ? Buffer.byteLength(text) : head.byteLength;
      return previewOf({ bytes: head.subarray(0, maxBytes), truncated: size > maxBytes }, contentType, size);
    }
    if (body instanceof ArrayBuffer) {
      return skipRead(contentType, body.byteLength) ?? fromBytes(new Uint8Array(body), contentType);
    }
    if (ArrayBuffer.isView(body)) {
      return (
        skipRead(contentType, body.byteLength) ??
        fromBytes(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), contentType)
      );
    }
    if (body instanceof Blob) {
      contentType ??= body.type || undefined;
      const skipped = skipRead(contentType, body.size);
      if (skipped) return skipped;
      // slice() is lazy: only the head is ever read from the blob.
      const head = new Uint8Array(await body.slice(0, maxBytes).arrayBuffer());
      return previewOf({ bytes: head, truncated: body.size > maxBytes }, contentType, body.size);
    }
    if (body instanceof FormData) {
      // Serialize a copy the way fetch will, including the multipart boundary; the stream is lazy.
      const encoded = new Response(body);
      contentType ??= encoded.headers.get('content-type') ?? undefined;
      const skipped = skipRead(contentType, undefined);
      if (skipped) return skipped;
      const read = await readBounded(encoded.body!, maxBytes);
      return previewOf(read, contentType, undefined);
    }
    // Streams can only be read once, and the caller's request needs it.
    return unavailableBody('streamed', normalizeMime(contentType));
  }

  async function response(res: Response): Promise<BodyPreview> {
    const contentType = res.headers.get('content-type') ?? undefined;
    const mime = normalizeMime(contentType);
    const declared = Number(res.headers.get('content-length'));
    const size = Number.isFinite(declared) && res.headers.has('content-length') ? declared : undefined;
    if (!res.body) return unavailableBody('empty', mime, 0);
    if (mime === 'text/event-stream') return unavailableBody('streamed', mime, size);
    const skipped = skipRead(contentType, size);
    if (skipped) return skipped;

    // Read at most maxBytes from a clone, then cancel it: the caller's copy is unaffected.
    const read = await readBounded(res.clone().body!, maxBytes);
    return previewOf(read, contentType, size);
  }

  return { request, response };
}
