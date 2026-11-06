import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'scripts/**/*.test.ts',
      'apps/desktop/test/web.test.ts',
      'apps/desktop/test/session-host.test.ts',
      'apps/desktop/test/validate.test.ts',
      'apps/desktop/test/rows.test.ts',
    ],
    // Real `next dev` / `next start` runs; slow, so they have their own config (`pnpm test:next-matrix`).
    exclude: [...configDefaults.exclude, '**/*.next-matrix.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Several files drive a real Chromium. Two browsers stopping at once can take over a minute on
    // Windows, so files run one after another (each file is still fast on its own).
    fileParallelism: false,
  },
});
