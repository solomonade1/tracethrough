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
3. If you changed `@tracethrough/core`, `@tracethrough/node` or `@tracethrough/next`, run `pnpm changeset` and commit the generated file.
4. Update the docs when behavior changes.
5. Open the PR. CI must pass and a maintainer must approve. First-time contributors' workflows need a maintainer to approve the run.

## Ground rules that every change must keep

- Redact before anything is buffered, stored, exported or displayed.
- Label every event `browser` or `server`; never claim to see a site's server-side calls without App Connect.
- Never fabricate bodies; say why one is unavailable.
- No telemetry and no network egress of captured data.

Never put real tokens, cookies or captured traffic in code, tests, issues or screenshots.

## Security issues

See [SECURITY.md](SECURITY.md). Do not file them as public issues.
