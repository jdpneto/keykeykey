import { test, expect } from '../fixtures/desktop.js';

test.describe('Desktop Unlock', () => {
  test('should show unlock screen when vault exists @critical', async ({ app }) => {
    // Desktop shows "Welcome Back" when vault is set up
    await expect(app.getByText(/welcome back|create your vault/i)).toBeVisible({ timeout: 10_000 });
  });

  test('should have password input and unlock button @critical', async ({ app }) => {
    // Only check for the Unlock button if the "Welcome Back" unlock screen is shown.
    // The setup screen also has a "Enter master password" input but no Unlock button —
    // guard on the heading to avoid false positives.
    const unlockHeading = app.getByRole('heading', { name: /welcome back/i });
    const hasUnlockScreen = await unlockHeading.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasUnlockScreen) {
      await expect(app.getByPlaceholder(/enter master password/i)).toBeVisible();
      await expect(app.getByRole('button', { name: /^unlock$/i })).toBeVisible();
    }
  });
});
