import { test as base, type Page } from '@playwright/test';

const DESKTOP_URL = process.env.DESKTOP_URL ?? 'http://localhost:1420';

/**
 * Custom Playwright fixture for the desktop app.
 * Connects to the Vite dev server running the React frontend.
 *
 * Start the dev server before running: pnpm --filter @keykeykey/desktop dev
 */
export const test = base.extend<{
  app: Page;
}>({
  app: async ({ page }, use) => {
    await page.goto(DESKTOP_URL);
    await page.waitForLoadState('networkidle');
    await use(page);
  },
});

export { expect } from '@playwright/test';
