# @tracethrough/node

Shows the HTTP calls your Node.js server makes (Node `fetch`) in TraceThrough, linked to the browser request that caused them. Metadata only; bodies are never captured.

Part of [TraceThrough](https://github.com/solomonade1/trace-lens), a developer network inspector. Download the app from the [latest release](https://github.com/solomonade1/trace-lens/releases/latest), then follow the steps below. Full guide: [Connect your own app](https://github.com/solomonade1/trace-lens#connect-your-own-app).

## Use

```bash
npm install @tracethrough/node
```

Call `register()` once, before your server makes any requests:

```ts
import { register } from '@tracethrough/node';

const handle = register();
console.log(handle.enabled ? 'TraceThrough connected' : `TraceThrough off: ${handle.disabledReason}`);
```

Start your server with the collector URL and token shown on TraceThrough's **Connect App** card:

```bash
TRACETHROUGH_COLLECTOR_URL=http://127.0.0.1:47811 TRACETHROUGH_TOKEN=<token> node server.js
```

In TraceThrough, inspect your app's URL with **This is my app** ticked.

## Safety

- Off unless both the URL and the token are set.
- The collector must be a loopback `http://` address.
- Off when `NODE_ENV=production` unless `allowProduction: true` or `TRACETHROUGH_ALLOW_PRODUCTION=1`.
- `TRACETHROUGH_DISABLED=1` forces it off.

## Options

`collectorUrl`, `token`, `allowProduction`, `allowTargets` (only record calls to these hosts), `redaction`, `flushIntervalMs`, `maxQueue`, `logger`.

Requires Node.js 20+. Supports Node `fetch` (undici); not yet `node:http`/`https` clients or Axios.
