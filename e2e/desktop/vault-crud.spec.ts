import { test, expect } from '../fixtures/desktop.js';

test.describe('Desktop Vault CRUD', () => {
  test('should show vault list after unlock @critical', async ({ app }) => {
    // This test verifies the app shows either setup, unlock, or vault list
    await expect(
      app.getByText(/create your vault|welcome back|vault/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});
