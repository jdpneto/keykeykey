import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60_000, // 60s — Argon2id setup takes time
  workers: 1, // Extension tests must run serially (each launches its own browser)
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
    // Firefox extension coverage is driven by Selenium + geckodriver
    // (`cd e2e && npm run test:firefox`) — Playwright's bundled Firefox
    // silently skips profile-scope addon scanning and stock Dev Edition
    // lacks the juggler patches Playwright speaks. Tests live in
    // `extension-firefox/` and are configured via `extension-firefox/vitest.config.ts`.
    {
      name: 'desktop',
      testDir: './desktop',
      timeout: 60_000,
    },
  ],
});
