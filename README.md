# TraceLens (codename)

Developer-first network inspector: enter a URL, browse it in an isolated Chromium, inspect redacted browser traffic.
See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for phases and scope. Built so far: Phase 1 core inspector and **Phase 2 App Connect** for Node (design: [docs/rfc-001-app-connect.md](docs/rfc-001-app-connect.md)).

## Packages

| Package | Purpose |
|---|---|
| `apps/desktop` | Electron + React app: Inspect URL, live request table, filters, detail panes, HAR/JSON export, App Connect |
| `packages/core` | Event schema (Zod), redaction engine, body previews, ring buffer, filtering, HAR/JSON export, W3C trace context |
| `packages/capture` | Playwright capture session: isolated context → redacted `NetworkEvent`s; `traceparent` for a connected origin |
| `packages/collector` | Loopback-only ingest endpoint for App Connect SDKs |
| `packages/node` | `@tracelens/node` SDK: reports a Node server's outgoing `fetch` calls, linked by trace context |
| `packages/next` | `@tracelens/next`: `instrumentation.ts` wrapper (Node runtime only) |
| `packages/fixtures` | Deterministic HTTP fixture site used by tests (plants a canary secret) |
| `examples/node-app` | Sample "owned" app for trying App Connect |
| `scripts/` | `spike` CLI and standalone fixture server |

## Getting started

Requires **Node 22.12+** (see `.nvmrc`; Electron will not install on Node 20) and pnpm 10.

```bash
nvm use 22
```

```bash
pnpm install
```

A Chromium-family browser is needed. The engine tries Playwright's bundled Chromium, then installed Chrome, then Edge.
To install the bundled build (optional):

```bash
pnpm browsers:install
```

Run the desktop app (dev mode with hot reload):

```bash
pnpm app
```

Enter a URL (try the fixture site below) and click **Start session**. A separate browser window opens; browse there and requests stream into the app.

Or run it in your own browser instead of Electron (**local web mode**): same UI, same capture engine, same App Connect token.

```bash
pnpm web
```

It builds the UI, starts a server on `127.0.0.1:47812` (falls back to a free port) and opens your browser at a link that carries a per-run access token in the URL fragment. Options: `--port <n>`, `--no-open`; the `TRACELENS_*` environment overrides of the desktop app apply too. Capture still runs on this machine: sessions open in a separate Chrome/Edge window, exactly as in the desktop app. Exports download through the browser.

Web mode safety: loopback only; every API call needs the token (sent as a header, never a cookie, so other local servers on `127.0.0.1` never receive it); requests with a foreign `Host` (DNS rebinding) or `Origin` are refused; strict CSP. Not yet: hot reload for the web UI (rebuild with `pnpm web`), and a published `npx` package.

Run the tests (unit + headless capture integration):

```bash
pnpm test
```

```bash
pnpm typecheck
```

End-to-end test (builds the app, then drives it with Playwright's Electron support; capture runs headless):

```bash
pnpm test:e2e
```

If Electron's postinstall hangs behind a TLS-intercepting proxy, see "Electron binary" in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

## Packaging (Windows installer)

```bash
pnpm package:win
```

Produces `apps/desktop/release/TraceLens-Setup-<version>-x64.exe` (per-user NSIS installer; lets the user choose the folder, adds Start menu and desktop shortcuts) and the unpacked app in `apps/desktop/release/win-unpacked/`. The installer does **not** include a browser: TraceLens uses the installed Google Chrome or Microsoft Edge, and the Home screen says so (and disables Start) when neither is found.

Run the end-to-end suite against the packaged app rather than the dev build:

```bash
TRACELENS_E2E_EXECUTABLE=apps/desktop/release/win-unpacked/TraceLens.exe pnpm exec vitest run --config apps/desktop/vitest.config.ts
```

Not done yet: code signing (unsigned builds trigger a Windows SmartScreen "unknown publisher" prompt; pilots choose **More info → Run anyway**), auto-update, and macOS/Linux builds (configured, but must be built on those platforms). The icon in `apps/desktop/build/icon.png` is a generated placeholder (`pnpm exec tsx scripts/make-icon.ts`).

Inspect a site interactively (headed browser; close the window or Ctrl+C to stop):

```bash
pnpm spike https://example.com
```

Options: `--channel chrome|msedge|chromium`, `--headless`, `--for <seconds>`. On stop, the sanitized session is written to `.tracelens/session-<id>.json` (git-ignored).

Try it against the local fixture site:

```bash
pnpm fixtures
```

```bash
pnpm spike http://127.0.0.1:4789/basic
```

Set `TRACELENS_BROWSER_CHANNEL=chrome` (or `msedge`) to force a browser in tests.

## App Connect (your own Node / Next.js app)

Shows the HTTP calls **your** server makes (e.g. SSR data fetches) next to browser traffic, linked to the browser request that caused them. Metadata only: server-side bodies are never captured.

1. Run `pnpm app`. The **Connect App** card shows the collector address and a token (stored per install; regenerate any time).
2. Give your app `TRACELENS_COLLECTOR_URL` and `TRACELENS_TOKEN`, and call `register()` from `@tracelens/node` (or `@tracelens/next` in `instrumentation.ts`).
3. Start a session on your app's URL with **This is my app** ticked. TraceLens adds a `traceparent` header to requests to that origin only; server calls made while handling them show as **Server** rows, linked both ways in the detail pane.

Try it with the sample app (with the fixture site running as its upstream; copy the values from the Connect App card):

```bash
TRACELENS_COLLECTOR_URL=http://127.0.0.1:47811 TRACELENS_TOKEN=<token> UPSTREAM_URL=http://127.0.0.1:4789 pnpm example:node
```

Then inspect `http://127.0.0.1:3005/` with **This is my app** ticked.

Or with the Next.js sample (`examples/next-app`: an SSR page that fetches upstream while rendering, plus a route handler the browser calls):

```bash
TRACELENS_COLLECTOR_URL=http://127.0.0.1:47811 TRACELENS_TOKEN=<token> UPSTREAM_URL=http://127.0.0.1:4789 pnpm example:next
```

Then inspect `http://localhost:3000/` with **This is my app** ticked.

Safety defaults: off unless both variables are set; collector must be loopback; off when `NODE_ENV=production` unless `TRACELENS_ALLOW_PRODUCTION=1`; `TRACELENS_DISABLED=1` forces it off. Links are shown only on an exact trace-id match, never guessed.

### Support matrix (verified 3 Nov 2026, Node 22.20, Windows)

| | SSR fetch in a page | Fetch in a route handler | First render of a page after compile / boot |
|---|---|---|---|
| Plain Node `http` server | n/a | ✅ linked | ✅ linked |
| Next.js 16.4 `next dev` | ✅ linked | ✅ linked | ✅ linked (via Next's request store) |
| Next.js 16.4 `next start` | ✅ linked | ✅ linked | ✅ linked |
| Next.js 15.5 `next dev` / `next start` | ✅ linked | ✅ linked | ⚠️ shown as "Not linked" |

Known limitations:
- **Next.js 15:** the first render of each page after a compile (dev) or server boot (start) runs outside the request's async context, and Next 15 keeps its request store private, so that one render's calls appear unlinked. Next 16 exposes the store globally and has no gap.
- **Next.js 15 + TypeScript 7:** Next 15 refuses TypeScript 7 (it needs the JS compiler API); use TypeScript 6. The sample pins `typescript@^6`.
- The framework's own calls (Next telemetry, Next dev's version check against `registry.npmjs.org`) appear as unlinked Server rows. Set `NEXT_TELEMETRY_DISABLED=1` to quiet the first.
- Clients: Node `fetch` (undici) only. Not yet: `node:http`/`https`, Axios. Edge runtime is not supported.
- In this monorepo the packages export TypeScript source, so a Next app needs `transpilePackages: ['@tracelens/next', '@tracelens/node', '@tracelens/core']` (see the sample's `next.config.mjs`). Published builds will not.

Smoke-test the SDK inside Next.js without the desktop app (prints which calls linked to which trace):

```bash
pnpm smoke:next dev
```

End-to-end test against the real Next.js sample (slower; builds the desktop app first):

```bash
pnpm test:e2e:next
```

## Ground rules

- Redaction happens in the capture process **before** anything is buffered, stored, exported or displayed.
- Every event is labelled `browser` or `server`; Inspect URL never claims to see a remote site's server-side calls.
- Server events are untrusted input: the desktop re-applies redaction and forces `source: server` regardless of what the SDK sent.
- Missing/truncated/binary bodies carry an explicit `unavailableReason`; content is never fabricated.
