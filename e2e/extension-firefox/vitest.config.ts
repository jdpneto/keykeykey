import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.firefox.spec.ts'],
    // Each spec launches its own Firefox instance — serialize to avoid
    // contention over geckodriver ports and extension UUID conflicts.
    fileParallelism: false,
    // Selenium-WebDriver calls over HTTP are slow; Argon2 setup is slower
    // still. Give each test 90s to finish.
    testTimeout: 90_000,
    hookTimeout: 30_000,
    reporters: 'default',
    // Selenium + geckodriver occasionally whiffs on the first driver handshake
    // (port contention, slow Dev Edition cold-start) — a handful of retries
    // swallows the flake without masking real regressions. Mirrors the
    // Playwright config's `retries: process.env.CI ? 2 : 0` posture.
    retry: process.env.CI ? 2 : 1,
  },
});
