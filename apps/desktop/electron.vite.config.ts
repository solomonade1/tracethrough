import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

/** Strict CSP for production builds only; Vite's dev server needs inline scripts for React refresh. */
const productionCsp = (): Plugin => ({
  name: 'tracelens-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'">`,
    ),
});

// Workspace packages ship TypeScript source, so they are bundled rather than externalized.
const bundleWorkspace = { exclude: ['@tracelens/core', '@tracelens/capture'] };

export default defineConfig({
  main: {
    build: { externalizeDeps: bundleWorkspace },
  },
  preload: {
    // Sandboxed renderers can only load CommonJS preloads.
    build: {
      externalizeDeps: bundleWorkspace,
      rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    plugins: [react(), productionCsp()],
  },
});
