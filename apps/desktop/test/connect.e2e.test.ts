import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { expect } from '@playwright/test';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from '@tracelens/fixtures';
import { E2E_COLLECTOR_TOKEN, launchApp } from './launch';

const SECRET_KEY = 'tlsecretkey9q2w';
const sampleApp = resolve(import.meta.dirname, '../../../examples/node-app/server.ts');
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
const screenshotDir = process.env.TRACELENS_E2E_SCREENSHOT_DIR;

let app: ElectronApplication;
let win: Page;
let upstream: FixtureServer;
let sample: ChildProcess;
let sampleUrl: string;

const rows = () => win.locator('.table .body [role="row"]');
const serverRows = () => rows().filter({ has: win.locator('.badge.server') });
const detail = () => win.getByRole('complementary', { name: 'Request details' });

function startSampleApp(collectorUrl: string): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    sample = spawn(process.execPath, [tsxCli, sampleApp], {
      env: {
        ...process.env,
        PORT: '0',
        NODE_ENV: 'development',
        UPSTREAM_URL: upstream.url,
        UPSTREAM_API_KEY: SECRET_KEY,
        TRACELENS_COLLECTOR_URL: collectorUrl,
        TRACELENS_TOKEN: E2E_COLLECTOR_TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`sample app did not start:\n${out}`)), 30_000);
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      const m = /listening on (http:\/\/\S+)/.exec(out);
      if (m && out.includes('App Connect: enabled')) {
        clearTimeout(timer);
        resolveUrl(m[1]!);
      } else if (out.includes('App Connect: disabled')) {
        clearTimeout(timer);
        reject(new Error(out));
      }
    };
    sample.stdout!.on('data', onData);
    sample.stderr!.on('data', onData);
  });
}

beforeAll(async () => {
  upstream = await startFixtureServer();
  ({ app, win } = await launchApp());
  await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  const info = await win.evaluate(() => window.tracelens.getConnectInfo());
  if (!info.listening || !info.collectorUrl) throw new Error(`collector not listening: ${info.error}`);
  sampleUrl = await startSampleApp(info.collectorUrl);
});

afterAll(async () => {
  sample?.kill();
  await app?.close();
  await upstream?.close();
});

describe('App Connect end to end', () => {
  it('shows collector status and setup on the home screen', async () => {
    await expect(win.getByRole('heading', { name: 'Connect App' })).toBeVisible();
    await expect(win.locator('.connect [role="status"]')).toContainText('Collector listening on http://127.0.0.1:');
    // Token is hidden until asked for.
    await expect(win.locator('.connect')).not.toContainText(E2E_COLLECTOR_TOKEN);
    if (screenshotDir) await win.screenshot({ path: join(screenshotDir, '05-connect-home.png') });
  });

  it('links server-side fetches to the browser request that caused them (US-05, COR-01)', async () => {
    await win.locator('#target-url').fill(`${sampleUrl}/`);
    await win.getByLabel(/This is my app/).check();
    await win.getByRole('button', { name: 'Start session' }).click();
    // Session start includes launching a browser.
    await expect(win.getByText('App Connect', { exact: true })).toBeVisible({ timeout: 20_000 });

    await expect(serverRows()).toHaveCount(2, { timeout: 20_000 });
    await expect(serverRows().filter({ hasText: '/api/ok' })).toContainText(`api_key=[REDACTED]`);

    // Browser request → its server calls.
    const productsRow = rows().filter({ has: win.locator('.badge.browser') }).filter({ hasText: '/api/products' });
    await productsRow.click();
    const calls = detail().locator('tr', { hasText: 'Server calls' }).locator('li');
    await expect(calls).toHaveCount(2);
    await expect(calls.filter({ hasText: '/api/slow' })).toContainText('200 GET');
    if (screenshotDir) await win.screenshot({ path: join(screenshotDir, '06-linked-browser.png') });

    // Server call → the browser request and handler that triggered it.
    await calls.filter({ hasText: '/api/ok' }).getByRole('button').click();
    await expect(detail().locator('tr', { hasText: 'Triggered by' })).toContainText('/api/products');
    await expect(detail().locator('tr', { hasText: 'Handled request' })).toContainText('GET /api/products');
    await expect(detail().locator('tr', { hasText: 'Source' })).toContainText('Server');
    if (screenshotDir) await win.screenshot({ path: join(screenshotDir, '07-linked-server.png') });
  });

  it('filters to server events only', async () => {
    await win.getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Server' }).click();
    await expect(rows()).toHaveCount(2);
    await win.getByRole('button', { name: 'Reset' }).click();
  });

  it('never shows the upstream API key', async () => {
    expect(await win.content()).not.toContain(SECRET_KEY);
  });
});
