/** W3C Trace Context helpers (https://www.w3.org/TR/trace-context/). Web Crypto only, so safe in any runtime. */

export interface TraceContext {
  traceId: string;
  spanId: string;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  // All-zero ids are invalid per spec; retry in the astronomically unlikely case.
  do globalThis.crypto.getRandomValues(buf);
  while (buf.every((b) => b === 0));
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const newTraceId = () => randomHex(16);
export const newSpanId = () => randomHex(8);

export function newTraceContext(): TraceContext {
  return { traceId: newTraceId(), spanId: newSpanId() };
}

export function formatTraceparent({ traceId, spanId }: TraceContext): string {
  return `00-${traceId}-${spanId}-01`;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/** Strict parse: version 00 only, lowercase hex, non-zero ids. Anything else is treated as absent. */
export function parseTraceparent(header: string | string[] | undefined): TraceContext | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  const m = value?.trim().match(TRACEPARENT);
  if (!m) return undefined;
  const [, traceId, spanId] = m as unknown as [string, string, string];
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined;
  return { traceId, spanId };
}
