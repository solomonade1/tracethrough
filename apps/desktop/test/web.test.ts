import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { request, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserChannel } from '@tracethrough/capture';
import type { NetworkEvent } from '@tracethrough/core';
import { CANARY, startFixtureServer, type FixtureServer } from '@tracethrough/fixtures';
import type { ConnectInfo, EventBatch, SessionStatus } from '../src/shared/api';
import { startWebServer, type WebServer } from '../src/web/server';

const channel = process.env.TRACETHROUGH_BROWSER_CHANNEL as BrowserChannel | undefined;
const TOKEN = 'web-test-token-0123456789abcdef';

interface Reply {
  status: number;
  headers: IncomingMessage['headers'];
  text: string;
}

describe('local web mode server', () => {
  let dir: string;
  let fixtures: FixtureServer;
  let web: WebServer;

  function send(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    return new Promise<Reply>((resolve, reject) => {
      const headers = { host: `127.0.0.1:${web.port}`, ...init.headers };
      const req = request({ host: '127.0.0.1', port: web.port, path, method: init.method ?? 'GET', headers }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
      });
      req.on('error', reject);
      req.end(init.body);
    });
  }

  async function rpc<T>(name: string, ...args: unknown[]): Promise<T> {
    const res = await send(`/api/${name}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', origin: `http://127.0.0.1:${web.port}` },
      body: JSON.stringify(args),
    });
    const body = JSON.parse(res.text) as { result: T; error?: string };
    if (res.status !== 200) throw new Error(body.error);
    return body.result;
  }

  /** Opens the push stream and resolves once `done` is satisfied by the messages received so far. */
  function openStream() {
    const statuses: SessionStatus[] = [];
    const events = new Map<string, NetworkEvent>();
    const waiters: { check: () => boolean; resolve: () => void }[] = [];
    const notify = () => {
      for (const w of waiters.splice(0)) (w.check() ? w.resolve : () => waiters.push(w))();
    };
    const req = request(
      { host: '127.0.0.1', port: web.port, path: '/api/stream', headers: { host: `127.0.0.1:${web.port}`, authorization: `Bearer ${TOKEN}` } },
      (res) => {
        let pending = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          pending += chunk;
          let end: number;
          while ((end = pending.indexOf('\n')) >= 0) {
            const { channel: ch, payload } = JSON.parse(pending.slice(0, end));
            pending = pending.slice(end + 1);
            if (ch === 'tl:status') statuses.push(payload);
            else for (const e of (payload as EventBatch).upserts) events.set(e.id, e);
          }
          notify();
        });
      },
    );
    req.end();
    const until = (check: () => boolean, timeoutMs = 20_000) =>
      check()
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              const seen = `statuses: ${statuses.map((s) => s.state + (s.error ? ` (${s.error})` : '')).join(', ') || 'none'}; events: ${events.size}`;
              reject(new Error(`Timed out waiting for stream (${seen})`));
            }, timeoutMs);
            waiters.push({ check, resolve: () => (clearTimeout(timer), resolve()) });
          });
    return { statuses, events, until, close: () => req.destroy() };
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tracethrough-web-'));
    await mkdir(join(dir, 'static', 'assets'), { recursive: true });
    await writeFile(join(dir, 'static', 'index.html'), '<!doctype html><title>TraceThrough</title>');
    await writeFile(join(dir, 'static', 'assets', 'app.js'), 'console.log(1)');
    await writeFile(join(dir, 'secret.txt'), 'outside the web root');
    fixtures = await startFixtureServer();
    web = await startWebServer({
      staticDir: join(dir, 'static'),
      appVersion: '0.0.0-test',
      collectorTokenFile: join(dir, 'collector.json'),
      port: 0,
      token: TOKEN,
      collectorPort: 0,
      headless: true,
      channel,
    });
  });

  afterAll(async () => {
    await web?.close();
    await fixtures?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('serves the UI with a strict CSP and keeps the token out of the request', async () => {
    expect(web.launchUrl).toBe(`${web.url}/#token=${TOKEN}`);
    const page = await send('/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['cache-control']).toBe('no-store');
    expect((await send('/assets/app.js')).headers['content-type']).toContain('text/javascript');
  });

  it('does not serve files outside the web root', async () => {
    expect((await send('/..%2fsecret.txt')).status).toBe(404);
    expect((await send('/%2e%2e/secret.txt')).status).toBe(404);
    expect((await send('/missing.js')).status).toBe(404);
  });

  it('refuses foreign hosts (DNS rebinding) and foreign origins', async () => {
    expect((await send('/', { headers: { host: `evil.test:${web.port}` } })).status).toBe(403);
    const crossSite = await send('/api/environment', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', origin: 'https://evil.test' },
      body: '[]',
    });
    expect(crossSite.status).toBe(403);
  });

  it('requires the token for every API call', async () => {
    const post = (headers: Record<string, string>) =>
      send('/api/start', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify([fixtures.url]) });
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await send('/api/stream')).status).toBe(401);
    expect((await send('/api/stream', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
  });

  it('rejects unknown calls and malformed bodies', async () => {
    const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    expect((await send('/api/constructor', { method: 'POST', headers, body: '[]' })).status).toBe(404);
    expect((await send('/api/stop', { method: 'POST', headers, body: '{not json' })).status).toBe(400);
    expect((await send('/api/stop', { method: 'POST', headers, body: '{}' })).status).toBe(400);
    expect((await send('/api/stop', { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: '[]' })).status).toBe(415);
    await expect(rpc('export', 'xml')).rejects.toThrow('Unknown export format');
  });

  it('reports the environment and App Connect collector', async () => {
    const env = await rpc<{ version: string }>('environment');
    expect(env.version).toBe('0.0.0-test');
    const info = await rpc<ConnectInfo>('connectInfo');
    expect(info.listening).toBe(true);
    expect(info.collectorUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('runs a capture session and streams redacted events', async () => {
    const stream = openStream();
    await stream.until(() => stream.statuses.length > 0);
    expect(stream.statuses[0]!.state).toBe('idle');

    expect(await rpc('start', 'file:///etc/passwd')).toMatchObject({ ok: false });
    expect(await rpc('start', `${fixtures.url}/basic`, { connect: false })).toEqual({ ok: true });
    await stream.until(() => stream.statuses.some((s) => s.state === 'recording'));
    const hasSlow = () => [...stream.events.values()].some((e) => e.urlSanitized.includes('/api/slow') && e.state === 'complete');
    await stream.until(hasSlow);
    expect(JSON.stringify([...stream.events.values()])).not.toContain(CANARY);

    // A tab that opens (or reloads) mid-session is sent what is already buffered.
    const late = openStream();
    await late.until(() => late.events.size > 0 && [...late.events.values()].some((e) => e.urlSanitized.includes('/api/slow')));
    expect(late.statuses[0]!.state).toBe('recording');
    late.close();

    const har = await rpc<string>('export', 'har');
    expect(JSON.parse(har).log.entries.length).toBeGreaterThan(0);
    expect(har).not.toContain(CANARY);

    await rpc('stop');
    await stream.until(() => stream.statuses.at(-1)!.state === 'stopped');
    stream.close();
    // Launching the browser happens inside this test; give it the same budget capture tests give their launch hooks.
  }, 60_000);
});
