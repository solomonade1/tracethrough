# TraceLens — Development Plan

Source: `Developer_Network_Inspector_PRD.md` v1.0 (2 Nov 2026).
Plan start: Mon 3 Nov 2026. Cadence: 2-week sprints. Estimates assume 1–2 engineers and are hypotheses to re-baseline after Sprint 1.

---

## 1. What we are building first

One workflow, done well: **URL → isolated headed Chromium → live request list → safe request detail → sanitized export.**
Everything else (App Connect SDK, correlation, mock/replay, proxy) waits until that workflow passes its exit gate.

Non-negotiables carried from the PRD into every sprint:

- **Redact before persist.** Raw secret values never reach the buffer, SQLite, export or the renderer process.
- **Honest labelling.** Every event is `source: 'browser' | 'server'`. No inferred SSR data for unconnected sites.
- **Never fabricate.** Missing / truncated / binary / streamed bodies show a precise reason, not empty strings.
- **Local-first.** No network egress of captured data by default; no telemetry containing traffic.
- **Inert rendering.** Response bodies are rendered as text, never as HTML/script in the inspector.

---

## 2. Decisions taken to unblock work (PRD §17)

These are proposed defaults so engineering can start; each is cheap to revisit unless marked *sticky*.

| # | Open question | Default for MVP | Revisit when |
|---|---|---|---|
| 1 | Packaging | **Electron + React + Vite** desktop app. Capture engine is a plain Node package so a localhost-web-UI fallback stays possible. *Sticky-ish.* | Bundle size/RAM measured at end of Phase 1 |
| 2 | Audience | Individual / local only. No accounts, no sync. | Pilot feedback |
| 3 | Platforms | **Windows first** (team dev machines), macOS in the same beta. Linux after packaging is validated. | Sprint 4 |
| 4 | SDK scope | Node `fetch`/undici only, via OTel-compatible spans. Axios in a follow-up. | Phase 2 RFC |
| 5 | Privacy | **Ephemeral by default**; explicit "Save session" persists to SQLite. | Pilot feedback |
| 6 | Business model | Out of scope for engineering; keep packages licence-clean so an open core is possible. | — |
| 7 | Auth paths to test first | Cookie session login, then OAuth redirect (PKCE), then popup SSO. | Sprint 3 |
| 8 | Naming | Keep `tracelens` as internal codename; package scope `@tracelens/*` is unpublished until name is cleared. | Before first public build |

---

## 3. Architecture & repo layout

pnpm workspace monorepo, TypeScript strict, ESM.

```
tracelens/
├─ packages/
│  ├─ core/        @tracelens/core     Event schema (Zod), redaction engine, ring buffer,
│  │                                   HAR/JSON export. Zero runtime deps beyond zod.
│  │                                   Shared by desktop, capture and (later) SDK.
│  ├─ capture/     @tracelens/capture  Playwright session engine: launch isolated context,
│  │                                   lifecycle → normalized events, bounded body reads,
│  │                                   navigation grouping. Emits redacted events only.
│  └─ fixtures/    @tracelens/fixtures Deterministic HTTP fixture server for tests
│                                      (2xx/4xx/5xx, redirects, delay, large/binary body,
│                                      auth, cache, service worker, CORS failure).
├─ apps/
│  └─ desktop/     Electron main + React renderer           (Sprint 2+)
├─ sdk/            @tracelens/node, @tracelens/next         (Phase 2)
├─ scripts/        spike CLI, perf fixtures
└─ docs/           RFCs, ADRs, support matrix
```

### Data flow

```
Playwright context events ──► capture/normalizer ──► core/redact ──► core/RingBuffer ──► IPC ──► renderer
                                                                         │
                                                                         └──► SQLite (on explicit Save)
```

Key design rules:

1. **One process boundary for secrets.** Capture runs in Electron *main* (or a utility process). Redaction happens there. The renderer only ever receives redacted events.
2. **Upsert model.** An exchange has a stable `id`; capture emits `pending → complete | failed` updates for the same id so the list can render requests the moment they start.
3. **Bounded everything.** Body preview cap (default 256 KB), event cap per session (default 10k, ring buffer), dropped/truncated counters surfaced in UI.
4. **Prefer Playwright API, CDP only where needed** (initiator stacks, precise timing, streaming body limits) behind a small adapter so CDP churn is contained.

---

## 4. Phase plan

### Phase 0 — Feasibility spike (Sprint 1: 3 Nov → 14 Nov)

Goal: prove the hard parts headless-first, then headed, without UI polish.

| Backlog | Work item | Done when |
|---|---|---|
| B1 | Event schema + redaction policy in `@tracelens/core` | Zod schema; header/query/JSON-path/form redaction; unit tests incl. US-04 |
| B3 | Capture start/finish/failure lifecycle + redirect chains | Fixture tests: 200, 404, 500, 302→200 chain, DNS failure, abort |
| B4 | Bounded text body previews | JSON/text decoded; >cap truncated with flag; binary → metadata + reason |
| B5 | Normalization + ring buffer | Cap enforced; dropped count exposed |
| B10 (part) | Fixture server + integration tests | Runs in CI headless |
| B2 | Headed Chromium spike from a CLI (`pnpm spike <url>`) | Developer can browse a real site and see live redacted events in terminal |
| — | Spike: Electron hosting Playwright | Electron main launches Playwright Chromium on Windows + macOS; notes on packaging browser binaries |

**Exit gate:** URL → interactive browsing → request list → safe response detail, demoed on 3 authorized live sites (incl. one with login).

### Phase 1 — MVP desktop URL inspector (Sprints 2–4: 17 Nov → 23 Dec)

**Sprint 2 — Shell & live list**
- Electron app skeleton (main / preload / renderer, contextIsolation on, no nodeIntegration).
- Home screen: Inspect URL, URL validation (URL-01), recent sessions placeholder.
- Session workspace: start/stop, visible **recording indicator**.
- Typed IPC channel streaming event batches (throttled ~16 ms).
- Virtualized request table (TanStack Virtual) — UI-01, 2,000-event fixture.

**Sprint 3 — Detail, filters, errors**
- Detail panes: Overview, Headers, Request, Response, Timing, Initiator, Notes — UI-03, with explicit missing-data states (US-06).
- JSON pretty viewer; inert text rendering for HTML/JS.
- Filters: method, status class, domain, type, source; free-text search over URL + sanitized text — UI-02, p95 < 200 ms @ 2k events.
- Network error surfacing (ERR-01): DNS, TLS, blocked, aborted, timeout.
- Settings: body cap, event cap, custom redaction rules, blocked domains.
- Auth flow tests: cookie login, OAuth redirect.

**Sprint 4 — Persistence, export, packaging**
- SQLite (better-sqlite3) store; explicit Save session; delete session; retention/auto-expiry (SEC-02).
- Export HAR 1.2 + native JSON with sensitive-data warning dialog (EXP-01).
- Navigation grouping + basic waterfall (UI-04, P1 — stretch).
- Copy as cURL with secrets stripped (DX-01, P1 — stretch).
- Windows (NSIS/MSIX) + macOS (dmg, notarized) packages; Chromium download on first run with progress.
- First-run docs: "What TraceLens can and cannot see" trust-boundary page.
- Stability soak: 30 min / 5,000 events, no crash; memory budget recorded.

**Exit gate:** 10–15 pilot developers independently reproduce and export an authorized live-site issue. ≥7/10 complete scripted task unaided.

### Phase 2 — App Connect for Next.js/Node (Sprints 5–7: Jan → mid-Feb 2027)

Starts with an **RFC (B12) written during Sprint 4**, covering:
- Local collector: loopback-only HTTP/WebSocket endpoint in the desktop app, session-scoped token.
- `@tracelens/node`: OTel-based undici/fetch instrumentation; initiated/completed/error phases with stable id + traceparent.
- `@tracelens/next`: `instrumentation.ts` registration; route attribution where available, not guaranteed.
- Correlation (COR-01): link only on matching W3C trace context; otherwise show "unlinked", never guess.
- Production guards: metadata-only default, target allowlist, server-enforced short-lived debug grants, circuit breaker, async bounded exporter, kill switch.
- Support matrix: Node 20/22 LTS × Next.js 14/15/16 × node runtime (Edge runtime explicitly unsupported initially).

**Exit gate:** sample Next.js deployment shows a browser navigation linked to its SSR backend fetches with no secret leakage (verified by redaction tests over captured output).

### Phase 3 — Advanced workflows (post-validation)
Duplicate request detection, request comparison/JSON diff (DX-02), annotations export (DX-03), mock/replay (MOCK-01), proxy research (PROXY-01). Prioritize from pilot data.

---

## 5. Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | Schema, redaction (table-driven, incl. adversarial cases: mixed-case headers, nested JSON arrays, URL-encoded secrets, userinfo in URLs), ring buffer, HAR mapping |
| Capture integration | Vitest + Playwright (headless) + fixture server | Every PRD §13/B10 scenario: success, 4xx/5xx, redirect, delay, timeout, large body, binary, auth, cache, service worker, CORS, aborted-by-navigation |
| Redaction guarantee | Canary test | Fixture sends known canary secrets; assert canary string never appears in buffer, SQLite file, HAR or IPC payloads |
| UI / E2E | Playwright driving Electron | Start session → see list → filter → open detail → export |
| Performance | Scripted fixture (2k / 5k events) | Filter p95, memory, 30-min soak |

CI: GitHub Actions, Windows + macOS runners, `pnpm typecheck && pnpm test`.

---

## 6. Risks to watch early

| Risk | Early signal | Response |
|---|---|---|
| Playwright `response.body()` loads full body into memory | Large-body fixture spikes RAM | Check `content-length` first; skip > hard cap; CDP `Network.getResponseBody`/streaming adapter if needed |
| Bundling Chromium in Electron (size, AV false-positives on Windows) | Installer > 300 MB, SmartScreen warnings | Download browser on first run; code-sign early |
| SSO popups / new tabs escape capture | Login flows missing requests | Capture at **context** level (all pages/popups), not page level — already the design |
| Redaction misses | Canary test failure | Fail closed: unknown auth-like header names matched by pattern, not only allowlist |
| Users read Browser events as server internals | Pilot confusion | Source badge everywhere; trust-boundary banner on Inspect URL sessions |

---

## 7. Phase 1 progress

| Item | Status |
|---|---|
| Electron shell (contextIsolation, sandboxed renderer, CJS preload, no navigation/window.open, sender-checked IPC, prod CSP) | ✅ |
| Home: Inspect URL with validation (URL-01), trust-boundary copy, Connect App placeholder | ✅ |
| Workspace: recording indicator, Stop, Clear, New session (with discard confirm) | ✅ |
| Main→renderer streaming: 50 ms coalesced batches; ring-buffer evictions propagated | ✅ |
| Virtualized table with follow-tail, keyboard nav, grid ARIA (UI-01) | ✅ |
| Filters: text (+ opt-in body search), status class, type, source, method, domain (UI-02) | ✅ (pure filter in core; 2k-event p95 test) |
| Detail: Overview, Headers, Request, Response, Timing with masked-value highlighting and explicit unavailable states (UI-03, US-06) | ✅ |
| Export HAR 1.2 + native JSON behind a sensitivity warning (EXP-01) | ✅ |
| E2E: Playwright drives the built app against fixtures | ✅ |
| Initiator and Notes tabs | ⏭ (initiator needs CDP; notes is DX-03) |
| Settings screen (caps, custom redaction rules, blocked domains) | ⏭ Sprint 3 |
| SQLite persistence / Save session / retention (SEC-02) | ⏭ Sprint 4 |
| Navigation-grouped waterfall (UI-04), copy as cURL (DX-01) | ⏭ Sprint 4 stretch |
| Packaging (NSIS/dmg), first-run browser check, signing | ⏭ Sprint 4 |
| Renderer bundle is ~840 KB unminified, mostly Zod pulled in via `@tracelens/core`; split a schema-free entry for the renderer | ⏭ |
| Stop responds in ~30 ms: capture announces stop after closing the context and lets the browser process exit in the background (Chrome took 0.3–3.5 s to exit on Windows) | ✅ |

## 8. Phase 2 progress (App Connect)

Design: [docs/rfc-001-app-connect.md](docs/rfc-001-app-connect.md).

| Item | Status |
|---|---|
| RFC: trace propagation, linking rule, transport, safety defaults | ✅ |
| `@tracelens/collector`: loopback-only, bearer token (timing-safe), rejects `Origin` and foreign `Host` (DNS rebinding), 1 MB / 500-event caps, Zod-validated, kill-switch reply | ✅ |
| `@tracelens/node`: `fetch`/undici via `diagnostics_channel` (no monkey-patching); incoming `traceparent` via `http.server.request.start` + AsyncLocalStorage; metadata only | ✅ Node 20 and 22 |
| SDK safety: off without env, loopback-only collector, production opt-in, `TRACELENS_DISABLED`, bounded coalescing queue, circuit breaker, self-disable on 401/403 or kill switch, never throws into host app | ✅ |
| Capture: `traceparent` injected only for the connected origin (Playwright routing); browser event records the same trace id | ✅ |
| Server events re-redacted on ingest, `source` forced, ids namespaced so they cannot overwrite browser events | ✅ |
| Desktop: collector for app lifetime, token persisted in userData with Regenerate, Connect App panel with copyable env/snippets, "This is my app" option | ✅ |
| Linking UI (COR-01): browser request → "Server calls"; server call → "Triggered by" + "Handled request"; explicit "Not linked" state | ✅ |
| E2E: real app + real browser + sample Node app with SDK + upstream; asserts linking both ways and that the API key never renders | ✅ |
| `@tracelens/next` wrapper | ✅ written · ⚠️ **not yet validated against a real Next.js app** |
| Sample Next.js app + support matrix (Next 15/16 × `next dev`/`next start`) — Phase 2 exit gate | ⏭ next |
| Publishable SDK builds (packages currently export TS source; Next would need `transpilePackages`) | ⏭ |
| `node:http`/`https` client + Axios coverage | ⏭ |
| Server events in HAR export carry `_source: server`; consider a separate "server" page grouping | ⏭ |

## 9. Phase 0 next steps (Day 1)

1. ✅ Monorepo scaffold, TypeScript, Vitest.
2. ✅ `@tracelens/core`: event schema, redaction, ring buffer.
3. ✅ `@tracelens/fixtures`: fixture server.
4. ✅ `@tracelens/capture`: Playwright session engine + integration tests.
5. ✅ `pnpm spike <url>` headed CLI.
6. ⏭ Electron-hosts-Playwright spike on Windows.
7. ⏭ Try the spike on 3 authorized live sites; log gaps in `docs/spike-findings.md`.
8. ⏭ Fixture scenarios still missing: service worker, HTTP cache (304 / memory cache), CORS failure, OAuth redirect login.

### Findings so far (Day 1)

- **Corporate TLS interception blocks `playwright install`** (self-signed cert in chain). The engine therefore falls back to the user's installed Chrome/Edge via Playwright `channel`. This is worth keeping as a product option: it removes ~150 MB from the installer. We will not disable TLS validation to work around it (PRD §10.8).
- **Redaction must cover page source, not just API payloads.** The canary test caught secrets in inline `<script>` config and embedded URLs; the redactor now masks sensitive `key: "value"` assignments and query params in HTML/JS/plain text.
- **Truncated JSON is a leak risk.** The text fallback had a bug where a non-string value swallowed a nested secret; covered by a unit test now.
- **Node 20 is past EOL (Apr 2026).** Vitest 5 already requires Node 22. Pinned Vitest 4 for now; move the team to Node 22 LTS (`.nvmrc`) and lift the pin.
- **Electron binary download hangs** behind the same proxy (the postinstall prints nothing and never finishes), although Node's own `fetch` reaches GitHub fine. Workaround used: download `electron-v<ver>-win32-x64.zip` from the GitHub release, verify its SHA-256 against `node_modules/electron/checksums.json`, extract it to `node_modules/electron/dist`, and write `electron.exe` to `node_modules/electron/path.txt`. Long term: set `ELECTRON_MIRROR` to an internal mirror, or have IT supply the corporate root CA via `NODE_EXTRA_CA_CERTS`.
- Capture uses Playwright APIs only so far; no CDP needed yet. `response.body()` buffers whole bodies, so oversize responses are skipped via `Content-Length` when declared — chunked responses without it are still read fully (CDP streaming adapter if this bites).
