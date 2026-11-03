/**
 * Phase 0 spike: `pnpm spike <url> [--channel chrome|msedge|chromium] [--headless] [--for <seconds>]`
 * Opens an isolated browser, streams redacted exchanges to the terminal, and on exit writes the
 * sanitized session to .tracethrough/session-<id>.json.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { NetworkEvent } from '@tracethrough/core';
import { CaptureSession, type BrowserChannel } from '@tracethrough/capture';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    channel: { type: 'string' },
    headless: { type: 'boolean', default: false },
    for: { type: 'string' },
  },
});
const url = positionals[0];
if (!url) {
  console.error('Usage: pnpm spike <url> [--channel chrome|msedge|chromium] [--headless] [--for <seconds>]');
  process.exit(1);
}

const color = (code: number, s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const statusColor = (e: NetworkEvent) =>
  e.state === 'failed' ? 31 : !e.status ? 37 : e.status >= 500 ? 31 : e.status >= 400 ? 33 : e.status >= 300 ? 36 : 32;

function line(e: NetworkEvent): string {
  const status = e.state === 'failed' ? `ERR ${e.error?.message}` : String(e.status ?? '...');
  const body = e.responseBody?.unavailableReason
    ? `body:${e.responseBody.unavailableReason}`
    : e.responseBody?.sizeBytes !== undefined
      ? `${(e.responseBody.sizeBytes / 1024).toFixed(1)}KB${e.responseBody.truncated ? ' (truncated)' : ''}`
      : '';
  const flags = [e.isNavigation && 'NAV', e.redactionApplied && 'redacted', e.fromServiceWorker && 'SW'].filter(Boolean).join(',');
  return [
    color(statusColor(e), status.padEnd(4)),
    e.method.padEnd(6),
    (e.type ?? '').padEnd(8),
    `${Math.round(e.durationMs ?? 0)}ms`.padStart(7),
    e.urlSanitized.length > 120 ? `${e.urlSanitized.slice(0, 117)}...` : e.urlSanitized,
    color(90, [body, flags].filter(Boolean).join(' ')),
  ].join('  ');
}

const session = await CaptureSession.start({ url, channel: values.channel as BrowserChannel | undefined, headless: values.headless });
console.log(color(1, `● Recording`) + ` session ${session.id} in ${session.channel}. Close the browser window or press Ctrl+C to stop.\n`);

session.on('event', (e) => {
  if (e.state !== 'pending') console.log(line(e));
});

let finishing = false;
async function finish() {
  if (finishing) return;
  finishing = true;
  await session.stop();
  const events = session.buffer.all();
  const failed = events.filter((e) => e.state === 'failed' || (e.status ?? 0) >= 400).length;
  const dir = '.tracethrough';
  await mkdir(dir, { recursive: true });
  const file = join(dir, `session-${session.id}.json`);
  await writeFile(file, JSON.stringify({ sessionId: session.id, dropped: session.buffer.dropped, events }, null, 2));
  console.log(`\n■ Stopped. ${events.length} exchanges, ${failed} failed/4xx/5xx, ${session.buffer.dropped} dropped.`);
  console.log(`  Sanitized session written to ${file}`);
  process.exit(0);
}

session.on('closed', finish);
process.on('SIGINT', finish);
if (values.for) setTimeout(finish, Number(values.for) * 1000);
