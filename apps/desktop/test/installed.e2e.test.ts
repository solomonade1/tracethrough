import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { expect } from '@playwright/test';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from '@tracethrough/fixtures';
import { launchApp } from './launch';

/**
 * Smoke test for a shipped artifact: run it against an INSTALLED app with
 *   TRACETHROUGH_E2E_EXECUTABLE=<path to the installed executable> pnpm exec vitest run \
 *     --config apps/desktop/vitest.config.ts installed
 * (desktop-release.yml installs each release artifact on its own OS and does exactly that). Without
 * the variable it runs against the built app, so the same checks guard every pull request.
 *
 * It is deliberately small: the window loads, environment detection works, a fixture capture
 * completes, and a machine without Chrome or Edge still gets a usable, explanatory UI.
 */
const expectedVersion = (JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }).version;

let server: FixtureServer;
const launched: ElectronApplication[] = [];

async function launch(env: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page }> {
  const { app, win } = await launchApp(env);
  launched.push(app);
  return { app, win };
}

beforeAll(async () => {
  server = await startFixtureServer();
});
afterEach(async () => {
  // Never leave an app (or its capture browser) running, installed or not.
  await Promise.all(launched.splice(0).map((a) => a.close().catch(() => {})));
});
afterAll(async () => {
  await server?.close();
});

describe('installed app smoke', () => {
  it('loads the window, detects the environment and completes a fixture capture', async () => {
    const { win } = await launch();
    await expect(win.getByRole('heading', { name: 'What would you like to inspect?' })).toBeVisible({ timeout: 30_000 });

    // Environment detection: the right build, and a browser to capture with.
    const env = await win.evaluate(() => window.tracethrough.getEnvironment());
    expect(env.version).toBe(expectedVersion);
    expect(env.browsers.length).toBeGreaterThan(0);
    await expect(win.getByText(`Sessions open in ${env.browsers[0]!.label}`)).toBeVisible();

    // A capture, end to end.
    await win.locator('#target-url').fill(`${server.url}/basic`);
    await win.getByRole('button', { name: 'Start session' }).click();
    await expect(win.getByRole('status')).toHaveText(/Recording/, { timeout: 60_000 }); // includes browser launch
    const slow = win.locator('.table .body [role="row"]').filter({ has: win.locator('.c-name', { hasText: '/api/slow' }) });
    await expect(slow).toBeVisible({ timeout: 30_000 });
    await expect(slow.locator('.c-status')).toHaveText('200');
    await win.getByRole('button', { name: '■ Stop' }).click();
    await expect(win.getByRole('status')).toHaveText(/Stopped/);
  });

  it('says so clearly when Chrome and Edge are missing, and still loads the inspector', async () => {
    const { win } = await launch({ TRACETHROUGH_TEST_NO_BROWSERS: '1' });
    await expect(win.getByRole('heading', { name: 'What would you like to inspect?' })).toBeVisible({ timeout: 30_000 });
    await expect(win.getByRole('alert')).toContainText('needs Google Chrome or Microsoft Edge');
    await expect(win.getByRole('button', { name: 'Start session' })).toBeDisabled();
    // The rest of the UI is there: the user can still read about App Connect and set it up.
    await expect(win.getByRole('tab', { name: /Connect App/ })).toBeVisible();
    expect((await win.evaluate(() => window.tracethrough.getEnvironment())).browsers).toEqual([]);
  });
});
