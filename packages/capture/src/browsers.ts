import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

/** `chromium` = Playwright's bundled build; `chrome` / `msedge` = the user's installed browser (fresh, isolated profile). */
export type BrowserChannel = 'chromium' | 'chrome' | 'msedge';

export const BROWSER_LABELS: Record<BrowserChannel, string> = {
  chromium: 'Chromium (bundled)',
  chrome: 'Google Chrome',
  msedge: 'Microsoft Edge',
};

/** Standard install locations Playwright itself uses for the `chrome` and `msedge` channels. */
function candidatePaths(channel: 'chrome' | 'msedge'): string[] {
  const env = process.env;
  switch (process.platform) {
    case 'win32': {
      const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter((r): r is string => !!r);
      const rel = channel === 'chrome' ? 'Google\\Chrome\\Application\\chrome.exe' : 'Microsoft\\Edge\\Application\\msedge.exe';
      return roots.map((r) => join(r, rel));
    }
    case 'darwin': {
      const app = channel === 'chrome' ? 'Google Chrome.app/Contents/MacOS/Google Chrome' : 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
      return [join('/Applications', app), join(homedir(), 'Applications', app)];
    }
    default:
      return channel === 'chrome'
        ? ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']
        : ['/opt/microsoft/msedge/msedge', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'];
  }
}

function bundledChromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/**
 * Browsers that can host a capture session, in preference order. Cheap (filesystem checks only),
 * so the app can call it at startup to warn before the user tries to start a session.
 */
export function findBrowsers(): BrowserChannel[] {
  // Test hook: lets the installer smoke test check the "no Chrome or Edge" experience on a machine that has them.
  if (process.env.TRACETHROUGH_TEST_NO_BROWSERS === '1') return [];
  const found: BrowserChannel[] = [];
  if (bundledChromiumInstalled()) found.push('chromium');
  for (const channel of ['chrome', 'msedge'] as const) {
    if (candidatePaths(channel).some((p) => existsSync(p))) found.push(channel);
  }
  return found;
}
