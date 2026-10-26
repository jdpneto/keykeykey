import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Per-package module cache. The default (<workspace root>/node_modules/.vitest-cache)
    // is shared, and after a lockfile change every package that turbo runs in
    // parallel clears it at once (`rm -r` races: ENOTEMPTY at startup).
    fsModuleCachePath: 'node_modules/.vitest-cache',
    globals: true,
    environment: 'jsdom',
    // See `apps/extension/vitest.config.ts` for the rationale on `pool: 'forks'`.
    pool: 'forks',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  },
});
