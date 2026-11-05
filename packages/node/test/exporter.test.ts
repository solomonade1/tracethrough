import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerEventInput } from '@tracethrough/core';
import { Exporter } from '../src/exporter.ts';

const event = (id: string): ServerEventInput => ({
  id,
  state: 'complete',
  timestamp: new Date().toISOString(),
  method: 'GET',
  urlSanitized: `https://upstream.test/${id}`,
  domain: 'upstream.test',
  status: 200,
  isNavigation: false,
});

describe('Exporter.flush', () => {
  let collector: Server | undefined;
  afterEach(async () => {
    const server = collector;
    collector = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  async function slowCollector(delayMs: number) {
    const received: string[] = [];
    collector = createServer((req, res) => {
      let text = '';
      req.on('data', (c: Buffer) => (text += c));
      req.on('end', () =>
        setTimeout(() => {
          for (const e of JSON.parse(text).events as ServerEventInput[]) received.push(e.id);
          res.setHeader('content-type', 'application/json').end('{"accepted":1,"enabled":true}');
        }, delayMs),
      );
    });
    await new Promise<void>((r) => collector!.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${(collector.address() as AddressInfo).port}`, received };
  }

  it('does not resolve until a batch the background timer already started has been delivered', async () => {
    const { url, received } = await slowCollector(200);
    const exporter = new Exporter({ collectorUrl: url, token: 't', flushIntervalMs: 5, maxQueue: 10, onDisable: () => {} });
    exporter.push(event('a'));
    // Let the 5 ms timer take the event off the queue and start sending it...
    await new Promise((r) => setTimeout(r, 60));
    expect(received).toEqual([]);
    // ...then flush: the queue is empty, but the event is still on its way, so flush must wait.
    await exporter.flush();
    expect(received).toEqual(['a']);
  });

  it('sends events queued meanwhile too', async () => {
    const { url, received } = await slowCollector(50);
    const exporter = new Exporter({ collectorUrl: url, token: 't', flushIntervalMs: 5, maxQueue: 10, onDisable: () => {} });
    exporter.push(event('a'));
    await new Promise((r) => setTimeout(r, 20));
    exporter.push(event('b'));
    await exporter.flush();
    expect(received.sort()).toEqual(['a', 'b']);
  });

  it('returns promptly when there is nothing to send, and when the collector is down', async () => {
    const exporter = new Exporter({ collectorUrl: 'http://127.0.0.1:9', token: 't', flushIntervalMs: 5, maxQueue: 10, onDisable: () => {} });
    await exporter.flush();
    exporter.push(event('a'));
    await expect(exporter.flush()).resolves.toBeUndefined();
  });
});
