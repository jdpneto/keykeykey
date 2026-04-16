/**
 * Storage persistence end-to-end: close the popup page and reopen it to
 * prove the background service worker repopulates from `chrome.storage.local`
 * — the vault header lands on the Unlock screen (not Setup) and items
 * reappear after unlock.
 *
 * This doesn't force a hard service-worker restart; Chrome schedules those
 * on its own idle timer. What it does verify is the storage → background
 * state → UI round-trip on a cold popup, which is the path users actually
 * hit when they close and reopen the toolbar popup.
 */
import { test, expect } from '../fixtures/extension.js';
import type { Page } from '@playwright/test';

const MASTER = 'test1234';

async function createVault(popup: Page, password: string): Promise<void> {
  await popup.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, {
    timeout: 15_000,
  });
  await popup.getByPlaceholder(/at least 8 characters/i).fill(password);
  await popup.getByPlaceholder(/repeat your password/i).fill(password);
  await popup.getByRole('button', { name: /create vault/i }).click();
  await expect(popup.getByRole('heading', { name: /recovery key/i })).toBeVisible({
    timeout: 30_000,
  });
  await popup.getByRole('checkbox').check();
  await popup.getByRole('button', { name: /continue/i }).click();
  await expect(popup.getByText(/no items/i)).toBeVisible({ timeout: 5_000 });
}

async function addCredential(
  popup: Page,
  name: string,
  username: string,
  password: string,
): Promise<void> {
  await popup.getByLabel('Add item').click();
  await popup.getByPlaceholder('Item name').fill(name);
  await popup.getByPlaceholder('user@example.com').fill(username);
  await popup.getByPlaceholder('Password').fill(password);
  await popup.getByRole('button', { name: /^save$/i }).click();
  await expect(popup.getByText(name).first()).toBeVisible({ timeout: 10_000 });
}

test('@critical vault and items persist after popup is closed and reopened', async ({
  popup,
  context,
  extensionId,
}) => {
  // Set up a vault with one item, then lock it.
  await createVault(popup, MASTER);
  await addCredential(popup, 'PersistCheck', 'persist@example.com', 'persist-pass');
  await popup.getByLabel('Lock vault').click();
  await expect(popup.getByRole('heading', { name: /unlock vault/i })).toBeVisible({
    timeout: 5_000,
  });

  // Close the popup entirely and open a fresh page pointing at the same URL.
  // If storage persists, the fresh page should boot to Unlock (because the
  // vault header survives) instead of Setup.
  const popupUrl = popup.url();
  await popup.close();
  const popup2 = await context.newPage();
  await popup2.goto(popupUrl);
  await popup2.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, {
    timeout: 15_000,
  });
  await expect(popup2.getByRole('heading', { name: /unlock vault/i })).toBeVisible({
    timeout: 15_000,
  });

  // Unlock and confirm the item is still indexed.
  await popup2.getByPlaceholder(/master password/i).fill(MASTER);
  await popup2.getByRole('button', { name: /^unlock$/i }).click();
  await expect(popup2.getByText('PersistCheck')).toBeVisible({ timeout: 15_000 });

  // Silence unused-fixture warning for extensionId.
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});
