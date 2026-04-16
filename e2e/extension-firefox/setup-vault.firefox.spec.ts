/**
 * Firefox-side canary of the Chromium `setup-vault.spec.ts` suite. If this
 * runs green, the Phase A harness is sound and we can port the rest of
 * the @critical specs under it in Phase B.
 *
 * Parity with the Chromium `@critical` tests:
 *   - should create a vault and show recovery key
 *   - should require minimum password length (silent reject at <8 chars)
 *   - should require passwords to match
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { By, until, type WebDriver } from 'selenium-webdriver';
import { POPUP_URL, startDriver, type DriverHandle } from './fixtures/driver.js';

let handle: DriverHandle | null = null;

async function openPopup(driver: WebDriver): Promise<void> {
  await driver.get(POPUP_URL);
  // Wait for React to mount — same "root has children" signal we use in
  // the Chromium fixture.
  await driver.wait(
    () =>
      driver
        .executeScript('return (document.getElementById("root")?.children.length ?? 0) > 0')
        .then((r) => Boolean(r)),
    15_000,
  );
}

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
    await driver
      .findElement(By.css('input[placeholder*="at least 8 characters" i]'))
      .sendKeys('test1234');
    await driver.findElement(By.css('input[placeholder*="repeat" i]')).sendKeys('test1234');
    await driver
      .findElement(
        By.xpath('//button[contains(translate(., "CREATVULFORMPS", "creatvulformps"), "create")]'),
      )
      .click();
    // Heavy Argon2 preset — give the recovery-key screen plenty of time.
    await driver.wait(until.elementLocated(By.xpath('//*[contains(., "Recovery Key")]')), 45_000);
  });

  test('should require minimum password length', async () => {
    const driver = handle!.driver;
    await driver
      .findElement(By.css('input[placeholder*="at least 8 characters" i]'))
      .sendKeys('short');
    await driver.findElement(By.css('input[placeholder*="repeat" i]')).sendKeys('short');
    await driver
      .findElement(
        By.xpath('//button[contains(translate(., "CREATVULFORMPS", "creatvulformps"), "create")]'),
      )
      .click();
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
    await driver
      .findElement(By.css('input[placeholder*="at least 8 characters" i]'))
      .sendKeys('test1234');
    await driver.findElement(By.css('input[placeholder*="repeat" i]')).sendKeys('different');
    await driver
      .findElement(
        By.xpath('//button[contains(translate(., "CREATVULFORMPS", "creatvulformps"), "create")]'),
      )
      .click();
    await driver.wait(until.elementLocated(By.xpath('//*[contains(., "do not match")]')), 5_000);
  });
});
