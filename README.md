# TraceLens (codename)

Developer-first network inspector: enter a URL, browse it in an isolated Chromium, inspect redacted browser traffic.
See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for phases and scope. Currently in **Phase 1 — desktop MVP** (Sprint 2–3 scope built).

## Packages

| Package | Purpose |
|---|---|
| `apps/desktop` | Electron + React app: Inspect URL, live request table, filters, detail panes, HAR/JSON export |
| `packages/core` | Event schema (Zod), redaction engine, body previews, ring buffer, filtering, HAR/JSON export |
| `packages/capture` | Playwright capture session: isolated context → redacted `NetworkEvent`s |
| `packages/fixtures` | Deterministic HTTP fixture site used by tests (plants a canary secret) |
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

## Ground rules

- Redaction happens in the capture process **before** anything is buffered, stored, exported or displayed.
- Every event is labelled `browser` or `server`; Inspect URL never claims to see a remote site's server-side calls.
- Missing/truncated/binary bodies carry an explicit `unavailableReason`; content is never fabricated.
