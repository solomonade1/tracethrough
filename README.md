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

Safety defaults: off unless both variables are set; collector must be loopback; off when `NODE_ENV=production` unless `TRACELENS_ALLOW_PRODUCTION=1`; `TRACELENS_DISABLED=1` forces it off. Links are shown only on an exact trace-id match, never guessed. Supported today: Node 20/22 `fetch` (undici). Not yet: `node:http`/Axios clients, Edge runtime.

## Ground rules

- Redaction happens in the capture process **before** anything is buffered, stored, exported or displayed.
- Every event is labelled `browser` or `server`; Inspect URL never claims to see a remote site's server-side calls.
- Server events are untrusted input: the desktop re-applies redaction and forces `source: server` regardless of what the SDK sent.
- Missing/truncated/binary bodies carry an explicit `unavailableReason`; content is never fabricated.
