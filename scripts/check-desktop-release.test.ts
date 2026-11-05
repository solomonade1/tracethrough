import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Plain JS on purpose: the workflow runs it before `pnpm install`.
import { checkDesktopRelease } from './check-desktop-release.mjs';

const script = resolve(import.meta.dirname, 'check-desktop-release.mjs');
let repo: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();

function commit(version: string, message: string) {
  mkdirSync(join(repo, 'apps/desktop'), { recursive: true });
  writeFileSync(join(repo, 'apps/desktop/package.json'), JSON.stringify({ name: 'desktop', version }));
  git('add', '-A');
  git('commit', '-m', message);
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'tracethrough-release-check-'));
  git('init', '-q', '-b', 'main');
  commit('1.2.3', 'release 1.2.3 on main');
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('checkDesktopRelease', () => {
  const check = (tag: string, mainRef = 'main') => checkDesktopRelease({ tag, repo, mainRef });

  it('accepts a tag that matches the app version on a commit reachable from main', () => {
    expect(check('v1.2.3')).toEqual([]);
  });

  it('rejects a tag that does not match the app version, before anything else is built', () => {
    expect(check('v1.2.4')).toEqual([expect.stringMatching(/does not match the desktop app version v1\.2\.3/)]);
    expect(check('v1.2')[0]).toMatch(/not a release tag/);
    expect(check('1.2.3')[0]).toMatch(/not a release tag/);
  });

  it('rejects a commit that is not reachable from main', () => {
    git('checkout', '-q', '-b', 'side');
    commit('2.0.0', 'unmerged work on a side branch');
    try {
      expect(check('v2.0.0')).toEqual([expect.stringMatching(/not reachable from main/)]);
    } finally {
      git('checkout', '-q', 'main');
    }
  });

  it('accepts that commit once it is on main', () => {
    git('merge', '-q', '--ff-only', 'side');
    expect(check('v2.0.0')).toEqual([]);
  });

  it('reports a missing main ref instead of passing', () => {
    expect(check('v2.0.0', 'origin/main')[0]).toMatch(/cannot compare the tagged commit with origin\/main/);
  });

  it('reports every problem at once', () => {
    expect(check('nope', 'origin/main')).toHaveLength(3);
  });
});

describe('check-desktop-release.mjs as a command', () => {
  const run = (...args: string[]) => {
    try {
      return { code: 0, output: execFileSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }) };
    } catch (err) {
      const e = err as { status: number; stderr: string };
      return { code: e.status, output: e.stderr };
    }
  };

  it('exits 0 for a good tag and 1 for a bad one', () => {
    expect(run('v2.0.0', '--main-ref', 'main')).toMatchObject({ code: 0 });
    const bad = run('v9.9.9', '--main-ref', 'main');
    expect(bad.code).toBe(1);
    expect(bad.output).toContain('does not match the desktop app version');
  });
});
