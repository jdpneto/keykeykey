import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../apps/extension/dist');

/**
 * Custom Playwright fixture that loads the KeyKeyKey extension in Chromium
 * and provides a `popup` page navigated to the extension popup URL.
 */
export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  popup: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
        '--enable-unsafe-extension-debugging',
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await Promise.race([
        context.waitForEvent('serviceworker'),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'Extension service worker did not load within 15s. ' +
                    'Check that apps/extension/dist/manifest.json exists and is valid.',
                ),
              ),
            15_000,
          ),
        ),
      ]);
    }
    const extensionId = serviceWorker.url().split('/')[2]!;
    await use(extensionId);
  },
  popup: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    // Wait for React to render — the app renders text once mounted
    await page.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, {
      timeout: 15_000,
    });
    await use(page);
    await page.close();
  },
});

import { expect } from '@playwright/test';
export { expect };

/**
 * Helper: create a vault and get to the unlocked list screen.
 * Reused across test files that need a pre-setup vault.
 */
export async function setupAndUnlock(popup: Page, password = 'TestPassword123!'): Promise<void> {
  // Wait for setup screen to render
  await popup.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, {
    timeout: 15_000,
  });

  // Fill setup form
  await popup.getByPlaceholder(/at least 8 characters/i).fill(password);
  await popup.getByPlaceholder(/repeat your password/i).fill(password);
  await popup.getByRole('button', { name: /create vault/i }).click();

  // Wait for recovery key screen (Argon2id is slow)
  await expect(popup.getByRole('heading', { name: /recovery key/i })).toBeVisible({
    timeout: 30_000,
  });

  // Confirm and continue
  await popup.getByRole('checkbox').check();
  await popup.getByRole('button', { name: /continue/i }).click();

  // Wait for vault list
  await expect(popup.getByText(/no items/i)).toBeVisible({ timeout: 5_000 });
}
