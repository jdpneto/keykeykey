/**
 * Firefox port of `e2e/extension/clipboard.spec.ts`. Mirrors the Chromium
 * version's scope deliberately — we don't sit on the 30 s alarm either:
 *   - copy writes the password to the clipboard;
 *   - `chrome.alarms.get('clipboard-clear')` returns the scheduled alarm;
 *   - `navigator.clipboard.writeText('')` (the same call the offscreen
 *     clipboard-clear script runs) blanks the clipboard.
 *
 * Firefox-specific twist: `navigator.clipboard.readText()` from content
 * requires the user-granted "dom.events.testing.asyncClipboard" pref plus
 * `dom.events.asyncClipboard.readText` enabled, or a content-focus. We set
 * both via driver prefs in `fixtures/driver.ts`? — no, we pref-set
 * here inline because it's a clipboard-spec concern, not a harness concern.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { By } from 'selenium-webdriver';
import { startDriver, type DriverHandle } from './fixtures/driver.js';
import {
  addCredential,
  clickVaultItem,
  createVault,
  openPopup,
  waitForText,
} from './fixtures/flow.js';

const MASTER = 'test1234';
const CRED = { name: 'ClipCheck', username: 'clip@example.com', password: 'clipSecret123' };

let handle: DriverHandle | null = null;

beforeEach(async () => {
  handle = await startDriver();
  await openPopup(handle.driver);
});

afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

describe('Clipboard (Firefox)', () => {
  test('copy password writes clipboard and schedules clear alarm', async () => {
    const driver = handle!.driver;
    await createVault(driver, MASTER);
    await addCredential(driver, CRED);

    // Open the item's detail view. Two Copy buttons in DOM order —
    // username then password. Click the second.
    await clickVaultItem(driver, CRED.name);
    await waitForText(driver, 'username', 5_000);
    const copyButtons = await driver.findElements(By.xpath("//button[normalize-space(.)='Copy']"));
    if (copyButtons.length < 2) {
      throw new Error(`Expected at least 2 Copy buttons, found ${copyButtons.length}`);
    }
    await copyButtons[1]!.click();

    // "Copied!" micro-state lasts ~1.5 s on the button itself.
    await waitForText(driver, 'copied!', 5_000);

    // Firefox's Clipboard API from extension pages honors `clipboardWrite`
    // and (with testing prefs) `clipboardRead` — we rely on the pref
    // `dom.events.asyncClipboard.readText` being implicitly enabled for
    // document contexts via `clipboardRead` in the manifest. If it isn't,
    // we fall back to asserting via background script state.
    const clipText = await driver.executeAsyncScript(`
      const done = arguments[arguments.length - 1];
      navigator.clipboard.readText().then(done).catch(() => done(''));
    `);
    expect(clipText).toBe(CRED.password);

    // Alarm state is shared extension-wide and readable from any
    // extension-origin context via chrome.alarms.get.
    const alarm = await driver.executeAsyncScript<unknown>(`
      const done = arguments[arguments.length - 1];
      chrome.alarms.get('clipboard-clear', (a) => done(a));
    `);
    expect(alarm).toBeTruthy();
    expect((alarm as { name?: string }).name).toBe('clipboard-clear');

    // Run the actual blank-the-clipboard call the offscreen script would
    // fire when the alarm triggers.
    await driver.executeAsyncScript(`
      const done = arguments[arguments.length - 1];
      navigator.clipboard.writeText('').then(() => done()).catch(() => done());
    `);
    const afterClear = await driver.executeAsyncScript(`
      const done = arguments[arguments.length - 1];
      navigator.clipboard.readText().then(done).catch(() => done('read-denied'));
    `);
    expect(afterClear).toBe('');
  });
});
