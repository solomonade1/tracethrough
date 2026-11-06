import type { ElectronApplication, Page } from 'playwright';
import { expect } from '@playwright/test';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from '@tracethrough/fixtures';
import { DOC_URLS, NPM_URLS, RELEASES_LATEST_URL } from '../src/shared/links';
import { E2E_COLLECTOR_TOKEN, launchApp } from './launch';

let app: ElectronApplication;
let win: Page;
let fixtures: FixtureServer;
let collectorUrl: string;

const tab = (name: RegExp) => win.getByRole('tab', { name });
const btn = (name: string | RegExp, exact = false) => win.getByRole('button', { name, exact });
const heading = (name: string | RegExp) => win.getByRole('heading', { name });

/** Stands in for the OS opening a link, so tests can see exactly what the app asked for. */
async function recordOpenedLinks() {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened: string[] };
    g.__opened = [];
    shell.openExternal = async (url: string) => void g.__opened.push(url);
  });
}
const opened = () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened);
const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());

/** What an SDK would send. Posted straight to the real collector, so the counters it keeps are real. */
async function sendServerEvent(token = E2E_COLLECTOR_TOKEN) {
  const event = {
    id: crypto.randomUUID(),
    state: 'complete',
    timestamp: new Date().toISOString(),
    method: 'GET',
    urlSanitized: 'http://upstream.test/products',
    domain: 'upstream.test',
    status: 200,
    isNavigation: false,
  };
  const res = await fetch(`${collectorUrl}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ events: [event] }),
  });
  return res.status;
}

async function noHorizontalScroll() {
  return win.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

async function openConnectTab() {
  await tab(/Connect App/).click();
  await expect(heading('Connect your application')).toBeVisible();
}

beforeAll(async () => {
  fixtures = await startFixtureServer();
  ({ app, win } = await launchApp());
  const info = await win.evaluate(() => window.tracethrough.getConnectInfo());
  if (!info.listening || !info.collectorUrl) throw new Error(`collector not listening: ${info.error}`);
  collectorUrl = info.collectorUrl;
  await recordOpenedLinks();
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

describe('Home launcher', () => {
  it('asks one question and defaults to Inspect Website without any SDK setup', async () => {
    await expect(heading('What would you like to inspect?')).toBeVisible();
    await expect(tab(/Inspect Website/)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(/Connect App/)).toHaveAttribute('aria-selected', 'false');
    await expect(heading('Inspect a website')).toBeVisible();
    await expect(win.getByText('Enter a URL to see network requests as you browse.')).toBeVisible();
    await expect(win.locator('#target-url')).toHaveAttribute('placeholder', 'https://example.com');
    await expect(btn('Start session')).toBeEnabled();
    const text = await win.locator('main').innerText();
    expect(text).not.toMatch(/npm install|TRACETHROUGH_|instrumentation\.ts|collector/i);
    await expect(win.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-website');
  });

  it('shows the header: brand, version, docs, theme', async () => {
    const env = await win.evaluate(() => window.tracethrough.getEnvironment());
    await expect(win.getByRole('banner')).toContainText('TraceThrough');
    await expect(win.getByRole('banner')).toContainText(`v${env.version}`);
    await expect(btn('Read docs')).toBeVisible();
    await expect(win.getByRole('button', { name: /^Theme:/ })).toBeVisible();
    // Desktop app: the download link lives in the docs menu, not as a header button.
    await expect(btn('Download TraceThrough')).toHaveCount(0);
  });

  it('switches modes with the mouse and the keyboard, keeping what was typed', async () => {
    await win.locator('#target-url').fill('example.org');
    await tab(/Connect App/).click();
    await expect(heading('Connect your application')).toBeVisible();
    await expect(win.getByText('See server requests alongside browser activity.')).toBeVisible();
    await tab(/Inspect Website/).click();
    await expect(win.locator('#target-url')).toHaveValue('example.org');

    await tab(/Inspect Website/).focus();
    await win.keyboard.press('ArrowRight');
    await expect(tab(/Connect App/)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(/Connect App/)).toBeFocused();
    await win.keyboard.press('ArrowLeft');
    await expect(tab(/Inspect Website/)).toHaveAttribute('aria-selected', 'true');
    await win.keyboard.press('End');
    await expect(tab(/Connect App/)).toHaveAttribute('aria-selected', 'true');
    await win.keyboard.press('Home');
    await expect(tab(/Inspect Website/)).toBeFocused();
  });

  it('explains invalid URLs and recovers when the user keeps typing', async () => {
    const url = win.locator('#target-url');
    await url.fill('');
    await btn('Start session').click();
    await expect(win.getByRole('alert')).toContainText('Enter a URL');
    await expect(url).toHaveAttribute('aria-invalid', 'true');

    await url.fill('exa mple.com');
    await btn('Start session').click();
    await expect(win.getByRole('alert')).toContainText('cannot contain spaces');

    await url.fill('file:///etc/passwd');
    await btn('Start session').click();
    await expect(win.getByRole('alert')).toContainText('Unsupported scheme');

    await url.fill('https://');
    await expect(win.getByRole('alert')).toHaveCount(0); // typing clears the old message
    await btn('Start session').click();
    await expect(win.getByRole('alert')).toBeVisible();
    await url.fill('example.org');
  });

  it('keeps masking off by default, says what that means, and exposes both preferences', async () => {
    const mask = win.getByLabel(/Mask secrets/);
    await expect(mask).not.toBeChecked();
    await expect(win.getByText(/Off: values are shown exactly as captured/)).toBeVisible();
    await mask.check();
    await expect(win.getByText(/Cookies, tokens and API keys are hidden/)).toBeVisible();
    await mask.uncheck();
    await expect(win.getByLabel(/This is my app/)).not.toBeChecked();
    await win.getByText('About this session').click();
    await expect(win.getByText(/fresh, separate profile/)).toBeVisible();
  });

  it('"Set up Connect App" jumps to the Connect tab', async () => {
    await btn('Set up Connect App').click();
    await expect(heading('Connect your application')).toBeVisible();
    await tab(/Inspect Website/).click();
  });
});

describe('Docs and links', () => {
  it('Read docs opens the docs index', async () => {
    await btn('Read docs').click();
    await expect.poll(opened).toContain(DOC_URLS.index);
  });

  it('the docs menu lists the journeys, a download link and the npm packages', async () => {
    await btn('More documentation and downloads').click();
    for (const name of ['Getting started', 'Inspect a website', 'Connect a Next.js app', 'Connect a Node.js app', 'Troubleshooting', 'Known limitations']) {
      await expect(win.getByRole('menuitem', { name })).toBeVisible();
    }
    await win.getByRole('menuitem', { name: /Connect a Next\.js app/ }).click();
    await win.getByRole('button', { name: 'More documentation and downloads' }).click();
    await win.getByRole('menuitem', { name: /Download TraceThrough/ }).click();
    await win.getByRole('button', { name: 'More documentation and downloads' }).click();
    await win.getByRole('menuitem', { name: /@tracethrough\/node/ }).click();
    const links = await opened();
    expect(links).toContain(DOC_URLS.connectNext);
    expect(links).toContain(RELEASES_LATEST_URL);
    expect(links).toContain(NPM_URLS.node);
  });

  it('refuses to open anything that is not a TraceThrough link', async () => {
    const before = (await opened()).length;
    for (const url of ['https://example.com', 'file:///C:/Windows/notepad.exe', 'javascript:alert(1)']) {
      await expect(win.evaluate((u) => window.tracethrough.openExternal(u), url)).rejects.toThrow();
    }
    expect((await opened()).length).toBe(before);
  });
});

describe('Connect App wizard: Next.js', () => {
  it('starts at Choose framework and will not continue without a choice', async () => {
    await openConnectTab();
    await expect(btn('Get started')).toBeVisible();
    await btn('Get started').click();
    await expect(heading(/Step 1 of 4.*Choose framework/)).toBeFocused();
    await expect(btn('Continue', true)).toBeDisabled();
    await expect(win.getByText('Choose a framework to continue')).toBeVisible();
    await win.getByRole('radio', { name: /^Next\.js/ }).check();
    await expect(btn('Continue', true)).toBeEnabled();
    await btn('Continue', true).click();
  });

  it('Install: shows the verified command per package manager, copies it and links to npm', async () => {
    await expect(heading(/Step 2 of 4.*Install SDK/)).toBeFocused();
    // The last choice is remembered on this machine, so pick explicitly.
    await win.getByRole('radio', { name: 'npm', exact: true }).check();
    await expect(win.getByText('npm install @tracethrough/next', { exact: true })).toBeVisible();
    await win.getByRole('radio', { name: 'pnpm' }).check();
    await expect(win.getByText('pnpm add @tracethrough/next', { exact: true })).toBeVisible();
    await win.getByRole('radio', { name: 'yarn' }).check();
    await expect(win.getByText('yarn add @tracethrough/next', { exact: true })).toBeVisible();
    await win.getByRole('radio', { name: 'pnpm' }).check();

    await btn('Copy Install command').click();
    await expect(win.getByText('Copied', { exact: true })).toBeVisible();
    expect(await clipboard()).toBe('pnpm add @tracethrough/next');

    await btn(/Open npm package/).click();
    await expect.poll(opened).toContain(NPM_URLS.next);
  });

  it('Configure: only Next.js instructions, token hidden until asked, copy gives the real token', async () => {
    await btn('Continue', true).click();
    await expect(heading(/Step 3 of 4.*Configure/)).toBeFocused();
    const main = win.getByRole('tabpanel');
    await expect(main).toContainText('instrumentation.ts');
    await expect(main).toContainText("await import('@tracethrough/next')");
    await expect(main).not.toContainText("from '@tracethrough/node'");
    await expect(main).toContainText('Collector listening on http://127.0.0.1:');

    const platform = (await win.evaluate(() => window.tracethrough.getEnvironment())).platform;
    await expect(win.getByRole('radio', { name: platform === 'win32' ? 'Windows PowerShell' : /macOS/ })).toBeChecked();

    await expect(main).not.toContainText(E2E_COLLECTOR_TOKEN);
    await btn('Show token').click();
    await expect(main).toContainText(E2E_COLLECTOR_TOKEN);
    await btn('Hide token').click();
    await expect(main).not.toContainText(E2E_COLLECTOR_TOKEN);

    await win.getByRole('radio', { name: 'Windows PowerShell' }).check();
    await btn('Copy PowerShell').click();
    await expect.poll(clipboard).toBe(`$env:TRACETHROUGH_COLLECTOR_URL="${collectorUrl}"; $env:TRACETHROUGH_TOKEN="${E2E_COLLECTOR_TOKEN}"; pnpm dev`);
    await win.getByRole('radio', { name: '.env file' }).check();
    await expect(main).toContainText('.env.local');
    await win.getByRole('radio', { name: /macOS/ }).check();
    await btn('Copy Terminal').click();
    await expect.poll(clipboard).toBe(`TRACETHROUGH_COLLECTOR_URL=${collectorUrl} TRACETHROUGH_TOKEN=${E2E_COLLECTOR_TOKEN} pnpm dev`);
    await btn('Copy instrumentation.ts').click();
    await expect.poll(clipboard).toContain("process.env.NEXT_RUNTIME === 'nodejs'");
  });

  it('keeps advanced options out of the way until opened', async () => {
    const advanced = win.locator('details', { hasText: 'Advanced' });
    await expect(advanced).not.toHaveAttribute('open', '');
    await expect(win.getByText('TRACETHROUGH_ALLOW_PRODUCTION=1')).toBeHidden();
    await advanced.locator('summary').click();
    await expect(win.getByText(/not enabled by default/)).toBeVisible();
    await expect(win.getByText(/NEXT_TELEMETRY_DISABLED=1/)).toBeVisible();
  });

  it('does not lose progress going Back, exiting setup, switching tabs and returning', async () => {
    await btn('Back', true).click();
    await expect(heading(/Step 2 of 4/)).toBeVisible();
    await expect(win.getByRole('radio', { name: 'pnpm' })).toBeChecked();
    await btn('Continue', true).click();
    await btn('Exit setup').click();
    await expect(heading('Connect your application')).toBeVisible();
    await tab(/Inspect Website/).click();
    await openConnectTab();
    await expect(win.getByRole('radio', { name: /Next\.js/ })).toBeChecked();
    await btn(/Continue setup · step 3 of 4/).click();
    await expect(heading(/Step 3 of 4/)).toBeVisible();
    // The stepper jumps directly to a step.
    await btn('Install SDK').click();
    await expect(heading(/Step 2 of 4/)).toBeVisible();
    await btn('Verify connection').click();
    await expect(heading(/Step 4 of 4/)).toBeVisible();
  });
});

describe('Connect App wizard: verification uses the real collector', () => {
  it('waits, then reports a refused request as a connection issue, and Retry starts again', async () => {
    const status = win.getByRole('status').filter({ hasText: /Waiting for connection|Connection issue/ });
    await expect(status).toContainText('Waiting for connection');
    expect(await sendServerEvent('wrong-token')).toBe(401);
    await expect(status).toContainText('Connection issue', { timeout: 10_000 });
    await expect(status).toContainText(/wrong token or collector URL/);
    await expect(win.locator('details', { hasText: 'Troubleshooting' })).toHaveAttribute('open', '');
    await expect(win.getByText(/Copy the connection details again/)).toBeVisible();
    await btn('Retry').click();
    await expect(status).toContainText('Waiting for connection');
  });

  it('detects SDK activity when events arrive but no session is recording', async () => {
    expect(await sendServerEvent()).toBe(200);
    const status = win.getByRole('status').filter({ hasText: /SDK activity detected/ });
    await expect(status).toBeVisible({ timeout: 10_000 });
    await expect(status).toContainText(/no session was recording/);
  });

  it('shows Next.js documentation and hands off to a session with "This is my app" on', async () => {
    await btn(/Read full documentation/).click();
    await expect.poll(opened).toContain(DOC_URLS.connectNext);
    await btn('Inspect my app').click();
    await expect(tab(/Inspect Website/)).toHaveAttribute('aria-selected', 'true');
    await expect(win.getByLabel(/This is my app/)).toBeChecked();
    await expect(win.locator('#target-url')).toHaveValue('example.org'); // typed earlier, not overwritten
  });

  it('reports "Connected and receiving requests" once a session accepts server events', async () => {
    await win.locator('#target-url').fill(`${fixtures.url}/basic`);
    await btn('Start session').click();
    await expect(win.getByRole('status')).toHaveText(/Recording/, { timeout: 20_000 });
    expect(await sendServerEvent()).toBe(200);
    await expect(win.locator('.session-strip')).toContainText('App connected', { timeout: 10_000 });

    win.once('dialog', (d) => void d.accept().catch(() => {}));
    await btn(/New session/).click();
    await openConnectTab();
    await btn(/Continue setup · step 4 of 4/).click();
    const status = win.getByRole('status').filter({ hasText: /Connected and receiving requests/ });
    await expect(status).toBeVisible({ timeout: 10_000 });
    await expect(status).toContainText(/1 server request received/);
  });
});

describe('Connect App wizard: Node.js', () => {
  it('shows Node.js-specific install and configure instructions', async () => {
    await win.getByRole('tab', { name: /Connect App/ }).click();
    await btn('Exit setup').click(); // the wizard resumed where the last test left it
    await btn('Start over').click();
    await win.getByRole('radio', { name: /^Node\.js/ }).check();
    await btn('Get started').click();
    await expect(heading(/Step 2 of 4.*Install SDK/)).toBeVisible(); // framework already chosen
    await expect(win.getByText(/pnpm add @tracethrough\/node|npm install @tracethrough\/node|yarn add @tracethrough\/node/)).toBeVisible();
    await btn(/Open npm package/).click();
    await expect.poll(opened).toContain(NPM_URLS.node);
    await btn('Continue', true).click();
    const main = win.getByRole('tabpanel');
    await expect(main).toContainText("import { register } from '@tracethrough/node'");
    await expect(main).not.toContainText('instrumentation.ts');
    await win.getByRole('radio', { name: '.env file' }).check();
    await expect(main).toContainText('.env');
    await btn('Copy .env').click();
    await expect.poll(clipboard).toContain(`TRACETHROUGH_TOKEN=${E2E_COLLECTOR_TOKEN}`);
    expect(await clipboard()).toContain('node --env-file=.env server.js');
    await win.locator('details', { hasText: 'Advanced' }).locator('summary').click();
    await expect(main).toContainText('handle.disabledReason');
    await btn('Continue', true).click();
    await expect(heading(/Step 4 of 4/)).toBeVisible();
    await btn('Exit setup').click();
  });
});

describe('Starting a website inspection and small windows', () => {
  it('starts a session from a bare host, adding the scheme', async () => {
    await tab(/Inspect Website/).click();
    await win.locator('#target-url').fill(`127.0.0.1:${new URL(fixtures.url).port}/basic`);
    await btn('Start session').click();
    await expect(win.getByRole('status')).toHaveText(/Recording/, { timeout: 20_000 });
    await expect(win.locator('.target .url')).toHaveText(`${fixtures.url}/basic`);
    await expect(win.locator('.topbar')).toContainText('Read docs');
    win.once('dialog', (d) => void d.accept().catch(() => {}));
    await btn(/New session/).click();
    await expect(heading('What would you like to inspect?')).toBeVisible();
    // Each new session starts from the documented defaults, whatever the last one used.
    await expect(win.getByLabel(/Mask secrets/)).not.toBeChecked();
    await expect(win.getByLabel(/This is my app/)).not.toBeChecked();
  });

  it('fits the smallest supported window without horizontal scrolling', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 560));
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(900);
    expect(await noHorizontalScroll()).toBe(true);
    await expect(btn('Start session')).toBeVisible();

    await openConnectTab();
    await win.getByRole('radio', { name: /^Next\.js/ }).check();
    expect(await noHorizontalScroll()).toBe(true);
    await btn(/Continue setup|Get started/).click();
    for (const name of ['Choose framework', 'Install SDK', 'Configure', 'Verify connection']) {
      await btn(name).click();
      expect(await noHorizontalScroll(), name).toBe(true);
    }
    await btn('Exit setup').click();

    // Narrower than the app allows (e.g. a split screen): still usable.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setMinimumSize(300, 400));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 700));
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(560);
    expect(await noHorizontalScroll()).toBe(true);
    await tab(/Inspect Website/).click();
    expect(await noHorizontalScroll()).toBe(true);
  });
});
