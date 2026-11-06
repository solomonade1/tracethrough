# Connect a Node.js app

Shows the `fetch` calls your Node.js server makes, linked to the browser request that caused them. The home screen's **Connect App** tab guides you through these steps and verifies the connection.

## 1. Install

```bash
npm install @tracethrough/node
```

pnpm: `pnpm add @tracethrough/node`. yarn: `yarn add @tracethrough/node`. Requires Node.js 20 or later. [Package on npm](https://www.npmjs.com/package/@tracethrough/node).

## 2. Register

Call `register()` once, **before** your server makes any request (make it the first import in your entry file):

```ts
import { register } from '@tracethrough/node';

register();
```

To see whether it is active:

```ts
const handle = register();
console.log(handle.enabled ? 'TraceThrough connected' : `TraceThrough off: ${handle.disabledReason}`);
```

## 3. Start your server with the connection details

Use the collector URL and token from **Connect App → Configure**:

```bash
TRACETHROUGH_COLLECTOR_URL=http://127.0.0.1:47811 TRACETHROUGH_TOKEN=<token> node server.js
```

Windows PowerShell:

```powershell
$env:TRACETHROUGH_COLLECTOR_URL="http://127.0.0.1:47811"; $env:TRACETHROUGH_TOKEN="<token>"; node server.js
```

Or keep both in a `.env` file and run `node --env-file=.env server.js` (Node.js 20.6+).

## 4. Inspect

Choose **Inspect Website**, enter your app's URL (for example `http://localhost:3000`), tick **This is my app**, and start the session.

## Options

`register()` accepts `collectorUrl`, `token`, `allowProduction`, `allowTargets`, `redaction`, `captureBodies`, `maxBodyBytes`, `flushIntervalMs`, `maxQueue` and `logger`. Defaults: bodies on, previews up to 64 KB each (maximum 512 KB), off when `NODE_ENV=production`. `TRACETHROUGH_DISABLED=1` forces the SDK off. Full list: [@tracethrough/node on npm](https://www.npmjs.com/package/@tracethrough/node).

See also [Known limitations](known-limitations.md) and [Troubleshooting](troubleshooting.md#no-server-rows-appear).
