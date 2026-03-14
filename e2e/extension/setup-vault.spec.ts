import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Setup Vault', () => {
  test('should create a vault and show recovery key @critical', async ({ popup }) => {
    await expect(popup.getByText(/create new vault/i)).toBeVisible();

    await popup.getByPlaceholder(/master password/i).first().fill('TestPassword123!');
    await popup.getByPlaceholder(/confirm/i).fill('TestPassword123!');
    await popup.getByRole('button', { name: /create vault/i }).click();

    // Recovery key screen (Argon2id takes a few seconds)
    await expect(popup.getByText(/recovery key/i)).toBeVisible({ timeout: 30_000 });
    await popup.getByRole('checkbox').check();
    await popup.getByRole('button', { name: /continue/i }).click();

    // Vault list (empty state)
    await expect(popup.getByText(/no items/i)).toBeVisible({ timeout: 5_000 });
  });

  test('should validate password length @critical', async ({ popup }) => {
    await popup.getByPlaceholder(/master password/i).first().fill('short');
    await popup.getByPlaceholder(/confirm/i).fill('short');

    const createButton = popup.getByRole('button', { name: /create vault/i });
    await expect(createButton).toBeDisabled();
  });

  test('should validate passwords match @critical', async ({ popup }) => {
    await popup.getByPlaceholder(/master password/i).first().fill('TestPassword123!');
    await popup.getByPlaceholder(/confirm/i).fill('DifferentPassword!');

    const createButton = popup.getByRole('button', { name: /create vault/i });
    await expect(createButton).toBeDisabled();
  });
});
