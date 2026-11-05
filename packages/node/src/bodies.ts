import { buildBodyPreview, isTextualMime, normalizeMime, unavailableBody, type BodyPreview, type Redactor } from '@tracethrough/core';

/** Largest preview the SDK will send per body, whatever `maxBodyBytes` says (keeps batches under the collector limit). */
export const MAX_SERVER_BODY_BYTES = 512 * 1024;
export const DEFAULT_SERVER_BODY_BYTES = 64 * 1024;

export interface BodyReader {
  /** Preview of what `fetch(input, init)` sends. Never consumes the caller's body. */
  request(input: unknown, init: RequestInit | undefined): Promise<BodyPreview | undefined>;
  /** Preview of a response, read from a clone so the caller still gets the full body. */
  response(res: Response): Promise<BodyPreview>;
}

const toBytes = (text: string) => new TextEncoder().encode(text);

function contentTypeOf(input: unknown, init: RequestInit | undefined): string | undefined {
  try {
    const own = init?.headers ? new Headers(init.headers).get('content-type') : null;
    if (own) return own;
    return input instanceof Request ? (input.headers.get('content-type') ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

export function createBodyReader(redactor: Redactor, maxBytes: number): BodyReader {
  const limits = { previewBytes: maxBytes, maxParseBytes: Math.max(maxBytes, 2 * 1024 * 1024) };
  const preview = (bytes: Uint8Array, contentType: string | undefined) => buildBodyPreview(bytes, contentType, redactor, limits).body;

  async function request(input: unknown, init: RequestInit | undefined): Promise<BodyPreview | undefined> {
    let contentType = contentTypeOf(input, init);
    const body = init?.body ?? undefined;
    if (body == null) {
      // A Request object carries its own body; read a clone so fetch can still send the original.
      if (!(input instanceof Request) || input.body === null) return undefined;
      const bytes = new Uint8Array(await input.clone().arrayBuffer());
      return preview(bytes, contentType);
    }
    if (typeof body === 'string') return preview(toBytes(body), contentType ?? 'text/plain;charset=UTF-8');
    if (body instanceof URLSearchParams) {
      return preview(toBytes(body.toString()), contentType ?? 'application/x-www-form-urlencoded;charset=UTF-8');
    }
    if (body instanceof ArrayBuffer) return preview(new Uint8Array(body), contentType);
    if (ArrayBuffer.isView(body)) return preview(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), contentType);
    if (body instanceof Blob) return preview(new Uint8Array(await body.arrayBuffer()), contentType ?? (body.type || undefined));
    if (body instanceof FormData) {
      // Serialize a copy the way fetch will, including the multipart boundary.
      const encoded = new Response(body);
      contentType ??= encoded.headers.get('content-type') ?? undefined;
      return preview(new Uint8Array(await encoded.arrayBuffer()), contentType);
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
    if (mime && !isTextualMime(mime) && !mime.startsWith('multipart/')) return unavailableBody('binary', mime, size);

    // Read at most maxBytes from a clone, then cancel it: the caller's copy is unaffected.
    const reader = res.clone().body!.getReader();
    const chunks: Uint8Array[] = [];
    let read = 0;
    let more = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        read += value.byteLength;
        if (read > maxBytes) {
          more = true;
          break;
        }
      }
    } finally {
      if (more) void reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(read);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    const body = preview(more ? bytes.subarray(0, maxBytes) : bytes, contentType);
    return more ? { ...body, sizeBytes: size, truncated: true } : body;
  }

  return { request, response };
}
