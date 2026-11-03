/**
 * Sample "owned" app for App Connect. Run with TraceLens open:
 *
 *   TRACELENS_COLLECTOR_URL=... TRACELENS_TOKEN=... UPSTREAM_URL=http://127.0.0.1:4789 pnpm example:node
 *
 * The page calls /api/products from the browser; that handler calls an upstream API server-side.
 */
import { register } from '@tracelens/node';

const tracelens = register();

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const upstream = process.env.UPSTREAM_URL ?? 'http://127.0.0.1:4789';
const apiKey = process.env.UPSTREAM_API_KEY ?? 'demo-key-123';

const PAGE = `<!doctype html><title>Sample shop</title>
<h1>Sample shop</h1><pre id="out">loading…</pre>
<script>
fetch('/api/products').then(r => r.json()).then(d => {
  document.getElementById('out').textContent = JSON.stringify(d, null, 2);
  window.__done = true;
});
</script>`;

const server = createServer(async (req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (req.url === '/api/products') {
    // Server-side calls: these are what App Connect reveals.
    const [catalog, stock] = await Promise.all([
      fetch(`${upstream}/api/ok?api_key=${apiKey}`).then((r) => r.json()),
      fetch(`${upstream}/api/slow?ms=40`).then((r) => r.json()),
    ]);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ items: catalog.items, stockCheckedMs: stock.waitedMs }));
  }
  res.writeHead(404).end();
});

server.listen(Number(process.env.PORT ?? 3005), '127.0.0.1', () => {
  const { port } = server.address() as AddressInfo;
  console.log(`listening on http://127.0.0.1:${port}`);
  console.log(`App Connect: ${tracelens.enabled ? 'enabled' : `disabled (${tracelens.disabledReason})`}`);
});
