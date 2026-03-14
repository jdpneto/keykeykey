import { test, expect } from '../fixtures/extension.js';

test.describe('Setup Vault', () => {
  test('should create a vault and show recovery key @critical', async ({ popup }) => {
    // Should start on setup screen
    await expect(popup.getByText(/create your vault/i)).toBeVisible({ timeout: 15_000 });

    // Fill password fields
    await popup.getByPlaceholder(/at least 8 characters/i).fill('TestPassword123!');
    await popup.getByPlaceholder(/repeat your password/i).fill('TestPassword123!');

    // Create vault
    await popup.getByRole('button', { name: /create vault/i }).click();

    // Should show recovery key screen (Argon2id takes a few seconds)
    await expect(
      popup.getByRole('heading', { name: /save your recovery key/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Check the confirmation checkbox and continue
    await popup.getByRole('checkbox').check();
    await popup.getByRole('button', { name: /continue/i }).click();

    // Should land on vault list (empty state)
    await expect(popup.getByText(/no items/i)).toBeVisible({ timeout: 5_000 });
  });

  test('should require minimum password length @critical', async ({ popup }) => {
    await expect(popup.getByText(/create your vault/i)).toBeVisible({ timeout: 15_000 });
    await popup.getByPlaceholder(/at least 8 characters/i).fill('short');
    await popup.getByPlaceholder(/repeat your password/i).fill('short');

    // Click create vault — should show error or stay on screen
    await popup.getByRole('button', { name: /create vault/i }).click();

    // Should still be on setup screen (vault not created)
    await expect(popup.getByText(/create your vault/i)).toBeVisible();
  });

  test('should require passwords to match @critical', async ({ popup }) => {
    await expect(popup.getByText(/create your vault/i)).toBeVisible({ timeout: 15_000 });
    await popup.getByPlaceholder(/at least 8 characters/i).fill('TestPassword123!');
    await popup.getByPlaceholder(/repeat your password/i).fill('DifferentPassword!');

    // Click create vault — should show error or stay on screen
    await popup.getByRole('button', { name: /create vault/i }).click();

    // Should still be on setup screen
    await expect(popup.getByText(/create your vault/i)).toBeVisible();
  });
});
