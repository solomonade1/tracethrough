# RFC-001 — App Connect (Phase 2)

Status: Accepted for implementation · Date: 3 Nov 2026 · PRD refs: §5 Mode B, §8 Server mode, SDK-01, COR-01, US-05

## Goal

When a developer **owns** the app being inspected, show the HTTP calls its Node server makes (SSR data fetches, API route upstream calls) as **Server** events in the same TraceLens session, linked to the browser request that caused them — and never claim a link that was not proven.

## Non-goals (v1)

- Edge runtime, Bun, Deno; non-Node languages.
- Server-side request/response **bodies** (metadata only — PRD §8 "payload capture disabled unless temporarily authorized").
- `node:http`/`https` client, Axios-over-http adapters (Axios on Node uses `http`). Follow-up once fetch is solid.
- Remote/hosted collection, RBAC, debug grants. v1 collector is loopback-only.
- Component / Server Action attribution.

## Design

```
 TraceLens desktop ─────────────────────────────────────────────┐
 │  CaptureSession (browser)          Collector (127.0.0.1)     │
 │   │ adds `traceparent` to requests   ▲ POST /v1/events        │
 │   │ for the *connected origin* only  │ Bearer token           │
 └───┼──────────────────────────────────┼────────────────────────┘
     ▼                                  │
  Your app (Node / Next.js) ── @tracelens/node ──┘
     • http.server.request.start → read traceparent → AsyncLocalStorage
     • undici:request:{create,headers,trailers,error} → outgoing fetch events
```

### Trace context
- For each browser request to the **connected origin** (opt-in per session), capture assigns a fresh W3C trace (`00-<32 hex>-<16 hex>-01`) and injects it as `traceparent` via Playwright routing. The browser event records `traceId`/`spanId`. Nothing is added to third-party requests.
- The SDK subscribes to `http.server.request.start`, validates `traceparent` strictly, and stores `{ traceId, handler }` in an `AsyncLocalStorage` for the handler's async lifetime. Requests without a valid header get an empty store (explicitly cleared, so context never leaks between keep-alive requests).
- Outgoing fetches record `traceId` (if any), a new `spanId`, and `handler` (`"GET /products"`, redacted).
- **Linking rule (COR-01):** a server event is linked to a browser event only when `traceId` matches exactly. No time-window heuristics. Unlinked server events are shown as "not linked (no trace context)".

### Instrumentation
- Node's `fetch` is undici; `diagnostics_channel` events are a documented, stable surface (also used by OpenTelemetry's undici instrumentation). No monkey-patching of `globalThis.fetch`, so Next.js's patched fetch is still observed underneath.
- `headers` → event marked complete with status and TTFB; `trailers` → same id updated with full duration (covers callers that never read the body); `error` → failed with `code` (e.g. `ENOTFOUND`).

### Transport & safety
- Exporter uses `node:http` (not fetch) so it never observes itself. Bounded queue (default 1,000, coalesced by id, oldest dropped and counted), 250 ms flush, timers `unref()`ed, all errors swallowed.
- Circuit breaker: 3 consecutive failures → pause 30 s. `401/403` from the collector → SDK disables itself (token rotated / app closed). Collector can answer `{ enabled: false }` as a kill switch without redeploying.
- Redaction runs in the SDK **and again** in the collector with the session's policy (never trust the sender).
- Off unless `TRACELENS_COLLECTOR_URL` + `TRACELENS_TOKEN` are set. Refuses non-loopback collector URLs. Refuses `NODE_ENV=production` unless `TRACELENS_ALLOW_PRODUCTION=1`. `TRACELENS_DISABLED=1` hard-off.

### Collector
- Binds `127.0.0.1` only (default port 47811, falls back to random). Requires `Authorization: Bearer <token>`; token persisted per install, regenerable.
- Rejects requests carrying an `Origin` header (blocks web pages) and any `Host` other than `127.0.0.1:<port>` / `localhost:<port>` (DNS-rebinding). 1 MB body cap, ≤500 events per POST, Zod-validated.
- Events received with no recording session are dropped and counted.

## Next.js
`@tracelens/next` exports `register()` for `instrumentation.ts`; it no-ops unless `NEXT_RUNTIME === 'nodejs'`.

**Finding (validated 3 Nov 2026):** Next can run work outside the original request's async context. In `next dev` the first render after a compile, and on Next 15 also the first render of a page after boot, saw no SDK context. Next keeps its own request store (`workUnitAsyncStorage`, type `request`, with the incoming headers and URL) around every render and route handler. Next 16 registers it globally as `Symbol.for('@next/work-unit-async-storage@<version>')`, so `@tracelens/next` passes a `requestContext` hook that reads it by symbol prefix without importing Next internals. **When Next's store is present it takes precedence**, even when it says "no trace": it is set by Next precisely around the request being rendered, whereas the SDK's own context could in principle belong to another request if Next resumes queued work from a different continuation, which would be a false link. Next 15 keeps the store module-private, so its first-render gap remains and shows as "Not linked".

Support matrix: see the README.

## Open questions
1. Should connected mode also cover API origins different from the page origin (e.g. `api.example.test`)? v1: one origin; list-of-origins is a small extension.
2. Playwright routing disables the HTTP cache for routed requests — acceptable for owned-app debugging; surface in the UI.
3. Propagating `traceparent` onward from the server (service-to-service) — out of scope; would modify production traffic.
