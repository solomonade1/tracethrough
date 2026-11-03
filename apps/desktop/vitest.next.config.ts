import { defineConfig } from 'vitest/config';

// Drives the built app against the real Next.js sample (`pnpm test:e2e:next`); slower, so kept separate.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['test/**/*.next-e2e.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
