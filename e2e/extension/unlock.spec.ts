import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Unlock Vault', () => {
  test('should lock and unlock with correct password @critical', async ({ popup }) => {
    await setupAndUnlock(popup);

    // Lock via settings or lock button
    await popup.getByRole('button', { name: /settings|⚙/i }).click();
    await popup.getByRole('button', { name: /lock vault/i }).click();

    // Should show unlock screen
    await expect(popup.getByPlaceholder(/master password/i)).toBeVisible();

    // Unlock
    await popup.getByPlaceholder(/master password/i).fill('TestPassword123!');
    await popup.getByRole('button', { name: /unlock/i }).click();

    // Should return to vault list
    await expect(popup.getByText(/no items|vault/i)).toBeVisible({ timeout: 15_000 });
  });

  test('should show error for wrong password @critical', async ({ popup }) => {
    await setupAndUnlock(popup);

    // Lock
    await popup.getByRole('button', { name: /settings|⚙/i }).click();
    await popup.getByRole('button', { name: /lock vault/i }).click();

    // Try wrong password
    await popup.getByPlaceholder(/master password/i).fill('WrongPassword!');
    await popup.getByRole('button', { name: /unlock/i }).click();

    // Should show error
    await expect(popup.getByText(/error|failed|incorrect/i)).toBeVisible({ timeout: 15_000 });
  });
});
