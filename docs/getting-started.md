# Getting started

## 1. Install

Download the installer for your system from the [latest release](https://github.com/solomonade1/tracethrough/releases/latest):

| System | File |
|---|---|
| Windows 10/11 (x64) | `TraceThrough-Setup-<version>-x64.exe` |
| macOS, Apple Silicon | `TraceThrough-<version>-mac-arm64.dmg` |
| macOS, Intel | `TraceThrough-<version>-mac-x64.dmg` |
| Linux (x64) | `TraceThrough-<version>-linux-x86_64.AppImage` |

`SHA256SUMS.txt` in the release lets you verify the download. Installers are unsigned unless the release notes say otherwise, so your OS may warn before the first run (see [Troubleshooting](troubleshooting.md#the-installer-is-blocked-by-windows-or-macos)).

TraceThrough opens sites in **Google Chrome or Microsoft Edge**, which must already be installed.

## 2. Inspect your first site

1. Open TraceThrough. **Inspect Website** is selected.
2. Type `https://example.com` and click **Start session**.
3. A separate browser window opens. Browse there; requests appear in TraceThrough as they happen.

Next: [Inspect a website](inspect-a-website.md), then [Inspect requests and responses](inspect-requests.md).

## 3. Optional: connect your own app

If you build a Next.js or Node.js app, **Connect App** also shows the requests your *server* makes. See [Connect a Next.js app](connect-nextjs.md) or [Connect a Node.js app](connect-nodejs.md).
