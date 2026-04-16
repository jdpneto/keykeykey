/**
 * Firefox port of `e2e/extension/unlock.spec.ts`: happy-path lock/unlock
 * round-trip and wrong-password error surfacing.
 */
import { afterEach, beforeEach, describe, test } from 'vitest';
import { By, until } from 'selenium-webdriver';
import { startDriver, type DriverHandle } from './fixtures/driver.js';
import {
  clickButton,
  createVault,
  fillByPlaceholder,
  openPopup,
  openSettings,
  waitForText,
} from './fixtures/flow.js';

const MASTER = 'TestPassword123!';

let handle: DriverHandle | null = null;

beforeEach(async () => {
  handle = await startDriver();
  await openPopup(handle.driver);
});

afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

describe('Unlock Vault (Firefox)', () => {
  test('should lock and unlock with correct password', async () => {
    const driver = handle!.driver;
    await createVault(driver, MASTER);
    await openSettings(driver);
    await clickButton(driver, 'lock vault');
    await driver.wait(
      until.elementLocated(By.css('input[placeholder*="master password" i]')),
      10_000,
    );
    await fillByPlaceholder(driver, 'master password', MASTER);
    await clickButton(driver, 'unlock');
    // Vault list header always shows the product name.
    await waitForText(driver, 'keykeykey', 20_000);
  });

  test('should show error for wrong password', async () => {
    const driver = handle!.driver;
    await createVault(driver, MASTER);
    await openSettings(driver);
    await clickButton(driver, 'lock vault');
    await driver.wait(
      until.elementLocated(By.css('input[placeholder*="master password" i]')),
      10_000,
    );
    await fillByPlaceholder(driver, 'master password', 'WrongPassword!');
    await clickButton(driver, 'unlock');
    // UNLOCK handler returns "Incorrect master password." on bad creds
    // (see apps/extension/src/background/handlers/vault.ts).
    await waitForText(driver, 'incorrect master password', 15_000);
  });
});
