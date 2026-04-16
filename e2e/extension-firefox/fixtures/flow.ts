/**
 * Shared Selenium flow helpers, so every `*.firefox.spec.ts` can speak the
 * same language. These mirror the `createVault` / `addCredential` / etc.
 * top-of-file helpers we repeat across the Chromium specs — port the
 * extension's behavior, not specific selectors.
 *
 * Naming conventions:
 *   - `fill*` → locates + sendKeys.
 *   - `click*` → locates + clicks a visible element.
 *   - `waitFor*` → blocks until the element/condition becomes true.
 *   - `open*` / `lock*` / `unlock*` → full UI transitions (may chain
 *      multiple actions).
 */
import { By, type WebDriver, until } from 'selenium-webdriver';
import { POPUP_URL } from './driver.js';

// ---------------------------------------------------------------------------
// Low-level primitives
// ---------------------------------------------------------------------------

/**
 * `input[placeholder*="<substr>" i]` — case-insensitive CSS4 attr match.
 *
 * Retries once on `StaleElementReferenceError`: React occasionally
 * re-renders the input between `findElement` and `clear()`, which makes
 * the cached element reference stale. One fresh `findElement` usually
 * succeeds — if it doesn't, the underlying issue is more than a race.
 */
export async function fillByPlaceholder(
  driver: WebDriver,
  placeholderSubstr: string,
  value: string,
): Promise<void> {
  const selector = By.css(`input[placeholder*="${placeholderSubstr}" i]`);
  try {
    const el = await driver.findElement(selector);
    await el.clear();
    await el.sendKeys(value);
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (name !== 'StaleElementReferenceError') throw err;
    const el = await driver.findElement(selector);
    await el.clear();
    await el.sendKeys(value);
  }
}

/**
 * Click a button whose visible text contains `substr` (case-insensitive).
 * Selenium's XPath doesn't have a clean `text()` case-insensitive match
 * so we use `translate()` to fold to lowercase before comparing.
 */
export async function clickButton(driver: WebDriver, substr: string): Promise<void> {
  const lower = substr.toLowerCase();
  const upper = substr.toUpperCase();
  await driver
    .findElement(By.xpath(`//button[contains(translate(., '${upper}', '${lower}'), '${lower}')]`))
    .click();
}

/** Click any element (div, button, span) whose visible text contains `substr`. */
export async function clickByText(driver: WebDriver, substr: string): Promise<void> {
  const lower = substr.toLowerCase();
  const upper = substr.toUpperCase();
  await driver
    .findElement(
      By.xpath(
        `//*[contains(translate(., '${upper}', '${lower}'), '${lower}')][not(self::body or self::html)]`,
      ),
    )
    .click();
}

/**
 * Click the LAST element whose visible text contains `substr`. Useful when
 * a label appears both as a section heading and as a clickable row — the
 * clickable row is almost always rendered after the heading.
 */
export async function clickByTextLast(driver: WebDriver, substr: string): Promise<void> {
  const lower = substr.toLowerCase();
  const upper = substr.toUpperCase();
  await driver
    .findElement(
      By.xpath(
        `(//*[contains(translate(., '${upper}', '${lower}'), '${lower}')][not(self::body or self::html)])[last()]`,
      ),
    )
    .click();
}

/**
 * Click a vault-list item by its display name. `ItemCard` renders the name
 * in a <div> whose `normalize-space()` equals the literal name, which is
 * more specific than a `contains()` match (avoids clicking a wrapping
 * layout div that has no click handler).
 */
export async function clickVaultItem(driver: WebDriver, name: string): Promise<void> {
  await driver.findElement(By.xpath(`//*[normalize-space(text())='${name}']`)).click();
}

/** Wait until an element with matching visible text exists. */
export async function waitForText(
  driver: WebDriver,
  substr: string,
  timeoutMs = 10_000,
): Promise<void> {
  const lower = substr.toLowerCase();
  const upper = substr.toUpperCase();
  await driver.wait(
    until.elementLocated(
      By.xpath(`//*[contains(translate(., '${upper}', '${lower}'), '${lower}')]`),
    ),
    timeoutMs,
  );
}

// ---------------------------------------------------------------------------
// High-level flow helpers
// ---------------------------------------------------------------------------

/** Load the popup URL and wait for React to mount. */
export async function openPopup(driver: WebDriver): Promise<void> {
  await driver.get(POPUP_URL);
  await driver.wait(
    () =>
      driver
        .executeScript('return (document.getElementById("root")?.children.length ?? 0) > 0')
        .then((r) => Boolean(r)),
    15_000,
  );
}

/** Create a fresh vault with the given master password and dismiss the recovery-key screen. */
export async function createVault(driver: WebDriver, password: string): Promise<void> {
  await fillByPlaceholder(driver, 'at least 8 characters', password);
  await fillByPlaceholder(driver, 'repeat', password);
  await clickButton(driver, 'create vault');
  // Heavy Argon2 preset — recovery-key screen may take up to ~30 s.
  await waitForText(driver, 'recovery key', 45_000);
  await driver.findElement(By.css('input[type="checkbox"]')).click();
  await clickButton(driver, 'continue');
  await waitForText(driver, 'no items', 10_000);
}

/** Add a login credential from the vault list screen. */
export async function addCredential(
  driver: WebDriver,
  opts: { name: string; username: string; password: string; url?: string },
): Promise<void> {
  await driver.findElement(By.css('button[aria-label="Add item"]')).click();
  await fillByPlaceholder(driver, 'item name', opts.name);
  if (opts.url) {
    // The URL field's placeholder varies across views; fall back to position.
    try {
      await fillByPlaceholder(driver, 'website or app', opts.url);
    } catch {
      const textInputs = await driver.findElements(By.css('input[type="text"]'));
      if (textInputs.length >= 2) {
        await textInputs[1]!.clear();
        await textInputs[1]!.sendKeys(opts.url);
      }
    }
  }
  await fillByPlaceholder(driver, 'user@example.com', opts.username);
  await fillByPlaceholder(driver, 'password', opts.password);
  await clickButton(driver, 'save');
  await waitForText(driver, opts.name, 10_000);
}

/** Click the vault's toolbar Lock button. */
export async function lockVault(driver: WebDriver): Promise<void> {
  await driver.findElement(By.css('button[aria-label="Lock vault"]')).click();
  await waitForText(driver, 'unlock vault', 5_000);
}

/** From the Unlock Vault screen, enter the master password and submit. */
export async function unlockWithPassword(driver: WebDriver, password: string): Promise<void> {
  await fillByPlaceholder(driver, 'master password', password);
  await clickButton(driver, 'unlock');
  await waitForText(driver, 'no items', 15_000);
}

/** Click the Settings icon and wait for the screen to mount. */
export async function openSettings(driver: WebDriver): Promise<void> {
  await driver.findElement(By.css('button[aria-label="Settings"]')).click();
  await waitForText(driver, 'security', 5_000);
}

/** From Settings, open the Import Passwords screen. */
export async function navigateImport(driver: WebDriver): Promise<void> {
  await openSettings(driver);
  await driver.findElement(By.xpath("//*[normalize-space(text())='Import Passwords']")).click();
  await waitForText(driver, 'from csv', 5_000);
}

/** From Settings, open the Export Vault screen. */
export async function navigateExport(driver: WebDriver): Promise<void> {
  await openSettings(driver);
  await driver.findElement(By.xpath("//*[normalize-space(text())='Export Vault']")).click();
  await waitForText(driver, 'export as csv', 5_000);
}

/**
 * Install an in-page hook that captures the bytes passed to the next
 * `URL.createObjectURL(blob)` call. Same trick the Chromium spec uses —
 * both the `browser.downloads.download` and `<a>` fallback paths go
 * through `createObjectURL`, so one hook covers both.
 */
export async function armDownloadCapture(driver: WebDriver): Promise<void> {
  await driver.executeScript(`
    const orig = URL.createObjectURL.bind(URL);
    window.__nextDownload = new Promise((resolve) => {
      URL.createObjectURL = (obj) => {
        if (obj instanceof Blob) {
          obj.arrayBuffer().then((buf) => resolve(Array.from(new Uint8Array(buf))));
        }
        return orig(obj);
      };
    });
  `);
}

/** Wait for the armed hook to fire; returns the captured bytes. */
export async function collectCapturedDownload(driver: WebDriver): Promise<Uint8Array> {
  const bytes = await driver.executeAsyncScript<number[]>(`
    const done = arguments[arguments.length - 1];
    window.__nextDownload.then(done);
  `);
  return new Uint8Array(bytes);
}

/**
 * Reset the vault back to the Setup screen by sending RESET_VAULT through
 * the extension's background (same bypass the Chromium specs use — clicking
 * through Danger Zone in Settings is flakier than calling the handler
 * directly). Selenium's `executeAsyncScript` wires up a callback we can
 * resolve once the background ACKs.
 */
export async function resetToSetupScreen(driver: WebDriver): Promise<void> {
  await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    chrome.runtime.sendMessage({ type: 'RESET_VAULT' }, () => {
      chrome.storage.local.clear(() => done());
    });
  `);
  // Reload to get the popup SPA to re-read background state.
  await openPopup(driver);
  await driver.wait(
    until.elementLocated(By.css('input[placeholder*="at least 8 characters" i]')),
    15_000,
  );
}
