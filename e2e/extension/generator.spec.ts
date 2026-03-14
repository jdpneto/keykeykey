import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Password Generator', () => {
  test.beforeEach(async ({ popup }) => {
    await setupAndUnlock(popup);
    // Navigate to generator — button has title="Password Generator"
    await popup.getByTitle('Password Generator').click();
  });

  test('should generate a random password @settings', async ({ popup }) => {
    // The generated password is displayed in a div with fontFamily: monospace
    // Wait for the heading to confirm we're on the generator screen
    await expect(popup.getByText('Password Generator')).toBeVisible({ timeout: 5_000 });

    // The generated password div has monospace font — locate it via style
    const passwordDisplay = popup.locator('[style*="monospace"]').first();
    await expect(passwordDisplay).toBeVisible({ timeout: 5_000 });

    const password = await passwordDisplay.textContent();
    expect(password).toBeTruthy();
    expect(password!.trim().length).toBeGreaterThanOrEqual(8);
  });

  test('should show entropy information @settings', async ({ popup }) => {
    // Generator screen shows "{n} bits" for entropy
    await expect(popup.getByText(/bits/i)).toBeVisible({ timeout: 5_000 });
  });
});
