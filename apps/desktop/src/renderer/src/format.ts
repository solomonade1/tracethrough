import type { BodyPreview, NetworkEvent } from '@tracelens/core';

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Path + query for the Name column; falls back to the raw string. */
export function nameOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}

export function statusLabel(e: NetworkEvent): string {
  if (e.state === 'failed') return 'failed';
  if (e.state === 'pending') return '…';
  return String(e.status ?? '');
}

export function statusTone(e: NetworkEvent): 'ok' | 'redirect' | 'client' | 'server' | 'failed' | 'pending' {
  if (e.state === 'failed') return 'failed';
  if (e.state === 'pending' || e.status === undefined) return 'pending';
  if (e.status >= 500) return 'server';
  if (e.status >= 400) return 'client';
  if (e.status >= 300) return 'redirect';
  return 'ok';
}

/** Precise, honest explanations for missing bodies (US-06). */
export function unavailableMessage(body: BodyPreview): string {
  const size = body.sizeBytes !== undefined ? ` (${formatBytes(body.sizeBytes)})` : '';
  switch (body.unavailableReason) {
    case 'empty':
      return 'No body.';
    case 'too-large':
      return `Body${size} is above the capture read limit, so it was not read.`;
    case 'binary':
      return `Binary content${body.mime ? ` of type ${body.mime}` : ''}${size} is not displayed.`;
    case 'redirect':
      return 'Redirect responses have no readable body. See the next hop in Overview.';
    case 'streamed':
      return 'Streamed response (for example server-sent events). The body is not captured.';
    case 'read-failed':
      return 'The browser did not make this body available (cancelled, opaque/CORS-restricted, or evicted from the network cache).';
    case 'omitted-by-policy':
      return `Multipart body${size} omitted by redaction policy.`;
    default:
      return 'Body unavailable.';
  }
}
