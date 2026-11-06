# Connect a Next.js app

Shows the `fetch` calls your Next.js server makes (server components, route handlers, server actions), linked to the browser request that caused them. Node.js runtime only; the Edge runtime is not supported. Tested with Next.js 15 and 16.

The home screen's **Connect App** tab walks you through these steps and checks the connection with real data from the collector.

## 1. Install

```bash
npm install @tracethrough/next
```

pnpm: `pnpm add @tracethrough/next`. yarn: `yarn add @tracethrough/next`. Requires Node.js 20 or later. [Package on npm](https://www.npmjs.com/package/@tracethrough/next).

## 2. Register

Create `instrumentation.ts` in the project root (or `src/`):

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { register } = await import('@tracethrough/next');
    register();
  }
}
```

## 3. Start Next.js with the connection details

TraceThrough's **Connect App → Configure** step shows your collector URL and token. Use them:

```bash
TRACETHROUGH_COLLECTOR_URL=http://127.0.0.1:47811 TRACETHROUGH_TOKEN=<token> npm run dev
```

Windows PowerShell:

```powershell
$env:TRACETHROUGH_COLLECTOR_URL="http://127.0.0.1:47811"; $env:TRACETHROUGH_TOKEN="<token>"; npm run dev
```

Or put both lines in `.env.local` (keep it out of version control). The collector port is `47811` unless it was busy; copy the URL from the app.

## 4. Inspect

In TraceThrough choose **Inspect Website**, enter `http://localhost:3000`, tick **This is my app**, and start the session. Server calls appear as **Server** rows linked to the browser request that triggered them.

## Good to know

- The SDK is **off** when `NODE_ENV=production` unless you set `TRACETHROUGH_ALLOW_PRODUCTION=1`.
- The collector accepts connections from this computer only. Your app and TraceThrough must run on the same machine.
- Next.js 15: the first render of each page after a compile or server boot may show as **Not linked**. Next.js 16 has no such gap.
- Set `NEXT_TELEMETRY_DISABLED=1` to hide Next.js's own telemetry calls.
- Only Node `fetch` calls are recorded. See [Known limitations](known-limitations.md).

Trouble? See [Troubleshooting](troubleshooting.md#no-server-rows-appear).
