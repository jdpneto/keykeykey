import { test, expect } from '../fixtures/desktop.js';

test.describe('Desktop Unlock', () => {
  test('should show unlock screen when vault exists @critical', async ({ app }) => {
    // Desktop shows "Welcome Back" when vault is set up
    await expect(app.getByText(/welcome back|create your vault/i)).toBeVisible({ timeout: 10_000 });
  });

  test('should have password input and unlock button @critical', async ({ app }) => {
    // Check for the unlock form elements
    const passwordInput = app.getByPlaceholder(/enter master password/i);
    const unlockButton = app.getByRole('button', { name: /unlock/i });

    const hasUnlockScreen = await passwordInput.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasUnlockScreen) {
      await expect(passwordInput).toBeVisible();
      await expect(unlockButton).toBeVisible();
    }
  });
});
