import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { expect } from '@playwright/test';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from '@tracethrough/fixtures';
import { E2E_COLLECTOR_TOKEN, launchApp } from './launch';

const SECRET_KEY = 'tlsecretkey9q2w';
const nextAppDir = resolve(import.meta.dirname, '../../../examples/next-app');
const nextBin = createRequire(join(nextAppDir, 'package.json')).resolve('next/dist/bin/next');
const screenshotDir = process.env.TRACETHROUGH_E2E_SCREENSHOT_DIR;

let app: ElectronApplication;
let win: Page;
let upstream: FixtureServer;
let next: ChildProcess | undefined;
let nextUrl: string;

const rows = () => win.locator('.table .body [role="row"]');
const browserRow = (name: string) =>
  rows()
    .filter({ has: win.locator('.badge.browser') })
    .filter({ has: win.locator('.c-name', { hasText: new RegExp(`^${name.replace(/[/?]/g, '\\$&')}$`) }) });
const detail = () => win.getByRole('complementary', { name: 'Request details' });

function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });
}

/** `next` runs its server in a child process; on Windows killing the parent leaves it running. */
function killTree(child: ChildProcess | undefined) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-child.pid, 'SIGTERM');
}

beforeAll(async () => {
  upstream = await startFixtureServer();
  ({ app, win } = await launchApp());
  await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  const info = await win.evaluate(() => window.tracethrough.getConnectInfo());
  if (!info.collectorUrl) throw new Error(`collector not listening: ${info.error}`);

  const port = await freePort();
  nextUrl = `http://127.0.0.1:${port}`;
  next = spawn(process.execPath, [nextBin, 'dev', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: nextAppDir,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1',
      UPSTREAM_URL: upstream.url,
      UPSTREAM_API_KEY: SECRET_KEY,
      TRACETHROUGH_COLLECTOR_URL: info.collectorUrl,
      TRACETHROUGH_TOKEN: E2E_COLLECTOR_TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let log = '';
  next.stdout!.on('data', (c) => (log += c));
  next.stderr!.on('data', (c) => (log += c));
  const deadline = Date.now() + 90_000;
  while (!/Ready in/.test(log)) {
    if (Date.now() > deadline || next.exitCode !== null) throw new Error(`next dev did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}, 180_000);

afterAll(async () => {
  killTree(next);
  await app?.close();
  await upstream?.close();
});

describe('App Connect with a real Next.js app (next dev)', () => {
  it('links the SSR fetch to the page navigation and the route-handler fetch to its API call', async () => {
    await win.locator('#target-url').fill(`${nextUrl}/`);
    await win.getByLabel(/This is my app/).check();
    await win.getByRole('button', { name: 'Start session' }).click();

    // First request compiles the page: this is the case that needed Next's own request store.
    // React Strict Mode (dev) runs the effect twice, so the browser calls /api/products twice;
    // each call has its own trace and must link to its own upstream request.
    await expect(browserRow('/api/products')).toHaveCount(2, { timeout: 90_000 });
    const server = rows().filter({ has: win.locator('.badge.server') });
    await expect(server.filter({ hasText: '/api/ok' })).toHaveCount(1, { timeout: 20_000 });
    await expect(server.filter({ hasText: '/api/slow' })).toHaveCount(2, { timeout: 20_000 });

    // Document navigation → SSR fetch made while rendering it.
    await browserRow('/').click();
    const docCalls = detail().locator('tr', { hasText: 'Server calls' }).locator('li');
    await expect(docCalls).toHaveCount(1);
    await expect(docCalls).toContainText('/api/ok?api_key=[REDACTED]');
    if (screenshotDir) await win.screenshot({ path: join(screenshotDir, '08-next-ssr-linked.png') });

    // Each browser fetch to the route handler → exactly its own upstream call.
    for (const i of [0, 1]) {
      await browserRow('/api/products').nth(i).click();
      const apiCalls = detail().locator('tr', { hasText: 'Server calls' }).locator('li');
      await expect(apiCalls).toHaveCount(1);
      await expect(apiCalls).toContainText('/api/slow');
    }
    await detail().locator('tr', { hasText: 'Server calls' }).getByRole('button').click();
    await expect(detail().locator('tr', { hasText: 'Triggered by' })).toContainText('/api/products');
  });

  it('never shows the upstream API key', async () => {
    expect(await win.content()).not.toContain(SECRET_KEY);
  });
});
