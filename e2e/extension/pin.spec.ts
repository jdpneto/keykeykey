/**
 * PIN unlock coverage. Covers:
 *
 *   1. Set a PIN from Settings, lock the vault, unlock with the PIN.
 *   2. Wrong-PIN attempt counter (SET_PIN handler seeds 5 attempts;
 *      UNLOCK_PIN decrements and surfaces `attemptsRemaining`).
 *
 * UnlockScreen instantiates PinPad without a `maxLength` prop → default is
 * 6, so the test uses a 6-digit PIN even though the Settings form accepts
 * any >= 4.
 */
import { test, expect } from '../fixtures/extension.js';
import type { Page } from '@playwright/test';

const MASTER = 'test1234';
const PIN = '135790';
const WRONG_PIN = '000000';

async function createVault(popup: Page, password: string): Promise<void> {
  await popup.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, {
    timeout: 15_000,
  });
  await popup.getByPlaceholder(/at least 8 characters/i).fill(password);
  await popup.getByPlaceholder(/repeat your password/i).fill(password);
  await popup.getByRole('button', { name: /create vault/i }).click();
  await expect(popup.getByRole('heading', { name: /recovery key/i })).toBeVisible({
    timeout: 30_000,
  });
  await popup.getByRole('checkbox').check();
  await popup.getByRole('button', { name: /continue/i }).click();
  await expect(popup.getByText(/no items/i)).toBeVisible({ timeout: 5_000 });
}

async function enterPin(popup: Page, pin: string): Promise<void> {
  // PinPad auto-submits once `pin.length >= maxLength`, so clicking the last
  // digit fires the UNLOCK_PIN message — no submit button to press.
  for (const ch of pin) {
    await popup.getByRole('button', { name: ch, exact: true }).click();
  }
}

/**
 * The Settings screen's PIN form uses plain `<input>` elements (not
 * placeholder-tagged), so target by the nearby "New PIN" / "Confirm PIN"
 * labels. Both inputs have `inputMode="numeric"`; text type-in works.
 */
async function setPinFromSettings(popup: Page, pin: string): Promise<void> {
  await popup.getByLabel('Settings').click();
  await expect(popup.getByText('Security')).toBeVisible({ timeout: 5_000 });
  await popup.getByRole('button', { name: /^set pin$/i }).click();
  await popup.getByPlaceholder(/^enter pin$/i).fill(pin);
  await popup.getByPlaceholder(/^confirm pin$/i).fill(pin);
  // Inside the form, the "Set PIN" button is the submit action.
  await popup.getByRole('button', { name: /^set pin$/i }).click();
  // Form collapses on success — the "Set PIN" / "Change PIN" button reappears.
  await expect(popup.getByRole('button', { name: /change pin/i })).toBeVisible({
    timeout: 5_000,
  });
}

/**
 * A single test covers both the happy-path PIN unlock and the wrong-PIN
 * attempt counter because the extension fixture is per-test: splitting the
 * flow across two `test(...)` blocks would get a fresh Chromium context for
 * the second, losing the PIN configuration from the first.
 */
test('@critical PIN unlock — set, unlock, and wrong-PIN counter', async ({ popup }) => {
  await createVault(popup, MASTER);
  await setPinFromSettings(popup, PIN);

  // Close Settings, lock, toggle to PIN entry, submit the correct PIN.
  await popup.getByLabel('Back').click();
  await popup.getByLabel('Lock vault').click();
  await expect(popup.getByRole('heading', { name: /unlock vault/i })).toBeVisible({
    timeout: 5_000,
  });
  await popup.getByRole('button', { name: /use pin instead/i }).click();
  await enterPin(popup, PIN);
  await expect(popup.getByText(/no items/i)).toBeVisible({ timeout: 10_000 });

  // Lock again and submit a wrong PIN. SET_PIN seeds `attemptsRemaining=5`,
  // so UNLOCK_PIN should surface "4 attempts remaining" on the first miss.
  await popup.getByLabel('Lock vault').click();
  await expect(popup.getByRole('heading', { name: /unlock vault/i })).toBeVisible({
    timeout: 5_000,
  });
  await popup.getByRole('button', { name: /use pin instead/i }).click();
  await enterPin(popup, WRONG_PIN);
  await expect(popup.getByText(/wrong pin\.\s*4 attempts remaining/i)).toBeVisible({
    timeout: 5_000,
  });

  // Recover with the master password — proves PIN-locked vaults fall back
  // to the password path and the remaining-attempts state persists.
  await popup.getByRole('button', { name: /use master password instead/i }).click();
  await popup.getByPlaceholder(/master password/i).fill(MASTER);
  await popup.getByRole('button', { name: /^unlock$/i }).click();
  await expect(popup.getByText(/no items/i)).toBeVisible({ timeout: 10_000 });
});
