# Security policy

TraceThrough handles network traffic that can contain credentials. Masking and local-only handling of captured data are security features, and masking is optional.

## What is and is not a vulnerability

- **Masking is a per-session choice.** A session started without **Mask secrets** (the app's default) keeps cookies, tokens, API keys and bodies exactly as captured, and exports of it say so. The SDK also sends values as captured by default. Seeing credentials in such a session or export is expected behavior, not a vulnerability.
- **A bypass of enabled masking is a vulnerability.** If a session has **Mask secrets** on and a secret still reaches the buffer, the UI, a JSON or HAR export, or a log, report it.
- **Masking is defense in depth, not a guarantee.** It works from key names and credential-shaped values, so it can miss secrets with innocuous names; review exports before sharing them. Bodies that cannot be masked reliably (multipart) are omitted while masking is on.
- **Local-only describes captured data.** Captured traffic is held in memory, written only when you export, and sent nowhere else. Inspecting a site still makes the ordinary network requests that site needs.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub: **Security → Report a vulnerability** on this repository. Include steps to reproduce and the version affected. You can expect an acknowledgement within a few days.

In scope, for example: a secret escaping masking while it is enabled (into the buffer, an export or the UI), the collector or web mode accepting non-loopback or unauthenticated requests, script injection through captured content, or the SDK sending data anywhere but the local collector.

## Supported versions

Only the latest release receives fixes.
