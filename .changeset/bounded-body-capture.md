---
'@tracethrough/core': minor
'@tracethrough/node': minor
'@tracethrough/next': patch
---

Server-side (App Connect) events now follow the same masking rules as browser events, and retained body memory is bounded.

- With masking on, multipart request and response bodies are omitted from server events (`omitted-by-policy`), keeping the MIME type (including `boundary=` parameters) and the size. With masking off, previews are unchanged: raw capture stays supported and is still the SDK default.
- The SDK reads request and response bodies through a shared bounded reader, so a large or endless body is never buffered whole. Known-binary bodies and masked multipart bodies are not read at all.
- `SessionBuffer` has a byte budget (128 MiB by default, an estimate of retained event size, not a process-memory ceiling) in addition to the event cap, and reports every event it evicts.
- `NetworkEvent` gains an optional `protocol` field (`http/1.1`, `h2`, `h3`) and HAR exports use it for `httpVersion`; events without it export `unknown` instead of a guessed `HTTP/1.1`. Older events still export.
- `Exporter.flush()` now also waits for a batch that is already being sent, so the last events are not lost on shutdown.
- `@tracethrough/next` tolerates a missing or reshaped Next.js request store and never invents a trace for prerender or cached renders.
