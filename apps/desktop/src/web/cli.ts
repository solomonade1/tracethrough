import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { BrowserChannel } from '@tracelens/capture';
import { desktopUserDataDir, startWebServer } from './server';

// Local web mode: `pnpm web [--port <n>] [--no-open]`. Uses the same env overrides as the desktop app.
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const staticDir = join(appRoot, 'out', 'web');
const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as { productName: string; version: string };

const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    'no-open': { type: 'boolean', default: false },
  },
});

if (!existsSync(join(staticDir, 'index.html'))) {
  console.error('Web UI is not built. Run `pnpm web` from the repository root (it builds first).');
  process.exit(1);
}

const env = process.env;
const server = await startWebServer({
  staticDir,
  appVersion: pkg.version,
  collectorTokenFile: join(desktopUserDataDir(pkg.productName), 'collector.json'),
  port: values.port ? Number(values.port) : env.TRACELENS_WEB_PORT ? Number(env.TRACELENS_WEB_PORT) : undefined,
  collectorPort: env.TRACELENS_COLLECTOR_PORT ? Number(env.TRACELENS_COLLECTOR_PORT) : undefined,
  collectorToken: env.TRACELENS_COLLECTOR_TOKEN || undefined,
  headless: env.TRACELENS_HEADLESS_CAPTURE === '1',
  channel: env.TRACELENS_BROWSER_CHANNEL as BrowserChannel | undefined,
});

console.log(`TraceLens ${pkg.version} (web mode) is running.\n\n  Open: ${server.launchUrl}\n\nThe link contains an access token for this run only. Press Ctrl+C to stop.`);

if (!values['no-open']) {
  // `start` treats its first quoted argument as a window title, hence the empty one.
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', `"${server.launchUrl}"`]]
      : process.platform === 'darwin'
        ? ['open', [server.launchUrl]]
        : ['xdg-open', [server.launchUrl]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true })
    .on('error', () => console.log('Could not open a browser automatically; open the link above.'))
    .unref();
}

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await server.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
