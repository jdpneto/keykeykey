import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Search and Filter', () => {
  test.beforeEach(async ({ popup }) => {
    await setupAndUnlock(popup);

    // Add a few items
    for (const name of ['GitHub', 'Google', 'Netflix']) {
      await popup.getByLabel('Add item').click();
      await popup.getByPlaceholder('Item name').fill(name);
      await popup.getByPlaceholder('user@example.com').fill(`user@${name.toLowerCase()}.com`);
      await popup.getByPlaceholder('Password').fill('pass123');
      await popup.getByRole('button', { name: /^save$/i }).click();
      await popup.waitForTimeout(500);
    }
  });

  test('should filter items by search query @crud', async ({ popup }) => {
    // Search input has placeholder "Search vault…"
    await popup.getByPlaceholder(/search vault/i).fill('Git');

    // Should show GitHub, hide others — use exact match to avoid username substring matches
    await expect(popup.getByText('GitHub', { exact: true }).first()).toBeVisible();
    await expect(popup.getByText('Netflix', { exact: true }).first()).not.toBeVisible();
  });

  test('should show all items when search is cleared @crud', async ({ popup }) => {
    await popup.getByPlaceholder(/search vault/i).fill('Git');
    await popup.getByPlaceholder(/search vault/i).clear();

    // All items visible — use exact match to avoid username substring matches
    await expect(popup.getByText('GitHub', { exact: true }).first()).toBeVisible();
    await expect(popup.getByText('Google', { exact: true }).first()).toBeVisible();
    await expect(popup.getByText('Netflix', { exact: true }).first()).toBeVisible();
  });
});
