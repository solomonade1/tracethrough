import { defineConfig } from 'vitest/config';

// Runs the sample apps under real `next dev` / `next start` for each documented Next.js version
// (`pnpm test:next-matrix`). Slow, so kept out of `pnpm test`; set NEXT_MATRIX=15:dev to run one cell.
export default defineConfig({
  test: {
    include: ['packages/next/test/**/*.next-matrix.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
