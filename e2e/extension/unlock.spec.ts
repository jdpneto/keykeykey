import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Unlock Vault', () => {
  test('should lock and unlock with correct password @critical', async ({ popup }) => {
    await setupAndUnlock(popup);

    // Lock via settings — the settings button has aria-label="Settings"
    await popup.getByLabel('Settings').click();
    await popup.getByRole('button', { name: /lock vault/i }).click();

    // Should show unlock screen
    await expect(popup.getByPlaceholder(/master password/i)).toBeVisible({ timeout: 10_000 });

    // Unlock
    await popup.getByPlaceholder(/master password/i).fill('TestPassword123!');
    await popup.getByRole('button', { name: /unlock/i }).click();

    // Should return to vault list — the list header always shows "KeyKeyKey"
    await expect(popup.getByText('KeyKeyKey')).toBeVisible({ timeout: 20_000 });
  });

  test('should show error for wrong password @critical', async ({ popup }) => {
    await setupAndUnlock(popup);

    // Lock
    await popup.getByLabel('Settings').click();
    await popup.getByRole('button', { name: /lock vault/i }).click();

    // Wait for unlock screen
    await expect(popup.getByPlaceholder(/master password/i)).toBeVisible({ timeout: 10_000 });

    // Try wrong password
    await popup.getByPlaceholder(/master password/i).fill('WrongPassword!');
    await popup.getByRole('button', { name: /unlock/i }).click();

    // Should show error
    await expect(
      popup
        .locator('div')
        .filter({ hasText: /unlock failed|invalid|incorrect|wrong/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
