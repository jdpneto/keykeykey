/**
 * Firefox-side canary of the Chromium `setup-vault.spec.ts` suite. If this
 * runs green, the Selenium harness is sound.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { By, until } from 'selenium-webdriver';
import { startDriver, type DriverHandle } from './fixtures/driver.js';
import { clickButton, fillByPlaceholder, openPopup } from './fixtures/flow.js';

let handle: DriverHandle | null = null;

beforeEach(async () => {
  handle = await startDriver();
  await openPopup(handle.driver);
});

afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

describe('Setup Vault (Firefox)', () => {
  test('should create a vault and show recovery key', async () => {
    const driver = handle!.driver;
    await fillByPlaceholder(driver, 'at least 8 characters', 'test1234');
    await fillByPlaceholder(driver, 'repeat', 'test1234');
    await clickButton(driver, 'create vault');
    // Heavy Argon2 preset — give the recovery-key screen plenty of time.
    await driver.wait(until.elementLocated(By.xpath('//*[contains(., "Recovery Key")]')), 45_000);
  });

  test('should require minimum password length', async () => {
    const driver = handle!.driver;
    await fillByPlaceholder(driver, 'at least 8 characters', 'short');
    await fillByPlaceholder(driver, 'repeat', 'short');
    await clickButton(driver, 'create vault');
    // Setup screen silently rejects <8 chars (known quirk in base-test-flow.md
    // §Known issues). Assert we're still on the setup screen.
    await driver.sleep(500);
    const stillOnSetup = await driver
      .findElement(By.css('input[placeholder*="at least 8 characters" i]'))
      .isDisplayed();
    expect(stillOnSetup).toBe(true);
  });

  test('should require passwords to match', async () => {
    const driver = handle!.driver;
    await fillByPlaceholder(driver, 'at least 8 characters', 'test1234');
    await fillByPlaceholder(driver, 'repeat', 'different');
    await clickButton(driver, 'create vault');
    await driver.wait(until.elementLocated(By.xpath('//*[contains(., "do not match")]')), 5_000);
  });
});
