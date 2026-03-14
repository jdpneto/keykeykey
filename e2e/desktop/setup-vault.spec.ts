import { test, expect } from '../fixtures/desktop.js';

test.describe('Desktop Setup Vault', () => {
  test('should show setup screen on first launch @critical', async ({ app }) => {
    await expect(app.getByText(/create|setup|master password/i)).toBeVisible({ timeout: 10_000 });
  });

  test('should create a vault @critical', async ({ app }) => {
    // Fill password
    await app
      .getByPlaceholder(/master password/i)
      .first()
      .fill('TestPassword123!');
    await app.getByPlaceholder(/confirm/i).fill('TestPassword123!');
    await app.getByRole('button', { name: /create vault/i }).click();

    // Recovery key
    await expect(app.getByText(/recovery key/i)).toBeVisible({ timeout: 30_000 });
    await app.getByRole('checkbox').check();
    await app.getByRole('button', { name: /continue/i }).click();

    // Vault list
    await expect(app.getByText(/vault/i)).toBeVisible({ timeout: 5_000 });
  });
});
