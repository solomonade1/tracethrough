#!/usr/bin/env node
/**
 * Reports, from the built installer itself, whether it is code-signed (and on macOS notarized).
 * desktop-release.yml runs it on every installer so a release is only ever labelled signed when the
 * artifact verifies, never merely because signing secrets were present.
 *
 *   node scripts/verify-signing.mjs <win|mac|linux> <installer> [--expect signed|unsigned] [--expect-notarized]
 *
 * Prints one JSON line {platform, file, status, notarized, detail}:
 *   status "signed"    the platform's own tool accepted the signature
 *   status "unsigned"  no signature at all
 *   status "invalid"   a signature exists but does not verify (tampered, expired, untrusted chain)
 * Exit code 1 when an --expect is not met, or the status is "invalid". Without --expect it only reports.
 *
 * Windows uses Get-AuthenticodeSignature; macOS mounts the dmg and uses codesign, spctl and stapler;
 * Linux AppImages are never signed. Nothing here reads credentials.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Maps Get-AuthenticodeSignature's Status to our vocabulary. */
export function interpretAuthenticode(status) {
  const s = String(status).trim();
  if (s === 'Valid') return { status: 'signed', detail: 'Authenticode signature is valid' };
  if (s === 'NotSigned') return { status: 'unsigned', detail: 'no Authenticode signature' };
  return { status: 'invalid', detail: `Authenticode status: ${s || 'unknown'}` };
}

/**
 * Classifies a failed `codesign --verify`. No signature, or only an ad-hoc one (no certificate identity, which is
 * what an unsigned Electron build has on macOS), counts as unsigned; anything else is a genuinely broken signature.
 */
export function interpretCodesignFailure(verifyOutput, displayOutput = '') {
  const detail = String(verifyOutput).split('\n')[0] || 'codesign failed';
  if (/not signed at all/i.test(verifyOutput)) return { status: 'unsigned', detail };
  const adhoc = /Signature=adhoc/i.test(displayOutput) || /flags=0x[0-9a-f]+\([^)]*adhoc/i.test(displayOutput);
  if (adhoc) return { status: 'unsigned', detail: `ad-hoc signature only, no Developer ID (${detail})` };
  return { status: 'invalid', detail };
}

// Returns stdout and stderr together on success too: `codesign -d` reports only on stderr.
function run(file, args) {
  const r = spawnSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.error) return { ok: false, out: `${out}${r.error.message}`.trim() };
  return { ok: r.status === 0, out };
}

function verifyWindows(file) {
  const ps = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}').Status`]);
  if (!ps.ok) return { status: 'invalid', notarized: false, detail: `could not run Get-AuthenticodeSignature: ${ps.out}` };
  return { ...interpretAuthenticode(ps.out), notarized: false };
}

function verifyMac(file) {
  const mount = mkdtempSync(join(tmpdir(), 'tt-dmg-'));
  const attach = run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, file]);
  if (!attach.ok) return { status: 'invalid', notarized: false, detail: `could not mount the dmg: ${attach.out}` };
  try {
    const app = readdirSync(mount).find((n) => n.endsWith('.app'));
    if (!app) return { status: 'invalid', notarized: false, detail: 'no .app inside the dmg' };
    const appPath = join(mount, app);
    const sig = run('codesign', ['--verify', '--deep', '--strict', appPath]);
    if (!sig.ok) {
      // Electron's arm64 binaries carry an ad-hoc signature that repackaging invalidates; `codesign --verify` then
      // fails even though there is no real (Developer ID) signature to speak of.
      const info = run('codesign', ['-dvv', appPath]);
      return { ...interpretCodesignFailure(sig.out, info.out), notarized: false };
    }
    const gatekeeper = run('spctl', ['--assess', '--type', 'execute', appPath]);
    const stapled = run('xcrun', ['stapler', 'validate', appPath]);
    const notarized = gatekeeper.ok && stapled.ok;
    return {
      status: 'signed',
      notarized,
      detail: notarized ? 'signed, accepted by Gatekeeper, notarization ticket stapled' : 'signed, but not notarized (Gatekeeper or stapler did not accept it)',
    };
  } finally {
    run('hdiutil', ['detach', '-force', mount]);
  }
}

export function verifySigning(platform, file) {
  if (platform === 'win') return verifyWindows(file);
  if (platform === 'mac') return verifyMac(file);
  if (platform === 'linux') return { status: 'unsigned', notarized: false, detail: 'AppImages are not signed' };
  throw new Error(`unknown platform "${platform}" (expected win, mac or linux)`);
}

/** Problems with a result against what the caller expects; empty = fine. */
export function checkExpectation(result, { expect, expectNotarized }) {
  const problems = [];
  if (result.status === 'invalid') problems.push(`signature does not verify: ${result.detail}`);
  if (expect && result.status !== expect) problems.push(`expected the installer to be ${expect}, but it is ${result.status} (${result.detail})`);
  if (expectNotarized && !result.notarized) problems.push(`expected a notarized build: ${result.detail}`);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const [platform, file] = args.filter((a, i) => !a.startsWith('--') && !['--expect'].includes(args[i - 1]));
  if (!platform || !file) {
    console.error('usage: verify-signing.mjs <win|mac|linux> <installer> [--expect signed|unsigned] [--expect-notarized]');
    process.exit(2);
  }
  const result = verifySigning(platform, resolve(file));
  console.log(JSON.stringify({ platform, file, ...result }));
  const problems = checkExpectation(result, { expect: option('--expect'), expectNotarized: args.includes('--expect-notarized') });
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(problems.length ? 1 : 0);
}
