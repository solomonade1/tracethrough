# @tracethrough/next

Shows the HTTP calls your Next.js server makes (SSR data fetches, route handlers, server actions) in TraceThrough, linked to the browser request that caused them. Node runtime only. Metadata only; bodies are never captured.

Part of [TraceThrough](https://github.com/solomonade1/tracethrough), a developer network inspector. Download the app from the [latest release](https://github.com/solomonade1/tracethrough/releases/latest), then follow the steps below. Full guide: [Connect your own app](https://github.com/solomonade1/tracethrough#connect-your-own-app).

## Use

```bash
npm install @tracethrough/next
```

Create `instrumentation.ts` in your project root (or `src/`):

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { register } = await import('@tracethrough/next');
    register();
  }
}
```

Start Next with the collector URL and token shown on TraceThrough's **Connect App** card:

```bash
TRACETHROUGH_COLLECTOR_URL=http://127.0.0.1:47811 TRACETHROUGH_TOKEN=<token> npm run dev
```

In TraceThrough, inspect `http://localhost:3000` with **This is my app** ticked.

## Compatibility

| | Linked |
|---|---|
| Next.js 16 (`dev` and `start`) | everything |
| Next.js 15 (`dev` and `start`) | everything except the first render of each page after a compile or boot, which shows as "Not linked" |

Next 15 needs TypeScript 6 or earlier. Set `NEXT_TELEMETRY_DISABLED=1` to hide Next's own telemetry calls. The Edge runtime is not supported. Settings and safety defaults are the same as [@tracethrough/node](https://www.npmjs.com/package/@tracethrough/node), which this package wraps.
