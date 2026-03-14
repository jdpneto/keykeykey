import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'extension',
      testDir: './extension',
    },
    {
      name: 'desktop',
      testDir: './desktop',
      timeout: 60_000,
    },
  ],
});
