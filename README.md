# TraceLens (codename)

Developer-first network inspector: enter a URL, browse it in an isolated Chromium, inspect redacted browser traffic.
See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for phases and scope. Currently in **Phase 0 — feasibility spike**.

## Packages

| Package | Purpose |
|---|---|
| `packages/core` | Event schema (Zod), redaction engine, body previews, ring buffer |
| `packages/capture` | Playwright capture session: isolated context → redacted `NetworkEvent`s |
| `packages/fixtures` | Deterministic HTTP fixture site used by tests (plants a canary secret) |
| `scripts/` | `spike` CLI and standalone fixture server |

## Getting started

Requires Node 20+ (Node 22 recommended, see `.nvmrc`) and pnpm 10.

```bash
pnpm install
```

A Chromium-family browser is needed. The engine tries Playwright's bundled Chromium, then installed Chrome, then Edge.
To install the bundled build (optional):

```bash
pnpm browsers:install
```

Run the tests (unit + headless capture integration):

```bash
pnpm test
```

```bash
pnpm typecheck
```

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
