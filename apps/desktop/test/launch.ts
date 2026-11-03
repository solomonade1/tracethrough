import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';

export const E2E_COLLECTOR_TOKEN = 'e2e-token-0123456789abcdefghijkl';

/**
 * Launches the built app for tests: capture runs headless, and the collector uses a fixed token and
 * a random port so tests never touch the developer's real token file or default port.
 * Set TRACELENS_E2E_EXECUTABLE to a packaged TraceLens.exe to test the shipped artifact instead.
 */
export async function launchApp() {
  const env = {
    ...process.env,
    TRACELENS_HEADLESS_CAPTURE: '1',
    TRACELENS_COLLECTOR_PORT: '0',
    TRACELENS_COLLECTOR_TOKEN: E2E_COLLECTOR_TOKEN,
  } as Record<string, string>;
  delete env.ELECTRON_RENDERER_URL;
  const executablePath = process.env.TRACELENS_E2E_EXECUTABLE;
  const app = executablePath
    ? await electron.launch({ executablePath, args: [], env })
    : await electron.launch({ args: [resolve(import.meta.dirname, '..')], env });
  const win = await app.firstWindow();
  return { app, win };
}
