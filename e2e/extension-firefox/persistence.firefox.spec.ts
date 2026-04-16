/**
 * Firefox port of `e2e/extension/persistence.spec.ts`. Verifies the vault
 * header + encrypted items round-trip through `chrome.storage.local` when
 * the popup cold-starts.
 *
 * Selenium twist: Playwright's `page.close()` keeps the context alive for
 * a `context.newPage()` follow-up. Selenium has one tab per driver. To
 * simulate close-and-reopen we close the current tab and `openPopup()`
 * again — the extension background stays up (no new driver launch). This
 * is the same semantic as the Chromium spec, which also kept the service
 * worker alive while closing the popup tab.
 */
import { afterEach, beforeEach, describe, test } from 'vitest';
import { By } from 'selenium-webdriver';
import { startDriver, type DriverHandle } from './fixtures/driver.js';
import { addCredential, createVault, openPopup, waitForText } from './fixtures/flow.js';

const MASTER = 'test1234';

let handle: DriverHandle | null = null;

beforeEach(async () => {
  handle = await startDriver();
  await openPopup(handle.driver);
});

afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

describe('Persistence (Firefox)', () => {
  test('vault and items persist after popup is closed and reopened', async () => {
    const driver = handle!.driver;
    await createVault(driver, MASTER);
    await addCredential(driver, {
      name: 'PersistCheck',
      username: 'persist@example.com',
      password: 'persist-pass',
    });

    // Lock, then simulate a "close popup and reopen" by closing the tab and
    // opening a fresh one pointed at the popup URL.
    await driver.findElement(By.css('button[aria-label="Lock vault"]')).click();
    await waitForText(driver, 'unlock vault', 5_000);
    // Need a scratch tab before closing the active one — closing the last
    // tab terminates the session.
    await driver.executeScript('window.open("about:blank", "_blank");');
    const handles = await driver.getAllWindowHandles();
    // Close the original popup tab.
    await driver.switchTo().window(handles[0]!);
    await driver.close();
    await driver.switchTo().window(handles[1]!);

    await openPopup(driver);
    // Should boot to Unlock Vault (not Setup), proving the header survived.
    await waitForText(driver, 'unlock vault', 15_000);

    // Unlock and confirm the item is still indexed.
    await driver.findElement(By.css('input[placeholder*="master password" i]')).sendKeys(MASTER);
    await driver
      .findElement(By.xpath('//button[contains(translate(., "UNLOCK", "unlock"), "unlock")]'))
      .click();
    await waitForText(driver, 'persistcheck', 15_000);
  });
});
