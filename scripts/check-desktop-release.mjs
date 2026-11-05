#!/usr/bin/env node
/**
 * Gate for desktop release tags (run by desktop-release.yml before anything is built or published).
 *
 *   node scripts/check-desktop-release.mjs <tag> [--main-ref origin/main] [--repo <dir>]
 *
 * Fails unless:
 *   1. the tag looks like v<major>.<minor>.<patch>[-prerelease];
 *   2. it equals "v" + the version in apps/desktop/package.json of the checked-out commit;
 *   3. the checked-out commit (HEAD) is reachable from the main ref, so a tag cannot ship code
 *      that never went through the protected branch.
 *
 * Plain Node, no dependencies: it runs before `pnpm install`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Returns a list of problems; empty means the tag may be released. */
export function checkDesktopRelease({ tag, repo = process.cwd(), mainRef = 'origin/main' }) {
  const problems = [];
  if (!TAG.test(tag ?? '')) {
    problems.push(`"${tag}" is not a release tag (expected v<major>.<minor>.<patch>, e.g. v0.3.0)`);
  }

  let appVersion;
  try {
    appVersion = JSON.parse(readFileSync(join(repo, 'apps/desktop/package.json'), 'utf8')).version;
  } catch (err) {
    problems.push(`cannot read apps/desktop/package.json: ${err.message}`);
  }
  if (appVersion !== undefined && tag !== `v${appVersion}`) {
    problems.push(`tag ${tag} does not match the desktop app version v${appVersion} in apps/desktop/package.json`);
  }

  try {
    // Exit status 1 means "not an ancestor"; anything else (bad ref, not a repository) is an error.
    execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', mainRef], { cwd: repo, stdio: 'pipe' });
  } catch (err) {
    problems.push(
      err.status === 1
        ? `the tagged commit is not reachable from ${mainRef}: release tags must point at a commit that is on main`
        : `cannot compare the tagged commit with ${mainRef}: ${String(err.stderr || err.message).trim()}`,
    );
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const tag = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  const problems = checkDesktopRelease({ tag, repo: option('--repo', process.cwd()), mainRef: option('--main-ref', 'origin/main') });
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log(`✓ ${tag} matches the desktop app version and is on main`);
}
