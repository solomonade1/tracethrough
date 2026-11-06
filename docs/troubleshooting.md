# Troubleshooting

## "TraceThrough needs Google Chrome or Microsoft Edge"

Install one of them and restart TraceThrough.

## A request fails with `ERR_NAME_NOT_RESOLVED`

The hostname does not resolve on this computer: a typo, a VPN-only domain, or a doubled `https://`. Check with `nslookup <host>`.

## No server rows appear

Work down this list:

1. Both `TRACETHROUGH_COLLECTOR_URL` and `TRACETHROUGH_TOKEN` are set in the process that runs your app, and you restarted it.
2. The app is not running with `NODE_ENV=production` (or you set `TRACETHROUGH_ALLOW_PRODUCTION=1`).
3. **This is my app** was ticked when the session started, for the same origin you are browsing.
4. Your app makes the request with Node `fetch`, on the server. Axios and `node:http` clients are not recorded.
5. Node.js: `register()` runs first, and `handle.enabled` is `true` (otherwise `handle.disabledReason` says why).
6. Next.js: `instrumentation.ts` is in the project root (or `src/`) and the route runs on the Node.js runtime.
7. TraceThrough and the app run on the same computer.

The **Connect App → Verify connection** step reports whether the collector has seen anything from your app.

## Server rows say "Not linked"

You inspected a different origin than the one you ticked, or you are on Next.js 15 and it is the first render of a page after a compile or boot. See [Known limitations](known-limitations.md).

## The collector port is busy (`EADDRINUSE`)

Another copy of TraceThrough is running, or the port is taken. TraceThrough falls back to a free port; copy the new collector URL from the Configure step. To pick one yourself, set `TRACETHROUGH_COLLECTOR_PORT` and update `TRACETHROUGH_COLLECTOR_URL` to match.

## "Connection issue" on the Verify step

The collector refused requests: usually a wrong token or URL (copy both again after regenerating the token or restarting TraceThrough), or it is not running.

## The installer is blocked by Windows or macOS

Installers are unsigned unless the release notes say otherwise.

- **Windows:** at "Windows protected your PC" click **More info**, then **Run anyway**.
- **macOS:** drag TraceThrough to Applications. If macOS says the app is damaged, run `xattr -cr /Applications/TraceThrough.app` once, or right-click the app, choose **Open**, then **Open**.
- **Linux:** `chmod +x TraceThrough-*.AppImage`, then run it. AppImages need FUSE (`libfuse2` on Ubuntu 22.04+). On Ubuntu 24.04 you may need `--no-sandbox`.

Verify any download against `SHA256SUMS.txt` from the release.
