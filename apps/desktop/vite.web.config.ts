import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Local web mode UI: the desktop renderer plus an HTTP implementation of `window.tracethrough`.
// The CSP is sent as a header by the web server (src/web/server.ts), so no meta tag is injected here.
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/web'),
  // Favicons live with the desktop renderer so both builds ship the same files.
  publicDir: resolve(import.meta.dirname, 'src/renderer/public'),
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, 'out/web'),
    emptyOutDir: true,
  },
});
