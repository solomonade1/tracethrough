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

const rows = () => win.locator('.table .body [role="row"]:not([data-kind="group"])');
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
    await expect(win.getByText('Inspect URL', { exact: true })).toBeVisible();
    await win.locator('#target-url').fill('file:///etc/passwd');
    await win.getByRole('button', { name: 'Start session' }).click();
    await expect(win.getByRole('alert')).toContainText('Unsupported scheme');
    await snap('01-home-error');
  });

  it('switches between light, dark and system themes', async () => {
    const pick = async (label: string) => {
      await win.getByRole('button', { name: /^Theme:/ }).click();
      await win.getByRole('menuitem', { name: label }).click();
    };
    const bg = () => win.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await pick('Dark');
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(bg).toBe('rgb(12, 17, 29)'); // the v2 mockup's dark surface
    await pick('Light');
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(bg).toBe('rgb(255, 255, 255)');
    await pick('System');
    await expect(win.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  it('starts a session and streams requests live (UI-01)', async () => {
    await win.locator('#target-url').fill(`${server.url}/basic`);
    // The masking checks below need "Mask secrets"; the unmasked default is covered at the end.
    await win.getByLabel(/Mask secrets/).check();
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
    await win.getByRole('combobox', { name: 'Status' }).selectOption('4xx');
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
    await detail.getByRole('button', { name: 'Pretty' }).click(); // Tree is the default view
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

  it('finds in the response tree and copies a path and a cURL command', async () => {
    await win.getByRole('searchbox', { name: 'Search requests' }).fill('/api/echo');
    await expect(rows()).toHaveCount(1);
    await rows().first().click();
    const detail = win.getByRole('complementary', { name: 'Request details' });
    await detail.getByRole('tab', { name: 'Response' }).click();
    await detail.getByRole('searchbox', { name: 'Find in response' }).fill('ada');
    await expect(detail.getByText('1 match', { exact: true })).toBeVisible();
    await detail.getByRole('treeitem').filter({ hasText: 'username' }).click();
    await expect(detail.locator('.crumb')).toContainText('echo');
    await detail.getByRole('button', { name: 'Copy path', exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('echo.username');

    await detail.getByRole('button', { name: 'Copy as cURL' }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^curl /);
    const curl = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(curl).toMatch(/^curl 'http:\/\/127\.0\.0\.1:\d+\/api\/echo'/);
    expect(curl).toContain('-X POST');
    expect(curl).not.toContain(CANARY);
    await snap('03b-response-tree');
  });

  it('lists cookies set by the response (UI-03)', async () => {
    await win.getByRole('searchbox', { name: 'Search requests' }).fill('/api/set-cookie');
    await expect(rows()).toHaveCount(1);
    await rows().first().click();
    const detail = win.getByRole('complementary', { name: 'Request details' });
    await detail.getByRole('tab', { name: 'Headers' }).click();
    const cookies = detail.getByRole('region', { name: 'Cookies' });
    await expect(cookies).toContainText('sid');
    await expect(cookies).toContainText('Set');
    await expect(cookies).not.toContainText(CANARY);
    await win.getByRole('searchbox', { name: 'Search requests' }).fill('');
  });

  it('groups requests by page on demand (UI-04)', async () => {
    const groups = win.locator('.table .body [data-kind="group"]');
    await expect(groups).toHaveCount(0);
    await win.getByLabel('Group by page').check();
    await expect(groups.first()).toContainText('/basic');
    await win.getByLabel('Group by page').uncheck();
    await expect(groups).toHaveCount(0);
  });

  it('exports only the ticked rows', async () => {
    const selectedPath = join(tmp, 'selected.har');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as unknown as typeof dialog.showSaveDialog;
    }, selectedPath);

    await rows().nth(0).getByRole('checkbox').check();
    await rows().nth(1).getByRole('checkbox').check();
    await expect(win.getByRole('region', { name: 'Selection' })).toContainText('2 requests selected');
    await win.getByRole('button', { name: 'Export selected' }).click();
    const dialog = win.getByRole('dialog', { name: 'Export' });
    await expect(dialog.getByLabel(/Selected rows/)).toBeChecked();
    await dialog.getByRole('button', { name: 'Save file…' }).click();
    await expect(win.locator('.session-strip')).toContainText('Exported to');
    const har = JSON.parse(await readFile(selectedPath, 'utf8'));
    expect(har.log.entries).toHaveLength(2);
    await win.getByRole('button', { name: 'Clear selection' }).click();
    await expect(win.getByRole('region', { name: 'Selection' })).toHaveCount(0);
  });

  it('exports a sanitized HAR through the Export dialog (EXP-01)', async () => {
    const harPath = join(tmp, 'session.har');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as unknown as typeof dialog.showSaveDialog;
    }, harPath);

    await win.getByRole('button', { name: /^Export/ }).click();
    await win.getByRole('menuitem', { name: /Export as HAR/ }).click();
    const dialog = win.getByRole('dialog', { name: 'Export' });
    await expect(dialog).toContainText('Known secrets are masked'); // masked session: the standard warning
    await dialog.getByRole('button', { name: 'Save file…' }).click();
    await expect(win.locator('.session-strip')).toContainText('Exported to');
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

  it('shows cookies, tokens and bodies as captured when masking is off (the default)', async () => {
    win.once('dialog', (d) => void d.accept().catch(() => {})); // "Start a new session?" confirmation
    await win.getByRole('button', { name: 'New session' }).click();
    await win.locator('#target-url').fill(`${server.url}/basic`);
    await expect(win.getByLabel(/Mask secrets/)).not.toBeChecked();
    await win.getByRole('button', { name: 'Start session' }).click();
    await expect(win.getByRole('status')).toHaveText(/Recording/, { timeout: 20_000 });
    await expect(win.locator('.session-strip')).toContainText('Masking off');

    await win.getByRole('searchbox', { name: 'Search requests' }).fill('/api/echo');
    await expect(rows()).toHaveCount(1, { timeout: 20_000 });
    await rows().first().click();
    const detail = win.getByRole('complementary', { name: 'Request details' });
    await detail.getByRole('tab', { name: 'Headers' }).click();
    await expect(detail.locator('tr', { hasText: 'authorization' })).toContainText(`Bearer ${CANARY}`);
    await detail.getByRole('tab', { name: 'Request' }).click();
    await detail.getByRole('button', { name: 'Pretty' }).click();
    await expect(detail.locator('pre')).toContainText(CANARY);

    await win.getByRole('searchbox', { name: 'Search requests' }).fill('/api/set-cookie');
    await rows().first().click();
    await detail.getByRole('tab', { name: 'Headers' }).click();
    await expect(detail.locator('tr', { hasText: 'set-cookie' }).first()).toContainText(`sid=${CANARY}`);
    await snap('05-unmasked-headers');
    await win.getByRole('button', { name: '■ Stop' }).click();
  });
});
