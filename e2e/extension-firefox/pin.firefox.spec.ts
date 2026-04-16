/**
 * Firefox port of `e2e/extension/pin.spec.ts`. Single test covering both
 * happy-path PIN unlock and wrong-PIN attempt counter (same reason as the
 * Chromium version: the driver is per-test, so splitting across two
 * `test()` calls would lose the PIN config).
 *
 * PinPad defaults to `maxLength=6`, so the test uses a 6-digit PIN.
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

const MASTER = 'test1234';
const PIN = '135790';
const WRONG_PIN = '000000';

let handle: DriverHandle | null = null;

beforeEach(async () => {
  handle = await startDriver();
  await openPopup(handle.driver);
});

afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

async function enterPin(driver: NonNullable<DriverHandle>['driver'], pin: string): Promise<void> {
  for (const digit of pin) {
    // Digits are 1–9,0 rendered as individual <button>s with the digit
    // as the sole text content. PinPad auto-submits once the last
    // keystroke fills the buffer.
    await driver.findElement(By.xpath(`//button[normalize-space(.)='${digit}']`)).click();
  }
}

describe('PIN unlock (Firefox)', () => {
  test('set, unlock, and wrong-PIN counter', async () => {
    const driver = handle!.driver;
    await createVault(driver, MASTER);

    // Settings → Set PIN form.
    await openSettings(driver);
    await clickButton(driver, 'set pin');
    await fillByPlaceholder(driver, 'enter pin', PIN);
    await fillByPlaceholder(driver, 'confirm pin', PIN);
    await clickButton(driver, 'set pin');
    // Form collapses; "Change PIN" replaces the "Set PIN" row.
    await waitForText(driver, 'change pin', 5_000);

    // Close Settings, lock, toggle to PIN entry, submit the correct PIN.
    await driver.findElement(By.css('button[aria-label="Back"]')).click();
    await driver.findElement(By.css('button[aria-label="Lock vault"]')).click();
    await waitForText(driver, 'unlock vault', 5_000);
    await clickButton(driver, 'use pin instead');
    await enterPin(driver, PIN);
    await waitForText(driver, 'no items', 10_000);

    // Lock again, submit wrong PIN, assert the counter.
    await driver.findElement(By.css('button[aria-label="Lock vault"]')).click();
    await waitForText(driver, 'unlock vault', 5_000);
    await clickButton(driver, 'use pin instead');
    await enterPin(driver, WRONG_PIN);
    // "Wrong PIN. 4 attempts remaining." — SET_PIN seeds 5 attempts.
    await driver.wait(
      until.elementLocated(By.xpath('//*[contains(., "4 attempts remaining")]')),
      5_000,
    );

    // Recover via master password.
    await clickButton(driver, 'use master password instead');
    await fillByPlaceholder(driver, 'master password', MASTER);
    await clickButton(driver, 'unlock');
    await waitForText(driver, 'no items', 10_000);
  });
});
