/**
 * Packed-artifact smoke test for the three npm packages (`pnpm smoke:packages`).
 *
 * Workspace tests import TypeScript source through the packages' `exports`, so they never exercise
 * what users install. This builds and packs `core`, `node` and `next` exactly as publishing would
 * (`pnpm pack`, which also swaps in `publishConfig`), installs the tarballs together into a throwaway
 * project OUTSIDE the workspace with npm, and checks that:
 *   - the manifests inside the tarballs use published version ranges, never `workspace:`;
 *   - runtime imports resolve to the shipped JavaScript in node_modules, not to source;
 *   - the type declarations resolve and are real types (not `any`);
 *   - the SDK registers, reports a call to a test collector, and shuts down.
 * Nothing is published: it only ever runs `pnpm pack`.
 *
 *   pnpm smoke:packages [--keep]   (--keep leaves the temporary directory for inspection)
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { startCollector } from '../packages/collector/src/index.ts';
import type { ServerEventInput } from '@tracethrough/core';

const root = resolve(import.meta.dirname, '..');
const keep = process.argv.includes('--keep');
const PACKAGES = ['core', 'node', 'next'] as const;
const isWindows = process.platform === 'win32';

function fail(message: string): never {
  throw new Error(message);
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

/** Runs a command, streaming its output, and throws unless it exits 0. `.cmd` shims need a shell on Windows. */
function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    shell: isWindows && /^(pnpm|npm|npx)$/.test(command),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed (${result.status}) in ${cwd}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

/** Like run(), but without blocking this process: the child talks to a collector that lives in it. */
function runAsync(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c));
    child.stderr.on('data', (c: Buffer) => (out += c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolvePromise(out) : reject(new Error(`${command} ${args.join(' ')} exited ${code}
${out}`))));
  });
}

const step = (message: string) => console.log(`\n▸ ${message}`);

const work = mkdtempSync(join(tmpdir(), 'tracethrough-pack-'));
const consumer = join(work, 'consumer');
const tarballs = join(consumer, 'tarballs');
check(!(consumer + sep).startsWith(root + sep), 'the consumer project must live outside the workspace');
mkdirSync(tarballs, { recursive: true });

interface Manifest {
  name: string;
  version: string;
  main?: string;
  types?: string;
  exports?: Record<string, unknown>;
  [field: string]: unknown;
}

try {
  step('Building core, node and next');
  run('pnpm', ['build:packages'], root);

  step('Packing');
  const workspaceVersion: Record<string, string> = {};
  for (const name of PACKAGES) {
    const dir = join(root, 'packages', name);
    workspaceVersion[`@tracethrough/${name}`] = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest).version;
    run('pnpm', ['pack', '--pack-destination', tarballs], dir);
  }
  const files = Object.fromEntries(
    PACKAGES.map((name) => {
      const file = readdirSync(tarballs).find((f) => f === `tracethrough-${name}-${workspaceVersion[`@tracethrough/${name}`]}.tgz`);
      check(file, `no tarball for @tracethrough/${name} in ${tarballs}: ${readdirSync(tarballs).join(', ')}`);
      return [name, file];
    }),
  ) as Record<(typeof PACKAGES)[number], string>;

  step('Inspecting the tarballs');
  for (const name of PACKAGES) {
    const contents = readTarball(join(tarballs, files[name]));
    const manifest = JSON.parse(contents.get('package/package.json')?.toString('utf8') ?? fail(`@tracethrough/${name}: no package.json in the tarball`)) as Manifest;
    const label = `@tracethrough/${name}`;

    check(manifest.name === label, `${label}: unexpected name ${manifest.name}`);
    check(manifest.version === workspaceVersion[label], `${label}: version ${manifest.version} differs from the workspace`);
    check(manifest.main === './dist/index.js' && manifest.types === './dist/index.d.ts', `${label}: main/types do not point at dist`);
    check(JSON.stringify(manifest.exports) === JSON.stringify({ '.': { types: './dist/index.d.ts', default: './dist/index.js' } }), `${label}: exports still point at source: ${JSON.stringify(manifest.exports)}`);
    for (const required of ['dist/index.js', 'dist/index.d.ts', 'LICENSE', 'README.md']) {
      check(contents.has(`package/${required}`), `${label}: the tarball is missing ${required}`);
    }
    check(![...contents.keys()].some((f) => f.startsWith('package/src/')), `${label}: the tarball ships src/`);

    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = (manifest[field] ?? {}) as Record<string, string>;
      for (const [dep, range] of Object.entries(deps)) {
        check(!/^(workspace|file|link):/.test(range), `${label}: ${field}.${dep} is "${range}", not a published range`);
        if (dep in workspaceVersion) {
          check(
            /^[\^~]?\d+\.\d+\.\d+/.test(range) && range.replace(/^[\^~]/, '') === workspaceVersion[dep],
            `${label}: ${field}.${dep} is "${range}", expected the sibling's version ${workspaceVersion[dep]}`,
          );
        }
      }
    }
    console.log(`  ✓ ${label}@${manifest.version}`);
  }

  step('Installing the tarballs together into a clean project (npm)');
  const spec = (name: string) => `file:./tarballs/${files[name as (typeof PACKAGES)[number]]}`;
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'tracethrough-pack-consumer',
        private: true,
        type: 'module',
        dependencies: Object.fromEntries(PACKAGES.map((n) => [`@tracethrough/${n}`, spec(n)])),
        devDependencies: { '@types/node': '^20.19.43' },
        // Make the tarballs satisfy each other's dependency on a sibling, so nothing comes from a registry copy.
        overrides: { '@tracethrough/core': '$@tracethrough/core', '@tracethrough/node': '$@tracethrough/node' },
      },
      null,
      2,
    ),
  );
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error'], consumer);

  step('Checking runtime resolution');
  writeFileSync(
    join(consumer, 'resolve-check.mjs'),
    `import assert from 'node:assert/strict';
for (const name of ['core', 'node', 'next']) {
  const url = import.meta.resolve('@tracethrough/' + name);
  assert.match(url, new RegExp('/node_modules/@tracethrough/' + name + '/dist/index\\\\.js$'), name + ' resolved to ' + url);
}
const core = await import('@tracethrough/core');
const node = await import('@tracethrough/node');
const next = await import('@tracethrough/next');
assert.equal(typeof core.createRedactor, 'function');
assert.equal(typeof core.toHar, 'function');
assert.equal(typeof node.register, 'function');
assert.equal(typeof next.register, 'function');
assert.equal(typeof next.nextRequestContext, 'function');
// Outside Next.js there is no request store: the adapter must say so rather than throw.
assert.equal(next.nextRequestContext(), undefined);
console.log('resolve-check ok');
`,
  );
  console.log(run('node', ['resolve-check.mjs'], consumer).trim());

  step('Checking type declarations');
  writeFileSync(
    join(consumer, 'types-check.ts'),
    `import { createRedactor, toHar, type NetworkEvent } from '@tracethrough/core';
import { register, type TraceThroughHandle, type TraceThroughNodeOptions } from '@tracethrough/node';
import { nextRequestContext, register as registerNext } from '@tracethrough/next';

const opts: TraceThroughNodeOptions = { flushIntervalMs: 50 };
const handle: TraceThroughHandle = register(opts);
const nextHandle: TraceThroughHandle | undefined = registerNext(opts);
const ctx: { path?: string } | undefined = nextRequestContext();
const events: NetworkEvent[] = [];
const har = toHar(events, '1.0.0', createRedactor(false).masking);
export { handle, nextHandle, ctx, har };

// Real types, not 'any': each of these must be an error.
// @ts-expect-error register() returns a handle, not a number
const wrongHandle: number = register();
// @ts-expect-error unknown option
register({ nope: true });
// @ts-expect-error masking is a boolean
const wrongMasking: string = createRedactor().masking;
void wrongHandle;
void wrongMasking;
`,
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, noEmit: true, skipLibCheck: false, types: ['node'] },
        files: ['types-check.ts'],
      },
      null,
      2,
    ),
  );
  run('pnpm', ['exec', 'tsc', '-p', join(consumer, 'tsconfig.json')], root);
  console.log('  ✓ declarations resolve and are typed');

  for (const sdk of ['node', 'next'] as const) {
    step(`SDK registration and shutdown against a test collector (@tracethrough/${sdk})`);
    const received: ServerEventInput[] = [];
    const collector = await startCollector({ port: 0, onEvents: (events) => void received.push(...events) });
    writeFileSync(
      join(consumer, 'sdk-check.mjs'),
      `import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
const { register } = await import('@tracethrough/' + process.env.SDK);

const handle = register();
assert.equal(handle.enabled, true, 'register() should be enabled: ' + handle.disabledReason);

const upstream = createServer((_req, res) => res.setHeader('content-type', 'application/json').end('{"ok":true}'));
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const app = createServer(async (_req, res) => {
  await (await fetch('http://127.0.0.1:' + upstream.address().port + '/upstream')).text();
  res.end('ok');
});
await new Promise((r) => app.listen(0, '127.0.0.1', r));
await new Promise((resolve, reject) => {
  const req = request(
    { host: '127.0.0.1', port: app.address().port, path: '/page', headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' } },
    (res) => { res.resume(); res.on('end', resolve); },
  );
  req.on('error', reject);
  req.end();
});
await handle.flush();
await handle.shutdown();
assert.equal(handle.enabled, false);
assert.equal(handle.disabledReason, 'shut down');
app.close();
upstream.close();
console.log('sdk-check ok');
`,
    );
    const output = await runAsync('node', ['sdk-check.mjs'], consumer, {
      ...process.env,
      SDK: sdk,
      NODE_ENV: 'development',
      TRACETHROUGH_COLLECTOR_URL: collector.url,
      TRACETHROUGH_TOKEN: collector.token,
      TRACETHROUGH_DISABLED: '',
    });
    await collector.close();
    console.log(output.trim());
    const call = received.find((e) => e.urlSanitized.endsWith('/upstream'));
    check(call, `the collector received no upstream call from the packed @tracethrough/${sdk} (got ${received.length} events)`);
    check(call.traceId === '4bf92f3577b34da6a3ce929d0e0e4736', `the call was not linked to the incoming trace: ${call.traceId}`);
    check(call.handler === 'GET /page', `unexpected handler ${call.handler}`);
    console.log(`  ✓ reported ${received.length} event(s), linked to the incoming trace`);
  }

  console.log('\n✓ Packed packages install and work in a clean project.');
} finally {
  if (keep) console.log(`\n(kept ${work})`);
  else rmSync(work, { recursive: true, force: true });
}

/** Reads a .tgz into a map of path to bytes (regular files only). System `tar` is avoided: GNU tar reads "C:" as a host. */
function readTarball(file: string): Map<string, Buffer> {
  const tar = gunzipSync(readFileSync(file));
  const files = new Map<string, Buffer>();
  /** A NUL-terminated field. */
  const text = (from: number, length: number) => tar.toString('utf8', from, from + length).split(String.fromCharCode(0))[0] ?? '';
  let paxPath: string | undefined;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const name = text(offset, 100);
    if (!name) break; // end-of-archive marker
    const size = parseInt(text(offset + 124, 12).trim() || '0', 8);
    const type = text(offset + 156, 1);
    const prefix = text(offset + 345, 155);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    if (type === 'x') {
      // PAX extended header: lines of "<length> key=value".
      const line = body.toString('utf8').split(String.fromCharCode(10)).find((l) => l.includes(' path='));
      paxPath = line?.slice(line.indexOf(' path=') + ' path='.length);
    } else if (type === '0' || type === '') {
      files.set(paxPath ?? (prefix ? `${prefix}/${name}` : name), Buffer.from(body));
      paxPath = undefined;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
