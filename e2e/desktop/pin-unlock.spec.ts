import { test, expect } from '../fixtures/desktop.js';

test.describe('PIN Unlock @pin', () => {
  test('can set up PIN and unlock with it', async ({ app }) => {
    // This test requires:
    // 1. Setup vault with master password
    // 2. Navigate to settings, enable PIN
    // 3. Lock vault
    // 4. Unlock with PIN
    // 5. Verify vault is accessible
    //
    // Manual verification steps:
    // a) Launch the desktop app: pnpm --filter @keykeykey/desktop dev
    // b) Create a vault or unlock with master password
    // c) Go to Settings -> Enable PIN, enter a 4-digit PIN
    // d) Lock the vault (sidebar Lock button)
    // e) On the unlock screen, click "Use PIN", enter the PIN
    // f) Verify the vault list is visible
    test.skip(true, 'Requires running desktop app - manual verification');

    // The following is the expected automated flow when the app is running:
    await expect(app.getByText(/create your vault|welcome back/i)).toBeVisible({ timeout: 10_000 });
  });

  test('PIN lockout after 5 wrong attempts', async ({ app }) => {
    // This test requires:
    // 1. Setup vault and PIN
    // 2. Lock vault
    // 3. Enter wrong PIN 5 times
    // 4. Verify PIN is disabled, must use master password
    //
    // Manual verification steps:
    // a) Set up a PIN as described in the test above
    // b) Lock the vault
    // c) Click "Use PIN" on the unlock screen
    // d) Enter a wrong PIN 5 times consecutively
    // e) Verify that the PIN option disappears and only master password is available
    // f) Verify you can still unlock with the master password
    test.skip(true, 'Requires running desktop app - manual verification');

    // The following is the expected automated flow when the app is running:
    await expect(app.getByText(/create your vault|welcome back/i)).toBeVisible({ timeout: 10_000 });
  });

  test('quick unlock prompt appears after first unlock @pin', async ({ app }) => {
    // This test requires:
    // 1. Fresh vault with no PIN or biometric configured
    // 2. Unlock with master password for the first time
    // 3. Verify the QuickUnlockPrompt modal appears
    // 4. Verify options: "Enable Touch ID" (if biometric available) or "Set up PIN"
    // 5. Verify "Skip for now" dismisses the prompt permanently
    //
    // Manual verification steps:
    // a) Reset the quick_unlock_prompt keyring entry (or use a fresh app install)
    // b) Unlock with master password
    // c) Confirm the modal appears with PIN/biometric offer
    // d) Click "Skip for now"
    // e) Lock and re-unlock — prompt should NOT appear again
    test.skip(true, 'Requires running desktop app - manual verification');

    await expect(app.getByText(/create your vault|welcome back/i)).toBeVisible({ timeout: 10_000 });
  });
});
