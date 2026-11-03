import { defineConfig } from 'vitest/config';

// End-to-end tests drive the built app (`pnpm test:e2e` builds first).
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['test/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
