import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Per-package module cache. The default (<workspace root>/node_modules/.vitest-cache)
    // is shared, and after a lockfile change every package that turbo runs in
    // parallel clears it at once (`rm -r` races: ENOTEMPTY at startup).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    globals: true,
    environment: 'jsdom',
    // See `apps/extension/vitest.config.ts` for the rationale on `pool: 'forks'`.
    pool: 'forks',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/index.ts', 'src/test-setup.ts'],
    },
  },
});
