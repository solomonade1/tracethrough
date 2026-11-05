# Contributing

Thanks for helping. Anyone can open an issue or a pull request; a maintainer reviews and merges every change.

## Set up

Needs Node 22.12+ and pnpm 10. See the README's "Develop this repository" section for commands.

```bash
pnpm install
pnpm test
pnpm typecheck
```

## Pull requests

1. Fork the repo, create a branch, make a focused change.
2. Add or update tests. Run `pnpm typecheck` and `pnpm test`; run `pnpm test:e2e` if you touched the app.
3. If you changed `@tracethrough/core`, `@tracethrough/node` or `@tracethrough/next`, run `pnpm changeset` and commit the generated file. CI fails the PR without one. If the change needs no release (tests, docs), run `pnpm changeset --empty` instead.
4. Update the docs when behavior changes.
5. Open the PR. CI must pass and a maintainer must approve. First-time contributors' workflows need a maintainer to approve the run.

## Ground rules that every change must keep

- **Masking is optional, and both modes are supported.** Raw capture is intentional: a session without **Mask secrets** keeps headers, URLs and bodies exactly as captured, and the SDK sends values unmasked by default. Unmasked credentials in such a session are expected behavior, not a bug. Do not "fix" them, and do not change either default (the app starts unmasked; `redaction` in the SDK defaults to `false`).
- **With masking enabled, the session's masking policy is applied before anything is buffered, displayed or exported.** That covers every way data gets in (browser capture and SDK events re-ingested by the app) and every way it gets out (the UI, JSON and HAR export). A path that lets a secret through despite masking being on is a defect; see [SECURITY.md](SECURITY.md). When masking is on and a body cannot be masked reliably (multipart), it is omitted with `omitted-by-policy` rather than shown.
- Masking is defense in depth, not a guarantee. Never describe it as one in code, docs or UI.
- Label every event `browser` or `server`; never claim to see a site's server-side calls without App Connect.
- Never fabricate bodies; say why one is unavailable.
- Captured data stays local: no telemetry and no network egress of captured data. (Inspecting a site still makes the normal network requests that site needs; "local-only" is about what happens to the captured data.)

Never put real tokens, cookies or captured traffic in code, tests, issues or screenshots.

## Security issues

See [SECURITY.md](SECURITY.md). Do not file them as public issues.
