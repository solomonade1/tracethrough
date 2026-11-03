import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerEventInput } from '@tracelens/core';
import { startCollector, type Collector } from '../src/index.js';

const event: ServerEventInput = {
  id: 'e1',
  state: 'complete',
  timestamp: new Date(0).toISOString(),
  method: 'GET',
  urlSanitized: 'https://upstream.test/a',
  domain: 'upstream.test',
  status: 200,
  isNavigation: false,
};

function post(port: number, body: string, headers: Record<string, string>, path = '/v1/events') {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text || '{}') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('collector', () => {
  let collector: Collector;
  const received: ServerEventInput[][] = [];
  let enabled = true;
  const good = () => ({
    host: `127.0.0.1:${collector.port}`,
    authorization: `Bearer ${collector.token}`,
    'content-type': 'application/json',
  });

  beforeAll(async () => {
    collector = await startCollector({
      port: 0,
      maxBodyBytes: 4096,
      onEvents: (events) => {
        received.push(events);
        return enabled;
      },
    });
  });
  afterAll(() => collector.close());

  it('accepts a valid authenticated batch', async () => {
    const res = await post(collector.port, JSON.stringify({ events: [event] }), good());
    expect(res).toEqual({ status: 200, body: { accepted: 1, enabled: true } });
    expect(received.at(-1)).toEqual([event]);
  });

  it('signals the kill switch when the consumer declines', async () => {
    enabled = false;
    const res = await post(collector.port, JSON.stringify({ events: [event] }), good());
    enabled = true;
    expect(res.body.enabled).toBe(false);
  });

  it.each([
    ['missing token', { authorization: '' }, 401],
    ['wrong token', { authorization: 'Bearer nope' }, 401],
    ['browser origin', { origin: 'https://evil.test' }, 403],
    ['rebinding host', { host: 'evil.test:80' }, 403],
    ['wrong content type', { 'content-type': 'text/plain' }, 415],
  ])('rejects %s', async (_, override, status) => {
    const before = received.length;
    const res = await post(collector.port, JSON.stringify({ events: [event] }), { ...good(), ...override });
    expect(res.status).toBe(status);
    expect(received.length).toBe(before);
  });

  it('rejects invalid, oversized and wrong-path requests', async () => {
    expect((await post(collector.port, '{nope', good())).status).toBe(400);
    expect((await post(collector.port, JSON.stringify({ events: [{ id: 1 }] }), good())).status).toBe(400);
    expect((await post(collector.port, JSON.stringify({ events: [event], pad: 'x'.repeat(5000) }), good())).status).toBe(413);
    expect((await post(collector.port, '{}', good(), '/other')).status).toBe(404);
  });

  it('only listens on loopback and falls back when the port is taken', async () => {
    expect(collector.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const second = await startCollector({ port: collector.port, onEvents: () => {} });
    try {
      expect(second.port).not.toBe(collector.port);
    } finally {
      await second.close();
    }
  });
});
