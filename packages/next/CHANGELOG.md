# @tracethrough/next

## 0.3.0

### Patch Changes

- cbd4f18: Server-side (App Connect) events now follow the same masking rules as browser events, and retained body memory is bounded.
  
  - With masking on, multipart request and response bodies are omitted from server events (`omitted-by-policy`), keeping the MIME type (including `boundary=` parameters) and the size. With masking off, previews are unchanged: raw capture stays supported and is still the SDK default.
  - The SDK reads request and response bodies through a shared bounded reader, so a large or endless body is never buffered whole. Known-binary bodies and masked multipart bodies are not read at all.
  - `SessionBuffer` has a byte budget (128 MiB by default, an estimate of retained event size, not a process-memory ceiling) in addition to the event cap, and reports every event it evicts.
  - `NetworkEvent` gains an optional `protocol` field (`http/1.1`, `h2`, `h3`) and HAR exports use it for `httpVersion`; events without it export `unknown` instead of a guessed `HTTP/1.1`. Older events still export.
  - `Exporter.flush()` now also waits for a batch that is already being sent, so the last events are not lost on shutdown.
  - `@tracethrough/next` tolerates a missing or reshaped Next.js request store and never invents a trace for prerender or cached renders.
- Updated dependencies [cbd4f18]
  - @tracethrough/node@0.3.0

## 0.2.0

### Minor Changes

- af9cb2c: Show server calls in full: headers, cookies, tokens and request/response bodies.
  
  - `@tracethrough/node` / `@tracethrough/next`: values are now sent to the local collector as captured (`redaction` defaults to `false`; pass a policy to mask in the SDK). Request and response body previews are captured by wrapping `globalThis.fetch` (responses are read from a clone, so the app still gets the full body). New options: `captureBodies` (default on, or `TRACETHROUGH_CAPTURE_BODIES=0`) and `maxBodyBytes` (default 64 KB, max 512 KB). Batches are size-bounded, and a batch the collector rejects as too large is dropped instead of retried.
  - `@tracethrough/core`: `createRedactor(false)` / `PASSTHROUGH_REDACTOR` keep values unmasked, and `Redactor` has a `masking` flag. Multipart bodies are shown when masking is off. `toHar` and `toSessionExport` take a `masked` argument, and `exportWarning(masked)` returns the matching export warning.

### Patch Changes

- Updated dependencies [af9cb2c]
  - @tracethrough/node@0.2.0

## 0.1.0

### Minor Changes

- 88e8fab: First public release of the TraceThrough App Connect SDK packages.

### Patch Changes

- Updated dependencies [88e8fab]
  - @tracethrough/node@0.1.0
