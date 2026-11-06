import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConnectInfo } from '../src/shared/api';
import { DOC_FILES, DOC_URLS, NPM_URLS, RELEASES_LATEST_URL, parseExternalUrl } from '../src/shared/links';
import { useHome } from '../src/renderer/src/lib/home';
import {
  NEXT_SNIPPET,
  NODE_CHECK_SNIPPET,
  NODE_SNIPPET,
  PACKAGE_NAME,
  TOKEN_MASK,
  defaultShell,
  devCommand,
  envBlock,
  installCommand,
  troubleshootingTips,
} from '../src/renderer/src/lib/setup';
import { checkUrlInput } from '../src/renderer/src/lib/url';
import { NO_EVENTS_AFTER_MS, baseFrom, deriveVerification } from '../src/renderer/src/lib/verify';

const root = join(import.meta.dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n'); // Windows checkouts use CRLF

describe('URL input check', () => {
  it('rejects empty, spaced and unparseable input with a helpful message', () => {
    expect(checkUrlInput('   ')).toMatchObject({ ok: false, error: expect.stringContaining('Enter a URL') });
    expect(checkUrlInput('exa mple.com')).toMatchObject({ ok: false, error: expect.stringContaining('spaces') });
    expect(checkUrlInput('https://')).toMatchObject({ ok: false });
    expect(checkUrlInput('http://[bad')).toMatchObject({ ok: false });
  });

  it('adds the scheme a bare host implies', () => {
    expect(checkUrlInput('example.com/path')).toEqual({ ok: true, url: 'https://example.com/path' });
    expect(checkUrlInput('localhost:3000')).toEqual({ ok: true, url: 'http://localhost:3000' });
    expect(checkUrlInput('127.0.0.1:8080/x')).toEqual({ ok: true, url: 'http://127.0.0.1:8080/x' });
    expect(checkUrlInput('  https://example.com  ')).toEqual({ ok: true, url: 'https://example.com' });
  });

  it('leaves other schemes for the capture engine to refuse', () => {
    expect(checkUrlInput('file:///etc/passwd')).toEqual({ ok: true, url: 'file:///etc/passwd' });
    expect(checkUrlInput('javascript:alert(1)')).toEqual({ ok: true, url: 'javascript:alert(1)' });
  });
});

describe('external links', () => {
  it('allows only TraceThrough pages on GitHub and npm over https', () => {
    for (const url of [RELEASES_LATEST_URL, ...Object.values(DOC_URLS), ...Object.values(NPM_URLS)]) {
      expect(parseExternalUrl(url)).toBe(url);
    }
  });

  it.each([
    'http://github.com/solomonade1/tracethrough',
    'https://github.com/solomonade1/tracethrough-evil',
    'https://github.com/someone-else/tracethrough',
    'https://github.com.evil.test/solomonade1/tracethrough',
    'https://user:pw@github.com/solomonade1/tracethrough',
    'https://github.com:8443/solomonade1/tracethrough',
    'https://www.npmjs.com/package/left-pad',
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'not a url',
  ])('refuses %s', (url) => {
    expect(() => parseExternalUrl(url)).toThrow();
  });

  it('refuses non-strings', () => {
    expect(() => parseExternalUrl(undefined)).toThrow();
    expect(() => parseExternalUrl({ href: RELEASES_LATEST_URL })).toThrow();
  });

  it('points every docs link at a page that exists in this repository', () => {
    for (const file of Object.values(DOC_FILES)) expect(existsSync(join(root, 'docs', file)), file).toBe(true);
  });

  it('never hardcodes a release version', () => {
    expect(RELEASES_LATEST_URL).toBe('https://github.com/solomonade1/tracethrough/releases/latest');
  });
});

describe('setup content matches the packages', () => {
  it('uses the real package names and install commands', () => {
    expect(PACKAGE_NAME.next).toBe(JSON.parse(read('packages/next/package.json')).name);
    expect(PACKAGE_NAME.node).toBe(JSON.parse(read('packages/node/package.json')).name);
    expect(installCommand('npm', 'next')).toBe('npm install @tracethrough/next');
    expect(installCommand('pnpm', 'node')).toBe('pnpm add @tracethrough/node');
    expect(installCommand('yarn', 'next')).toBe('yarn add @tracethrough/next');
    expect(NPM_URLS.next).toBe('https://www.npmjs.com/package/@tracethrough/next');
    expect(NPM_URLS.node).toBe('https://www.npmjs.com/package/@tracethrough/node');
  });

  it('shows the same snippets the package READMEs publish', () => {
    // First line of each snippet is a UI comment; the code below it must appear verbatim in the README.
    const body = (s: string) => s.split('\n').slice(1).join('\n');
    expect(read('packages/next/README.md')).toContain(body(NEXT_SNIPPET));
    expect(read('packages/node/README.md')).toContain(body(NODE_SNIPPET).trim().split('\n')[0]);
    expect(read('packages/node/README.md')).toContain(NODE_CHECK_SNIPPET);
  });

  it('uses the environment variable names the SDK reads', () => {
    const sdk = read('packages/node/src/index.ts');
    expect(sdk).toContain('TRACETHROUGH_COLLECTOR_URL');
    expect(sdk).toContain('TRACETHROUGH_TOKEN');
    expect(sdk).toContain('TRACETHROUGH_ALLOW_PRODUCTION');
  });

  it('builds a start command per package manager', () => {
    expect(devCommand('npm', 'next')).toBe('npm run dev');
    expect(devCommand('pnpm', 'next')).toBe('pnpm dev');
    expect(devCommand('yarn', 'next')).toBe('yarn dev');
    expect(devCommand('npm', 'node')).toBe('node server.js');
  });

  const url = 'http://127.0.0.1:47811';
  const token = 'secret-token-0123456789abcdef';

  it('writes environment variables for each shell', () => {
    const bash = envBlock({ shell: 'bash', fw: 'next', pm: 'npm', collectorUrl: url, token });
    expect(bash.text).toBe(`TRACETHROUGH_COLLECTOR_URL=${url} TRACETHROUGH_TOKEN=${token} npm run dev`);
    const ps = envBlock({ shell: 'powershell', fw: 'next', pm: 'pnpm', collectorUrl: url, token });
    expect(ps.text).toBe(`$env:TRACETHROUGH_COLLECTOR_URL="${url}"; $env:TRACETHROUGH_TOKEN="${token}"; pnpm dev`);
    const nextEnv = envBlock({ shell: 'dotenv', fw: 'next', pm: 'npm', collectorUrl: url, token });
    expect(nextEnv.label).toBe('.env.local');
    expect(nextEnv.text).toBe(`TRACETHROUGH_COLLECTOR_URL=${url}\nTRACETHROUGH_TOKEN=${token}`);
    const nodeEnv = envBlock({ shell: 'dotenv', fw: 'node', pm: 'npm', collectorUrl: url, token });
    expect(nodeEnv.label).toBe('.env');
    expect(nodeEnv.text).toContain('node --env-file=.env server.js');
  });

  it('keeps the token out of anything shown when it is masked', () => {
    for (const shell of ['bash', 'powershell', 'dotenv'] as const) {
      for (const fw of ['next', 'node'] as const) {
        const shown = envBlock({ shell, fw, pm: 'npm', collectorUrl: url, token: TOKEN_MASK });
        expect(shown.text).not.toContain(token);
        expect(shown.text).toContain(TOKEN_MASK);
      }
    }
  });

  it('defaults to PowerShell on Windows only', () => {
    expect(defaultShell('win32')).toBe('powershell');
    expect(defaultShell('darwin')).toBe('bash');
    expect(defaultShell(undefined)).toBe('bash');
  });

  it('puts the most relevant troubleshooting first', () => {
    expect(troubleshootingTips('next', 'detected', false)[0]!.title).toMatch(/This is my app/);
    expect(troubleshootingTips('next', 'issue', false)[0]!.title).toMatch(/again/);
    expect(troubleshootingTips('node', 'none', false).map((t) => t.title)).toContain('register() runs first');
    expect(troubleshootingTips('next', 'none', false).map((t) => t.title)).toContain('Node.js runtime only');
    expect(troubleshootingTips('next', 'issue', true)[0]!.title).toMatch(/again/);
  });
});

describe('connection verification', () => {
  const info = (over: Partial<ConnectInfo> = {}): ConnectInfo => ({
    listening: true,
    collectorUrl: 'http://127.0.0.1:47811',
    token: 't',
    received: 0,
    ignored: 0,
    rejected: 0,
    ...over,
  });
  const t0 = 1_000_000;

  it('waits while nothing has happened', () => {
    const base = baseFrom(info(), t0);
    expect(deriveVerification({ info: info(), base, now: t0 + 5_000 }).state).toBe('waiting');
    expect(deriveVerification({ info: undefined, now: t0 }).state).toBe('waiting');
  });

  it('says no events arrived only after the wait is over', () => {
    const base = baseFrom(info(), t0);
    expect(deriveVerification({ info: info(), base, now: t0 + NO_EVENTS_AFTER_MS - 1 }).state).toBe('waiting');
    expect(deriveVerification({ info: info(), base, now: t0 + NO_EVENTS_AFTER_MS }).state).toBe('none');
  });

  it('detects SDK activity when events reach the collector with no recording session', () => {
    const base = baseFrom(info({ ignored: 2 }), t0);
    const v = deriveVerification({ info: info({ ignored: 5 }), base, now: t0 + 1000 });
    expect(v.state).toBe('detected');
    expect(v.detail).toMatch(/This is my app/);
  });

  it('reports connected only when events were accepted into a session', () => {
    const base = baseFrom(info({ received: 4, ignored: 1 }), t0);
    expect(deriveVerification({ info: info({ received: 4, ignored: 1 }), base, now: t0 + 60_000 }).state).toBe('none');
    const v = deriveVerification({ info: info({ received: 6, ignored: 1 }), base, now: t0 + 1000 });
    expect(v.state).toBe('connected');
    expect(v.detail).toMatch(/^2 server requests/);
  });

  it('ignores traffic from before verification began', () => {
    const base = baseFrom(info({ received: 50, ignored: 9, rejected: 3 }), t0);
    expect(deriveVerification({ info: info({ received: 50, ignored: 9, rejected: 3 }), base, now: t0 }).state).toBe('waiting');
  });

  it('reports a connection issue for refused requests and a stopped collector', () => {
    const base = baseFrom(info(), t0);
    const refused = deriveVerification({ info: info({ rejected: 1 }), base, now: t0 + 1000 });
    expect(refused.state).toBe('issue');
    expect(refused.collectorProblem).toBe(false);
    const down = deriveVerification({ info: { listening: false, received: 0, ignored: 0, rejected: 0, error: 'Collector could not start: EACCES' }, base, now: t0 });
    expect(down).toMatchObject({ state: 'issue', collectorProblem: true });
    expect(down.detail).toContain('EACCES');
    expect(deriveVerification({ unreachable: true, now: t0 })).toMatchObject({ state: 'issue', collectorProblem: true });
  });

  it('prefers evidence of delivery over earlier refusals', () => {
    const base = baseFrom(info(), t0);
    expect(deriveVerification({ info: info({ rejected: 2, ignored: 1 }), base, now: t0 }).state).toBe('detected');
    expect(deriveVerification({ info: info({ rejected: 2, received: 1 }), base, now: t0 }).state).toBe('connected');
  });
});

describe('home flow state', () => {
  const info: ConnectInfo = { listening: true, collectorUrl: 'http://127.0.0.1:47811', token: 't', received: 3, ignored: 1, rejected: 0 };
  beforeEach(() => {
    useHome.setState(useHome.getInitialState(), true);
  });

  it('starts on Inspect Website with nothing selected', () => {
    const s = useHome.getState();
    expect(s.mode).toBe('website');
    expect(s.setup).toMatchObject({ active: false, step: 1, framework: undefined });
    expect(s.mask).toBe(false); // the documented default is unchanged
  });

  it('opens at Choose framework, or Install when a framework was already picked', () => {
    useHome.getState().startSetup();
    expect(useHome.getState().setup.step).toBe(1);
    useHome.getState().resetSetup();
    useHome.getState().chooseFramework('next');
    useHome.getState().startSetup();
    expect(useHome.getState().setup).toMatchObject({ active: true, step: 2, framework: 'next' });
  });

  it('keeps progress when leaving setup, switching tabs and coming back', () => {
    const h = useHome.getState();
    h.chooseFramework('node');
    h.startSetup();
    h.goToStep(3);
    h.setPackageManager('pnpm');
    h.setShell('powershell');
    useHome.getState().exitSetup();
    useHome.getState().setMode('website');
    useHome.getState().setMode('app');
    expect(useHome.getState().setup).toMatchObject({ active: false, step: 3, framework: 'node', pm: 'pnpm', shell: 'powershell' });
    useHome.getState().startSetup();
    expect(useHome.getState().setup).toMatchObject({ active: true, step: 3 });
  });

  it('measures verification from the first visit to Verify, and again after Retry', () => {
    useHome.getState().chooseFramework('next');
    useHome.getState().goToStep(4, info);
    const first = useHome.getState().setup.verifyBase!;
    expect(first).toMatchObject({ received: 3, ignored: 1, rejected: 0 });
    useHome.getState().goToStep(3, { ...info, received: 9 });
    useHome.getState().goToStep(4, { ...info, received: 9 });
    expect(useHome.getState().setup.verifyBase).toBe(first);
    useHome.getState().retryVerify({ ...info, received: 9 });
    expect(useHome.getState().setup.verifyBase!.received).toBe(9);
  });

  it('hands off to Inspect Website with "This is my app" on, keeping a typed URL', () => {
    useHome.getState().chooseFramework('next');
    useHome.getState().startSetup();
    useHome.getState().inspectApp();
    expect(useHome.getState()).toMatchObject({ mode: 'website', connect: true, url: 'http://localhost:3000' });
    useHome.setState({ url: 'http://localhost:4000', connect: false });
    useHome.getState().inspectApp();
    expect(useHome.getState().url).toBe('http://localhost:4000');
    useHome.setState({ url: '' });
    useHome.getState().chooseFramework('node');
    useHome.getState().inspectApp();
    expect(useHome.getState().url).toBe('');
  });

  it('starts every session from the documented defaults: masking off, "This is my app" off', () => {
    useHome.getState().setMask(true);
    useHome.getState().setConnect(true);
    useHome.setState({ url: 'http://localhost:3000' });
    useHome.getState().resetSessionPrefs();
    expect(useHome.getState()).toMatchObject({ mask: false, connect: false, url: 'http://localhost:3000' });
  });

  it('start over clears the framework and progress', () => {
    useHome.getState().chooseFramework('next');
    useHome.getState().goToStep(4, info);
    useHome.getState().resetSetup();
    expect(useHome.getState().setup).toMatchObject({ active: false, step: 1, framework: undefined, verifyBase: undefined });
  });
});
