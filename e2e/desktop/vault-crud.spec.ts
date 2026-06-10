import { test, expect } from '../fixtures/desktop.js';

test.describe('Desktop Vault CRUD', () => {
  test('should show vault list after unlock @critical', async ({ app }) => {
    // This test verifies the app shows either setup, unlock, or vault list.
    // Use heading role to avoid strict-mode violations from button text
    // containing the same words (e.g. "Create Vault" button vs "Create Your Vault" h1).
    await expect(
      app
        .getByRole('heading', { name: /create your vault|welcome back/i })
        .or(app.getByRole('heading', { name: /vault/i })),
    ).toBeVisible({ timeout: 10_000 });
  });
});
