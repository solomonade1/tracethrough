import { z } from 'zod';

/** Where an event was observed. Browser = controlled Chromium; Server = opt-in App Connect SDK. */
export const EventSource = z.enum(['browser', 'server']);
export type EventSource = z.infer<typeof EventSource>;

export const ExchangeState = z.enum(['pending', 'complete', 'failed']);
export type ExchangeState = z.infer<typeof ExchangeState>;

export const RequestType = z.enum(['document', 'fetch', 'xhr', 'asset', 'other']);
export type RequestType = z.infer<typeof RequestType>;

/** Why a body preview is missing or incomplete. Shown verbatim-ish in the UI; never replaced with fake content. */
export const BodyUnavailableReason = z.enum([
  'empty',
  'too-large',
  'binary',
  'redirect',
  'streamed',
  'read-failed',
  'omitted-by-policy',
]);
export type BodyUnavailableReason = z.infer<typeof BodyUnavailableReason>;

export const BodyPreview = z.object({
  mime: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  /** Redacted, possibly truncated text. Absent when unavailableReason is set. */
  preview: z.string().optional(),
  truncated: z.boolean(),
  unavailableReason: BodyUnavailableReason.optional(),
});
export type BodyPreview = z.infer<typeof BodyPreview>;

/** Phase durations in ms; a field is absent when the browser did not report it (e.g. reused connection). */
export const Timing = z.object({
  dnsMs: z.number().optional(),
  connectMs: z.number().optional(),
  tlsMs: z.number().optional(),
  ttfbMs: z.number().optional(),
  downloadMs: z.number().optional(),
});
export type Timing = z.infer<typeof Timing>;

export const NetworkEvent = z.object({
  id: z.string(),
  sessionId: z.string(),
  source: EventSource,
  state: ExchangeState,
  /** ISO time the request started. */
  timestamp: z.string(),
  method: z.string(),
  urlSanitized: z.string(),
  domain: z.string(),
  status: z.number().int().optional(),
  statusText: z.string().optional(),
  durationMs: z.number().optional(),
  type: RequestType.optional(),
  /** Raw browser resource type (e.g. "stylesheet", "websocket") for detail views. */
  resourceType: z.string().optional(),
  requestHeadersSanitized: z.record(z.string(), z.string()).optional(),
  responseHeadersSanitized: z.record(z.string(), z.string()).optional(),
  requestBody: BodyPreview.optional(),
  responseBody: BodyPreview.optional(),
  timing: Timing.optional(),
  error: z.object({ code: z.string().optional(), message: z.string() }).optional(),
  redirectedFromId: z.string().optional(),
  navigationId: z.string().optional(),
  isNavigation: z.boolean(),
  fromServiceWorker: z.boolean().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  redactionApplied: z.boolean(),
});
export type NetworkEvent = z.infer<typeof NetworkEvent>;
