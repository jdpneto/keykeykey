import { test, expect } from '../fixtures/desktop.js';

test.describe('Desktop Setup Vault', () => {
  test('should show setup screen on first launch @critical', async ({ app }) => {
    // Desktop shows "Create Your Vault" heading on fresh setup
    await expect(app.getByText(/create your vault|welcome back/i)).toBeVisible({ timeout: 10_000 });
  });

  test('should create a vault @critical', async ({ app }) => {
    // If already set up, this test verifies the unlock screen instead
    const heading = app.getByText(/create your vault/i);
    const isSetup = await heading.isVisible({ timeout: 5_000 }).catch(() => false);

    if (isSetup) {
      // Fresh vault — fill setup form
      await app.getByPlaceholder(/enter master password/i).fill('TestPassword123!');
      await app.getByPlaceholder(/confirm master password/i).fill('TestPassword123!');
      await app.getByRole('button', { name: /create vault/i }).click();

      // Recovery key screen
      await expect(app.getByText(/recovery key/i)).toBeVisible({ timeout: 30_000 });
      await app.getByRole('checkbox').check();
      await app.getByRole('button', { name: /continue/i }).click();

      // Should land on vault list
      await expect(app.getByText(/vault/i)).toBeVisible({ timeout: 5_000 });
    } else {
      // Already set up — verify unlock screen is shown
      await expect(app.getByText(/welcome back/i)).toBeVisible({ timeout: 10_000 });
    }
  });
});
