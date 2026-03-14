import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Search and Filter', () => {
  test.beforeEach(async ({ popup }) => {
    await setupAndUnlock(popup);

    // Add a few items
    for (const name of ['GitHub', 'Google', 'Netflix']) {
      await popup.getByRole('button', { name: /\+|add/i }).click();
      await popup.getByPlaceholder(/name/i).first().fill(name);
      await popup.getByPlaceholder(/username/i).fill(`user@${name.toLowerCase()}.com`);
      await popup.getByPlaceholder(/password/i).first().fill('pass123');
      await popup.getByRole('button', { name: /save/i }).click();
      await popup.waitForTimeout(500);
    }
  });

  test('should filter items by search query @crud', async ({ popup }) => {
    await popup.getByPlaceholder(/search/i).fill('Git');

    // Should show GitHub, hide others
    await expect(popup.getByText('GitHub')).toBeVisible();
    await expect(popup.getByText('Netflix')).not.toBeVisible();
  });

  test('should show all items when search is cleared @crud', async ({ popup }) => {
    await popup.getByPlaceholder(/search/i).fill('Git');
    await popup.getByPlaceholder(/search/i).clear();

    // All items visible
    await expect(popup.getByText('GitHub')).toBeVisible();
    await expect(popup.getByText('Google')).toBeVisible();
    await expect(popup.getByText('Netflix')).toBeVisible();
  });
});
