# TraceThrough

A developer network inspector. Enter a URL, browse it in an isolated Chrome or Edge window, and inspect the traffic: full headers, cookies, tokens and bodies, as captured. If you own the app, connect it and TraceThrough also shows the HTTP calls your **server** makes (for example SSR data fetches), linked to the browser request that caused them.

- **Local-first:** captured traffic stays on your machine: it is held in memory and written only when you export it. (The site you inspect still receives the normal requests your browser makes.)
- **Unmasked by default, masking on request:** you see every value as it was sent. Tick **Mask secrets** before a session to hide tokens, cookies, API keys and passwords from the UI and exports (for screenshots or sharing).
- **Honest:** every row is labelled **Browser** or **Server**. For sites you don't own you only see browser traffic.

Contents: [Install](#install) · [Inspect a website](#inspect-a-website) · [Connect your own app](#connect-your-own-app) · [Run in your browser](#run-in-your-browser-no-installer) · [Troubleshooting](#troubleshooting) · [Develop](#develop-this-repository) · [Release](#releasing)

---

## Install

Download the installer for your system from the **[latest release](../../releases/latest)**:

| System | File |
|---|---|
| Windows 10/11 (x64) | `TraceThrough-Setup-<version>-x64.exe` |
| macOS, Apple Silicon (M1 and later) | `TraceThrough-<version>-mac-arm64.dmg` |
| macOS, Intel | `TraceThrough-<version>-mac-x64.dmg` |
| Linux (x64) | `TraceThrough-<version>-linux-<arch>.AppImage` |

`SHA256SUMS.txt` in the release lets you verify the downloads.

TraceThrough opens sites in **Google Chrome or Microsoft Edge**, which it uses from your machine (it doesn't bundle a browser). The home screen tells you if neither is found.

### Unsigned builds

Installers are unsigned unless a release's notes say otherwise. The release workflow can sign Windows installers and sign and notarize macOS ones when the maintainers configure certificates, and each release's notes list what was *verified on the finished installer* (never merely "configured"). For an installer listed as unsigned, your OS warns before the first run and the steps below apply. Check the download against `SHA256SUMS.txt` either way.

- **Windows:** SmartScreen shows "Windows protected your PC". Click **More info**, then **Run anyway**.
- **macOS:** open the `.dmg` and drag TraceThrough to Applications. If macOS says the app is damaged or can't be opened, run `xattr -cr /Applications/TraceThrough.app` once, then open it. (Or right-click the app, choose **Open**, then **Open**.)
- **Linux:** make the file executable, then run it:
  ```bash
  chmod +x TraceThrough-*.AppImage
  ./TraceThrough-*.AppImage
  ```
  AppImages need FUSE (`libfuse2` on Ubuntu 22.04+). If the app exits with a sandbox error (common on Ubuntu 24.04), run it with `--no-sandbox`.

---

## Inspect a website

1. Open TraceThrough, enter a URL such as `https://example.com`, and click **Start session**. Paste the full URL; the box starts with `https://`, and a doubled scheme is corrected for you.
2. A separate browser window opens with a fresh, empty profile. Browse there as normal.
3. Every request streams into TraceThrough. Click a row to see its overview, headers, request, response and timing.
4. Use the search box and the filter chips (status class, type, Browser/Server, method, domain) to narrow the list. Tick **Bodies** to search body previews too.
5. **Export HAR** or **Export JSON** saves the session. Without **Mask secrets** the file contains live cookies and tokens: treat it as a secret. Sessions live in memory until you export them. HAR entries carry the HTTP version the browser reported (`http/1.1`, `h2`, `h3`); when it was not observed (server-side events, older sessions) the entry says `unknown` rather than guessing HTTP/1.1.

Only inspect sites you are authorized to access.

What you'll see: requests, redirects, failures (with the reason, such as a DNS error), timings, and headers and bodies exactly as captured (masked if you ticked **Mask secrets**). Missing, truncated, binary or streamed bodies say why instead of showing an empty string.

---

## Connect your own app

Connecting adds your server's outgoing `fetch` calls to the list, each linked to the browser request that triggered it. It works for **Node.js** servers and **Next.js** (Node runtime). Each server call shows its URL, method, status, timing, headers, and request and response bodies (previews up to 64 KB each by default).

### 1. Get the connection details

Open TraceThrough. The **Connect App** card on the home screen shows:

- a **collector URL**, `http://127.0.0.1:47811` by default
- a **token**, stored per install (you can regenerate it)

### 2. Install the SDK

For Next.js:

```bash
npm install @tracethrough/next
```

For any other Node.js server:

```bash
npm install @tracethrough/node
```

Both work with npm, pnpm and yarn. Node.js 20 or later.

### 3a. Next.js

Create `instrumentation.ts` in the project root (or `src/`). Next loads it automatically.

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { register } = await import('@tracethrough/next');
    register();
  }
}
```

Start your app with the connection details:

```bash
TRACETHROUGH_COLLECTOR_URL=http://127.0.0.1:47811 TRACETHROUGH_TOKEN=<token> npm run dev
```

On Windows PowerShell:

```powershell
$env:TRACETHROUGH_COLLECTOR_URL="http://127.0.0.1:47811"; $env:TRACETHROUGH_TOKEN="<token>"; npm run dev
```

### 3b. Plain Node.js

Call `register()` once, **before** your server makes any requests (first import in your entry file):

```ts
import { register } from '@tracethrough/node';

register();

// ...the rest of your server
```

Then start it with the same two environment variables.

`register()` returns a handle: `handle.enabled` tells you whether it is active and `handle.disabledReason` says why not. It stays silent when the two variables are unset, so print the result while setting up:

```ts
const handle = register();
console.log(handle.enabled ? 'TraceThrough connected' : `TraceThrough off: ${handle.disabledReason}`);
```

### 4. Inspect your app

In TraceThrough, enter your app's URL (for example `http://localhost:3000`), **tick "This is my app"**, and start the session. TraceThrough adds a `traceparent` header to requests to that origin only. Server calls made while handling those requests appear as **Server** rows, and the detail pane links each browser request to its server calls and back. Links are shown only on an exact trace-id match, never guessed.

### Options and safety defaults

`register()` takes optional settings; each also has an environment variable where noted.

| Setting | Env var | Default |
|---|---|---|
| `collectorUrl` | `TRACETHROUGH_COLLECTOR_URL` | none (SDK stays off) |
| `token` | `TRACETHROUGH_TOKEN` | none (SDK stays off) |
| `allowProduction` | `TRACETHROUGH_ALLOW_PRODUCTION=1` | off in production |
| `allowTargets` | | all hosts; list hostnames or patterns to restrict |
| `redaction` | | `false`: values sent as captured; pass a policy (see `@tracethrough/core`) to mask in the SDK |
| `captureBodies` | `TRACETHROUGH_CAPTURE_BODIES=0` turns it off | on |
| `maxBodyBytes` | | 64 KB per body (max 512 KB); longer bodies are truncated |
| | `TRACETHROUGH_DISABLED=1` | forces the SDK off |

- It does nothing unless both the URL and the token are set.
- The collector must be a loopback address (`127.0.0.1` or `localhost`); remote collection is not supported.
- It is off when `NODE_ENV=production`, unless you opt in.
- Values only ever go to the local collector. The TraceThrough app masks them when the session has **Mask secrets** ticked, and always forces them to `source: server` whatever the SDK sent.
- Masking applies to server events as well when it is on: multipart bodies are omitted (`omitted-by-policy`, MIME type and size kept). With the SDK's unmasked default, and with **Mask secrets** off in the app, previews are raw by design.
- Retained body memory is bounded. The SDK reads at most `maxBodyBytes` of any body (never the whole of a large or endless one), and the app keeps at most 10,000 events and about 128 MiB of event data, oldest first (a size estimate, not a process-memory ceiling). Browser bodies are read at most 4 at a time. Playwright's response API cannot stop a read early, so for browser traffic the limit is applied to what is stored and a size announced in headers is checked before reading; a response that lies about its size can still be read in full once.
- Body capture wraps `globalThis.fetch` (Node's undici exposes no body bytes to diagnostics channels). Responses are read from a clone, so your code still gets the full body; streamed (`text/event-stream`) and binary bodies are reported, not read.

### Support matrix

**Automated** (`pnpm test:next-matrix`, the "Next.js matrix" job in CI): the sample app is built and served with real `next dev` and `next start` on Next.js 15.5.29 (TypeScript 5.9) and 16.4.4 (TypeScript 6), and each cell asserts first render, a later render, route handlers, concurrent requests (no request ever inherits another's trace), no invented trace for prerender or cache work, only trace ids the test sent, and the production opt-in. Fallback when Next's internal storage is missing is covered by unit tests (`packages/next/test/storage-fallback.test.ts`).

| Automated | SSR fetch in a page | Fetch in a route handler | First render after compile / boot |
|---|---|---|---|
| Next.js 16.4.4 `dev` and `start` | linked | linked | linked |
| Next.js 15.5.29 `dev` and `start` | linked | linked | linked to its own request **or** unlinked; never another's |

**Manual observations** (not covered by CI):

| | Result | Observed |
|---|---|---|
| Plain Node `http` server | linked, including the first request | 3 Nov 2026, Node 22.20, Windows (the desktop e2e suite also links a plain Node sample) |
| Next.js 15.5 `dev` / `start`, first render | shown as "Not linked" | 3 Nov 2026, Node 22.20, Windows |
| Next.js 15.5.29 `dev` / `start`, first render | linked | 5 Nov 2026, automated run, Windows |

The two Next 15 observations disagree, so the first-render gap stays documented as a limitation: it depends on timing and a reliable fix has not been shown. The adapter only links on an exact trace-id match, so the worst case is an unlinked row, not a wrong link.

Known limitations:

- **Clients:** Node `fetch` (undici) only. Not yet: `node:http`/`https` clients, Axios. The Edge runtime is not supported.
- **Next.js 15:** the first render of each page after a compile (dev) or server boot (start) can run outside the request's async context, so that render's calls may show as unlinked (see the observations above). Next 16 has no gap.
- **Next.js internals:** the adapter reads Next's private request store; if a Next release changes or removes it, App Connect degrades to unlinked server rows and never breaks the app. The matrix above is what has been tested; other versions are untested.
- **Next.js 15 + TypeScript 7:** Next 15 needs TypeScript 6 or earlier.
- The framework's own calls (Next telemetry, Next dev's version check) appear as unlinked Server rows. Set `NEXT_TELEMETRY_DISABLED=1` to quiet the first.

### Try it with the samples

The repository has two sample apps and a fixture API. See [Develop](#develop-this-repository).

---

## Run in your browser (no installer)

From a checkout of this repository, `pnpm web` serves the same UI in your own browser instead of Electron (details under [Develop](#develop-this-repository)). Capture still runs on your machine and opens a separate Chrome or Edge window. It binds to `127.0.0.1` only, requires a per-run access token (sent as a header, never a cookie), refuses requests with a foreign `Host` or `Origin`, and sets a strict CSP. A published `npx` package is planned.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "needs Google Chrome or Microsoft Edge" | Install one and restart TraceThrough. |
| Row fails with `ERR_NAME_NOT_RESOLVED` | The hostname doesn't resolve on this machine (typo, VPN-only domain, or a doubled `https://`). Check with `nslookup <host>`. |
| No **Server** rows for my app | Both env vars must be set, the app must not run with `NODE_ENV=production`, and **This is my app** must be ticked. Check `register().enabled` and `disabledReason`. |
| Server rows appear but say "Not linked" | You inspected a different origin than the one ticked, or you're on Next 15 (first render only). See the support matrix. |
| `EADDRINUSE` / collector port busy | Another copy is running, or set `TRACETHROUGH_COLLECTOR_PORT` and update `TRACETHROUGH_COLLECTOR_URL` to match. |
| My app is not on localhost | The SDK only reports to a loopback collector, so run TraceThrough on the same machine as the app. |
| Windows SmartScreen / macOS "damaged" | See [Unsigned builds](#unsigned-builds). |

Environment variables for the app itself: `TRACETHROUGH_BROWSER_CHANNEL` (`chrome`, `msedge` or `chromium`), `TRACETHROUGH_COLLECTOR_PORT`, `TRACETHROUGH_COLLECTOR_TOKEN`, `TRACETHROUGH_HEADLESS_CAPTURE=1`, and for web mode `TRACETHROUGH_WEB_PORT`.

---

## What's in this repository

| Path | Purpose |
|---|---|
| `apps/desktop` | Electron + React app and the local web mode |
| `packages/core` | `@tracethrough/core`: event schema (Zod), redaction, body previews, ring buffer, filtering, HAR/JSON export, W3C trace context |
| `packages/node` | `@tracethrough/node`: SDK that reports a Node server's outgoing `fetch` calls |
| `packages/next` | `@tracethrough/next`: `instrumentation.ts` wrapper for Next.js |
| `packages/capture` | Playwright capture session (private, bundled in the app) |
| `packages/collector` | Loopback ingest endpoint for the SDKs (private, bundled in the app) |
| `packages/fixtures` | Deterministic fixture site used by tests (private) |
| `examples/node-app`, `examples/next-app` | Sample apps for trying App Connect |
| `scripts/` | `spike` CLI, fixture server, icon and smoke-test scripts |

Only `core`, `node` and `next` are published to npm. See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for phases and scope and [docs/rfc-001-app-connect.md](docs/rfc-001-app-connect.md) for the App Connect design.

---

## Develop this repository

Requires **Node 22.12+** (see `.nvmrc`; Electron will not install on Node 20) and pnpm 10.

```bash
pnpm install
```

If `pnpm app` later fails with "Electron uninstall", pnpm skipped Electron's binary download. Run its install script once:

```bash
node node_modules/.pnpm/electron@*/node_modules/electron/install.js
```

Run the desktop app with hot reload:

```bash
pnpm app
```

Or run the web mode (builds the UI, serves on `127.0.0.1:47812`, opens your browser with a per-run token; options `--port <n>` and `--no-open`):

```bash
pnpm web
```

An optional bundled Chromium (the engine tries it first, then Chrome, then Edge):

```bash
pnpm browsers:install
```

Checks:

```bash
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm test:e2e
```

```bash
pnpm smoke:packages
```

`smoke:packages` packs `core`, `node` and `next` as publishing would, installs the tarballs into a clean project outside the workspace and exercises them (nothing is published). `pnpm test:next-matrix` runs the Next.js 15/16 dev and start matrix (slow; `NEXT_MATRIX=15:dev` runs one cell).

`test:e2e` builds the app and drives it with Playwright's Electron support, with capture headless. `pnpm test:e2e:next` runs the same against the Next.js sample. If Electron's postinstall hangs behind a TLS-intercepting proxy, see "Electron binary" in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

CI ([ci.yml](.github/workflows/ci.yml)) runs these on Windows, macOS and Ubuntu for every pull request (required to pass before merging), plus the packed-package smoke test, the Next.js e2e and the Next.js version matrix on Ubuntu, and an unsigned Windows package tested end to end. Release builds go further: each installer is installed on its own OS and the installed app is smoke-tested (`apps/desktop/test/installed.e2e.test.ts`; set `TRACETHROUGH_E2E_EXECUTABLE` to run it against any installed copy).

### Try App Connect with the samples

Start the fixture API, then a sample app, using the token from the **Connect App** card:

```bash
pnpm fixtures
```

```bash
TRACETHROUGH_COLLECTOR_URL=http://127.0.0.1:47811 TRACETHROUGH_TOKEN=<token> UPSTREAM_URL=http://127.0.0.1:4789 pnpm example:node
```

Inspect `http://127.0.0.1:3005/` with **This is my app** ticked. For the Next.js sample use `pnpm example:next` instead and inspect `http://localhost:3000/`. Inside this repository the packages export TypeScript source, so the Next sample sets `transpilePackages` (see its `next.config.mjs`); apps that install from npm do not need it. `pnpm smoke:next dev` checks the SDK inside Next.js without the desktop app.

### Command-line capture

```bash
pnpm spike https://example.com
```

Opens a headed browser; close it or press Ctrl+C to stop. Options: `--channel chrome|msedge|chromium`, `--headless`, `--for <seconds>`. The sanitized session is written to `.tracethrough/session-<id>.json` (git-ignored).

### Build installers locally

Each installer must be built on its own operating system.

```bash
pnpm package:win
```

```bash
pnpm package:mac
```

```bash
pnpm package:linux
```

Output goes to `apps/desktop/release/`.

---

## Releasing

Full step-by-step flow (pushing, npm packages, desktop installers, troubleshooting): [docs/RELEASING.md](docs/RELEASING.md).

### Desktop installers

Bump `version` in `apps/desktop/package.json`, merge it to `main`, then tag that commit and push the tag (replace `X.Y.Z` with the version):

```bash
git tag vX.Y.Z origin/main
```

```bash
git push origin vX.Y.Z
```

[desktop-release.yml](.github/workflows/desktop-release.yml) first checks that the tag equals `v` + the app version and that the tagged commit is on `main`, runs the full CI matrix on that exact commit, builds Windows, macOS (Apple Silicon and Intel) and Linux installers, installs each one on its own OS and smoke-tests it, then writes `SHA256SUMS.txt` and publishes a GitHub Release with everything attached. Run the workflow by hand from the **Actions** tab to test the builds without creating a release.

Signing and notarization are wired in but optional: they run only when the signing secrets exist (see [docs/RELEASING.md](docs/RELEASING.md)), the result is verified on each finished installer, and the release notes say which installers are signed. Without secrets the installers are explicitly unsigned. Not done yet: auto-update, and no signed release has been produced or verified so far.

### SDK packages (npm)

`@tracethrough/core`, `@tracethrough/node` and `@tracethrough/next` are published with [Changesets](https://github.com/changesets/changesets). In the repo their `exports` point at TypeScript source (tests and apps need no build); `publishConfig` swaps in the compiled `dist/` on publish.

1. In a PR that changes one of them, run `pnpm changeset`, pick the bump and describe the change. The **Changeset** CI check fails the PR without one; use `pnpm changeset --empty` for changes that need no release.
2. Merging to `main` makes [release.yml](.github/workflows/release.yml) open a **Version Packages** PR (version bumps and changelogs).
3. Merging that PR builds (`pnpm build:packages`) and publishes to npm with provenance.

One-time setup: create a granular npm token limited to the `@tracethrough` scope and save it as the `NPM_TOKEN` repository secret; allow GitHub Actions to create pull requests (Settings, Actions, General). If you require status checks on `main`, also add a fine-grained token as the `RELEASE_TOKEN` secret, because PRs opened with the default token do not run CI. After the first publish, enable trusted publishing for each package on npmjs.com (repo plus `release.yml`) and delete the secret.

---

## Ground rules

- Masking is optional and raw capture is intentional. Without **Mask secrets**, values are kept exactly as captured (this is the app's default, and the SDK's), so unmasked credentials are expected. With **Mask secrets** on, the masking policy is applied in the capture process **before** anything is buffered, displayed or exported. Masking is defense in depth, not a guarantee; multipart bodies are omitted while it is on.
- Every event is labelled `browser` or `server`; Inspect URL never claims to see a remote site's server-side calls.
- Server events are untrusted input: the desktop forces `source: server` regardless of what the SDK sent, and re-applies the session's masking policy (when masking is on) even if the SDK already masked or sent raw values.
- Missing/truncated/binary bodies carry an explicit `unavailableReason`; content is never fabricated.

## License

[MIT](LICENSE)
