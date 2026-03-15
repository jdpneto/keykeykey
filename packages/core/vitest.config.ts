import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
