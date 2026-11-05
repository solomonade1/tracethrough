// Packaging config for electron-builder (`pnpm package:win`). CommonJS so electron-builder can load it directly.
const fs = require('node:fs');
const path = require('node:path');

const electronPkg = require.resolve('electron/package.json');
// Electron downloads its binary lazily, on the first `require('electron')`, not on install. A fresh checkout
// (like the release workflow) has no dist/ yet, so only reuse it when it exists; otherwise electron-builder
// downloads and checksum-verifies the Electron build for the target platform itself.
const localElectronDist = path.join(path.dirname(electronPkg), 'dist');

/** @type {import('electron-builder').Configuration} */
module.exports = {
  // Product name chosen 3 Nov 2026; trademark search still pending (plan §2.8).
  appId: 'dev.tracethrough.desktop',
  productName: 'TraceThrough',
  copyright: 'Copyright © 2026 TraceThrough',
  directories: { output: 'release', buildResources: 'build' },
  // out/web is the local web mode UI (pnpm web), not part of the desktop app.
  files: ['out/**', '!out/web/**', 'package.json'],
  // Playwright launches browser processes and reads its own files at runtime; keep it outside the asar.
  asarUnpack: ['node_modules/playwright/**', 'node_modules/playwright-core/**'],
  // Reuse the Electron binary already installed (and checksum-verified) instead of downloading it again.
  electronDist: fs.existsSync(localElectronDist) ? localElectronDist : undefined,
  electronVersion: require(electronPkg).version,
  // No native modules to rebuild.
  npmRebuild: false,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: '${productName}-Setup-${version}-${arch}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: 'TraceThrough',
    // Keep the collector token and settings if the app is reinstalled.
    deleteAppDataOnUninstall: false,
  },
  mac: {
    target: ['dmg'],
    category: 'public.app-category.developer-tools',
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
  },
  linux: {
    target: ['AppImage'],
    category: 'Development',
    // Defaults to the package name, and the "@" and "/" in "@tracethrough/desktop" are not valid in a file name.
    executableName: 'tracethrough',
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
  },
};
