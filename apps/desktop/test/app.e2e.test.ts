import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { expect } from '@playwright/test';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { CANARY, startFixtureServer, type FixtureServer } from '@tracethrough/fixtures';
import { launchApp } from './launch';

const screenshotDir = process.env.TRACETHROUGH_E2E_SCREENSHOT_DIR;

let app: ElectronApplication;
let win: Page;
let server: FixtureServer;
let tmp: string;

const rows = () => win.locator('.table .body [role="row"]');
const rowFor = (path: string) => rows().filter({ has: win.locator('.c-name', { hasText: path }) }).first();

async function snap(name: string) {
  if (screenshotDir) await win.screenshot({ path: join(screenshotDir, `${name}.png`) });
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'tracethrough-e2e-'));
  server = await startFixtureServer();
  ({ app, win } = await launchApp());
  await win.setViewportSize({ width: 1400, height: 860 }).catch(() => {});
});

afterAll(async () => {
  await app?.close();
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe('TraceThrough desktop', () => {
  it('rejects unsupported URL schemes on the home screen (URL-01)', async () => {
    await expect(win.getByRole('heading', { name: 'Inspect URL' })).toBeVisible();
    await win.locator('#target-url').fill('file:///etc/passwd');
    await win.getByRole('button', { name: 'Start session' }).click();
    await expect(win.getByRole('alert')).toContainText('Unsupported scheme');
    await snap('01-home-error');
  });

  it('starts a session and streams requests live (UI-01)', async () => {
    await win.locator('#target-url').fill(`${server.url}/basic`);
    await win.getByRole('button', { name: 'Start session' }).click();
    await expect(win.getByRole('status')).toHaveText(/Recording/, { timeout: 20_000 }); // includes browser launch
    await expect(rowFor('/api/slow')).toBeVisible({ timeout: 20_000 });
    await expect(rowFor('/api/slow').locator('.c-status')).toHaveText('200');
    expect(await rows().count()).toBeGreaterThanOrEqual(12);
    // The initial navigation is captured before the UI subscribes; it must still be listed first.
    await expect(rows().first().locator('.c-name')).toHaveText('/basic');
    await snap('02-live-list');
  });

  it('filters by status class and search text (UI-02)', async () => {
    await win.getByRole('group', { name: 'Status' }).getByRole('button', { name: '4xx' }).click();
    const statuses = await rows().locator('.c-status').allTextContents();
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) expect(s).toMatch(/^4\d\d$/);
    await win.getByRole('button', { name: 'Reset' }).click();

    await win.getByRole('searchbox', { name: 'Search requests' }).fill('echo');
    await expect(rows()).toHaveCount(1);
    await expect(rows().first().locator('.c-method')).toHaveText('POST');
  });

  it('shows masked headers and bodies in the detail pane (UI-03, US-04)', async () => {
    await rows().first().click();
    const detail = win.getByRole('complementary', { name: 'Request details' });
    await expect(detail).toBeVisible();

    await detail.getByRole('tab', { name: 'Headers' }).click();
    await expect(detail.locator('tr', { hasText: 'authorization' })).toContainText('Bearer [REDACTED]');

    await detail.getByRole('tab', { name: 'Request' }).click();
    await expect(detail.locator('pre')).toContainText('"password": "[REDACTED]"');
    await expect(detail.locator('mark.masked').first()).toBeVisible();
    await snap('03-detail-request');

    await detail.getByRole('tab', { name: 'Timing' }).click();
    await expect(detail.locator('tr', { hasText: 'Total' })).toContainText('ms');
  });

  it('explains unavailable bodies instead of showing content (US-06)', async () => {
    await win.getByRole('searchbox', { name: 'Search requests' }).fill('/api/binary');
    await rows().first().click();
    const detail = win.getByRole('complementary', { name: 'Request details' });
    await detail.getByRole('tab', { name: 'Response' }).click();
    await expect(detail.locator('.unavailable')).toContainText('Binary content of type image/png');
    await win.getByRole('searchbox', { name: 'Search requests' }).fill('');
  });

  it('never renders the planted secret anywhere in the UI', async () => {
    expect(await win.content()).not.toContain(CANARY);
  });

  it('exports a sanitized HAR after a warning (EXP-01)', async () => {
    const harPath = join(tmp, 'session.har');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox;
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as unknown as typeof dialog.showSaveDialog;
    }, harPath);

    await win.getByRole('button', { name: 'Export HAR' }).click();
    await expect(win.locator('.banner')).toContainText('Exported to');
    const text = await readFile(harPath, 'utf8');
    expect(text).not.toContain(CANARY);
    const har = JSON.parse(text);
    expect(har.log.version).toBe('1.2');
    expect(har.log.entries.length).toBeGreaterThanOrEqual(12);
  });

  it('stops recording on demand', async () => {
    await win.getByRole('button', { name: '■ Stop' }).click();
    await expect(win.getByRole('status')).toHaveText(/Stopped/);
    await snap('04-stopped');
  });
});
