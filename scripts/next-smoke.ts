/**
 * Smoke test for App Connect inside a real Next.js server, without the desktop app:
 * `pnpm exec tsx scripts/next-smoke.ts dev|start` (run `next build` in examples/next-app before `start`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { startCollector } from '@tracethrough/collector';
import { formatTraceparent, newTraceContext, type ServerEventInput } from '@tracethrough/core';
import { startFixtureServer } from '@tracethrough/fixtures';

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const appDir = resolve(import.meta.dirname, '../examples/next-app');
const nextBin = createRequire(resolve(appDir, 'package.json')).resolve('next/dist/bin/next');
const port = 3107;

const received: ServerEventInput[] = [];
const collector = await startCollector({ port: 0, onEvents: (e) => void received.push(...e) });
const upstream = await startFixtureServer();

const child = spawn(process.execPath, [nextBin, mode, '-p', String(port), '-H', '127.0.0.1'], {
  cwd: appDir,
  env: {
    ...process.env,
    UPSTREAM_URL: upstream.url,
    UPSTREAM_API_KEY: 'tlsecretkey9q2w',
    TRACETHROUGH_COLLECTOR_URL: collector.url,
    TRACETHROUGH_TOKEN: collector.token,
    ...(mode === 'start' ? { TRACETHROUGH_ALLOW_PRODUCTION: '1' } : {}),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});
let log = '';
child.stdout.on('data', (c) => (log += c));
child.stderr.on('data', (c) => (log += c));

const get = (path: string, headers: Record<string, string> = {}) =>
  new Promise<number>((res, rej) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (r) => {
      r.resume();
      r.on('end', () => res(r.statusCode ?? 0));
    });
    req.on('error', rej);
    req.end();
  });

try {
  const deadline = Date.now() + 120_000;
  while (!/Ready in|started server|Local:/.test(log)) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`next ${mode} did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  const coldCtx = newTraceContext();
  const warmCtx = newTraceContext();
  const apiCtx = newTraceContext();
  const apiWarmCtx = newTraceContext();
  console.log('GET / cold ->', await get('/', { traceparent: formatTraceparent(coldCtx) }));
  console.log('GET / warm ->', await get('/', { traceparent: formatTraceparent(warmCtx) }));
  console.log('GET /api/products cold ->', await get('/api/products', { traceparent: formatTraceparent(apiCtx) }));
  console.log('GET /api/products warm ->', await get('/api/products', { traceparent: formatTraceparent(apiWarmCtx) }));
  console.log('GET / (no traceparent) ->', await get('/'));
  await new Promise((r) => setTimeout(r, 1500));

  const latest = [...new Map(received.map((e) => [e.id, e])).values()];
  const names = new Map([
    [coldCtx.traceId, 'PAGE-COLD'],
    [warmCtx.traceId, 'PAGE-WARM'],
    [apiCtx.traceId, 'API-COLD'],
    [apiWarmCtx.traceId, 'API-WARM'],
  ]);
  const label = (t?: string) => (t ? (names.get(t) ?? `other:${t.slice(0, 8)}`) : 'none');
  console.log(`\n${latest.length} server events:`);
  for (const e of latest) {
    console.log(`  ${e.state} ${e.status ?? ''} ${e.method} ${e.urlSanitized}  trace=${label(e.traceId)}  handler=${e.handler}`);
  }
  const appLines = log.split('\n').filter((l) => /App Connect|tracethrough|Error|error/i.test(l));
  console.log(`\nNext log (filtered):\n${appLines.join('\n')}`);
} catch (err) {
  console.error(String(err));
  console.error(`--- next log ---\n${log.slice(-6000)}`);
  process.exitCode = 1;
} finally {
  killTree(child.pid);
  await upstream.close();
  await collector.close();
}

/** `next` spawns its server as a child process; on Windows killing the parent leaves it running. */
function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-pid, 'SIGTERM');
}
