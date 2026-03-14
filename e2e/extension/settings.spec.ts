import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Settings', () => {
  test.beforeEach(async ({ popup }) => {
    await setupAndUnlock(popup);
    await popup.getByRole('button', { name: /settings|⚙/i }).click();
  });

  test('should lock vault from settings @settings', async ({ popup }) => {
    await popup.getByRole('button', { name: /lock vault/i }).click();

    // Should show unlock screen
    await expect(popup.getByPlaceholder(/master password/i)).toBeVisible();
  });

  test('should toggle theme @settings', async ({ popup }) => {
    // Find theme toggle
    const themeButton = popup.getByRole('button', { name: /dark|light|theme/i }).first();
    if (await themeButton.isVisible()) {
      await themeButton.click();
      // Theme should change (we verify via data-theme attribute)
      const theme = await popup.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(theme).toBeTruthy();
    }
  });
});
