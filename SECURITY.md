# Security policy

TraceThrough handles network traffic that can contain credentials, so we treat redaction and local-only operation as security features.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub: **Security → Report a vulnerability** on this repository. Include steps to reproduce and the version affected. You can expect an acknowledgement within a few days.

In scope, for example: a secret escaping redaction (into the buffer, an export or the UI), the collector or web mode accepting non-loopback or unauthenticated requests, script injection through captured content, or the SDK sending data anywhere but the local collector.

## Supported versions

Only the latest release receives fixes.
