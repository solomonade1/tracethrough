import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Local web mode UI: the desktop renderer plus an HTTP implementation of `window.tracelens`.
// The CSP is sent as a header by the web server (src/web/server.ts), so no meta tag is injected here.
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/web'),
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, 'out/web'),
    emptyOutDir: true,
  },
});
