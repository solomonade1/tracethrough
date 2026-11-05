# @tracethrough/node

## 0.2.0

### Minor Changes

- af9cb2c: Show server calls in full: headers, cookies, tokens and request/response bodies.
  
  - `@tracethrough/node` / `@tracethrough/next`: values are now sent to the local collector as captured (`redaction` defaults to `false`; pass a policy to mask in the SDK). Request and response body previews are captured by wrapping `globalThis.fetch` (responses are read from a clone, so the app still gets the full body). New options: `captureBodies` (default on, or `TRACETHROUGH_CAPTURE_BODIES=0`) and `maxBodyBytes` (default 64 KB, max 512 KB). Batches are size-bounded, and a batch the collector rejects as too large is dropped instead of retried.
  - `@tracethrough/core`: `createRedactor(false)` / `PASSTHROUGH_REDACTOR` keep values unmasked, and `Redactor` has a `masking` flag. Multipart bodies are shown when masking is off. `toHar` and `toSessionExport` take a `masked` argument, and `exportWarning(masked)` returns the matching export warning.

### Patch Changes

- Updated dependencies [af9cb2c]
  - @tracethrough/core@0.2.0

## 0.1.0

### Minor Changes

- 88e8fab: First public release of the TraceThrough App Connect SDK packages.

### Patch Changes

- Updated dependencies [88e8fab]
  - @tracethrough/core@0.1.0
