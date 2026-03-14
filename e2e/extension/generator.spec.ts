import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Password Generator', () => {
  test.beforeEach(async ({ popup }) => {
    await setupAndUnlock(popup);
    // Navigate to generator
    await popup.getByRole('button', { name: /generator|🎲/i }).click();
  });

  test('should generate a random password @settings', async ({ popup }) => {
    // Should show a generated password
    const passwordDisplay = popup.locator('[style*="monospace"], code, pre').first();
    await expect(passwordDisplay).toBeVisible({ timeout: 5_000 });

    const password = await passwordDisplay.textContent();
    expect(password).toBeTruthy();
    expect(password!.length).toBeGreaterThanOrEqual(8);
  });

  test('should show entropy information @settings', async ({ popup }) => {
    await expect(popup.getByText(/entropy|bits|strength/i)).toBeVisible();
  });
});
