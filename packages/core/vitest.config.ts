import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Per-package module cache. The default (<workspace root>/node_modules/.vitest-cache)
    // is shared, and after a lockfile change every package that turbo runs in
    // parallel clears it at once (`rm -r` races: ENOTEMPTY at startup).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    globals: true,
    environment: 'node',
    // Match the other workspaces — use forks instead of the default
    // threads pool. See `apps/extension/vitest.config.ts` for the
    // rationale (worker_threads RPC ceiling on large suites).
    pool: 'forks',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec,bench}.ts', 'src/**/index.ts', 'src/**/generate-*.ts'],
      thresholds: {
        // Enforce 100% statement coverage on crypto modules
        'src/crypto/**': {
          statements: 100,
          branches: 90,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
