import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // Use the forks pool (child processes) instead of the default threads
    // pool. The threads pool's worker→main RPC ("Timeout calling
    // onTaskUpdate") starts timing out at suite teardown once the
    // extension test count crosses ~225 in CI. The forks pool uses a
    // different RPC mechanism that doesn't hit this ceiling. Trade-off:
    // ~10–15% slower per-file startup, much more headroom for growth.
    pool: 'forks',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  },
});
