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
 * Errors that mean "the DOM moved under us" rather than "the UI is wrong":
 * React re-mounting a screen (the popup renders a loading state, then the
 * real screen, and can re-mount once more as its status round-trip settles)
 * detaches or briefly removes the node between locate and act.
 */
const TRANSIENT_DOM_ERRORS = new Set([
  'NoSuchElementError',
  'StaleElementReferenceError',
  'ElementNotInteractableError',
  'ElementClickInterceptedError',
]);

/**
 * Locate + act as one retried unit until it succeeds or `timeoutMs` elapses.
 * A separate "wait until located" followed by a fresh `findElement` races
 * the re-mount (the element can vanish in between — seen on CI as
 * NoSuchElementError right after a successful wait), so the whole step is
 * retried instead. Non-transient errors still fail immediately.
 */
async function retryDomStep(
  driver: WebDriver,
  step: () => Promise<boolean>,
  description: string,
  timeoutMs = 10_000,
): Promise<void> {
  let lastError: unknown;
  try {
    await driver.wait(async () => {
      try {
        return await step();
      } catch (err) {
        const name = (err as { name?: string })?.name ?? '';
        if (!TRANSIENT_DOM_ERRORS.has(name)) throw err;
        lastError = err;
        return false;
      }
    }, timeoutMs);
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'TimeoutError' && lastError) {
      throw new Error(`${description} did not succeed within ${timeoutMs} ms`, {
        cause: lastError,
      });
    }
    throw err;
  }
}

/**
 * Fill `input[placeholder*="<substr>" i]` (case-insensitive CSS4 attr match).
 * Retries the locate → clear → type sequence as a unit and only returns once
 * the input actually holds `value`, so a re-mount that wipes the field
 * between typing and the next step is caught here instead of surfacing later
 * as a confusing validation error.
 */
export async function fillByPlaceholder(
  driver: WebDriver,
  placeholderSubstr: string,
  value: string,
): Promise<void> {
  const selector = By.css(`input[placeholder*="${placeholderSubstr}" i]`);
  await retryDomStep(
    driver,
    async () => {
      const el = await driver.findElement(selector);
      await el.clear();
      await el.sendKeys(value);
      return (await el.getAttribute('value')) === value;
    },
    `fill input[placeholder*="${placeholderSubstr}"]`,
  );
}

/** Locate `locator` and click it, retried as a unit (see `retryDomStep`). */
export async function clickElement(driver: WebDriver, locator: By): Promise<void> {
  await retryDomStep(
    driver,
    async () => {
      await driver.findElement(locator).click();
      return true;
    },
    `click ${locator.toString()}`,
  );
}

/**
 * Locate `locator` and type `value` into it, retried as a unit (see
 * `retryDomStep`). Not for file inputs' value checks — their `value` is a
 * browser-mangled fake path, so only the send is retried there.
 */
export async function typeInto(driver: WebDriver, locator: By, value: string): Promise<void> {
  await retryDomStep(
    driver,
    async () => {
      await driver.findElement(locator).sendKeys(value);
      return true;
    },
    `type into ${locator.toString()}`,
  );
}

/**
 * Wait for `locator` and click it, retrying the locate → click as a unit
 * while React re-mounts the screen (see `retryDomStep`).
 */
async function clickLocated(
  driver: WebDriver,
  locator: ReturnType<typeof By.xpath>,
): Promise<void> {
  await retryDomStep(
    driver,
    async () => {
      await driver.findElement(locator).click();
      return true;
    },
    `click ${locator.toString()}`,
  );
}

/**
 * Click a button whose visible text contains `substr` (case-insensitive).
 * Selenium's XPath doesn't have a clean `text()` case-insensitive match
 * so we use `translate()` to fold to lowercase before comparing.
 */
export async function clickButton(driver: WebDriver, substr: string): Promise<void> {
  const lower = substr.toLowerCase();
  const upper = substr.toUpperCase();
  await clickLocated(
    driver,
    By.xpath(`//button[contains(translate(., '${upper}', '${lower}'), '${lower}')]`),
  );
}

/** Click any element (div, button, span) whose visible text contains `substr`. */
export async function clickByText(driver: WebDriver, substr: string): Promise<void> {
  const lower = substr.toLowerCase();
  const upper = substr.toUpperCase();
  await clickLocated(
    driver,
    By.xpath(
      `//*[contains(translate(., '${upper}', '${lower}'), '${lower}')][not(self::body or self::html)]`,
    ),
  );
}

/**
 * Click the LAST element whose visible text contains `substr`. Useful when
 * a label appears both as a section heading and as a clickable row — the
 * clickable row is almost always rendered after the heading.
 */
export async function clickByTextLast(driver: WebDriver, substr: string): Promise<void> {
  const lower = substr.toLowerCase();
  const upper = substr.toUpperCase();
  await clickLocated(
    driver,
    By.xpath(
      `(//*[contains(translate(., '${upper}', '${lower}'), '${lower}')][not(self::body or self::html)])[last()]`,
    ),
  );
}

/**
 * Click a vault-list item by its display name. `ItemCard` renders the name
 * in a <div> whose `normalize-space()` equals the literal name, which is
 * more specific than a `contains()` match (avoids clicking a wrapping
 * layout div that has no click handler).
 */
export async function clickVaultItem(driver: WebDriver, name: string): Promise<void> {
  await clickLocated(driver, By.xpath(`//*[normalize-space(text())='${name}']`));
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
  await clickElement(driver, By.css('input[type="checkbox"]'));
  await clickButton(driver, 'continue');
  await waitForText(driver, 'no items', 10_000);
}

/** Add a login credential from the vault list screen. */
export async function addCredential(
  driver: WebDriver,
  opts: { name: string; username: string; password: string; url?: string },
): Promise<void> {
  await clickElement(driver, By.css('button[aria-label="Add item"]'));
  await fillByPlaceholder(driver, 'item name', opts.name);
  if (opts.url) {
    // CredentialForm's URL input (placeholder "https://example.com").
    await fillByPlaceholder(driver, 'https://example.com', opts.url);
  }
  await fillByPlaceholder(driver, 'user@example.com', opts.username);
  await fillByPlaceholder(driver, 'password', opts.password);
  await clickButton(driver, 'save');
  await waitForText(driver, opts.name, 10_000);
}

/** Click the vault's toolbar Lock button. */
export async function lockVault(driver: WebDriver): Promise<void> {
  await clickElement(driver, By.css('button[aria-label="Lock vault"]'));
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
  await clickElement(driver, By.css('button[aria-label="Settings"]'));
  await waitForText(driver, 'security', 5_000);
}

/** Landmarks that only exist on one popup screen — used to confirm a navigation finished. */
export const SCREEN = {
  /** Settings: the "Auto-Lock" section header (absent from Import/Export/vault list). */
  settings: By.xpath("//*[normalize-space(text())='Auto-Lock']"),
  /** Vault list: the toolbar's "Add item" button. */
  vaultList: By.css('button[aria-label="Add item"]'),
} as const;

/**
 * Click the header Back button and wait until `destination` is present.
 *
 * Every sub-screen renders a `Back` button with the same aria-label, so two
 * back-to-back `findElement(Back).click()` calls race the React transition:
 * the second lookup can resolve the outgoing screen's (about to unmount)
 * button, and the click is then lost or throws StaleElementReference.
 * Waiting for a landmark of the destination screen removes the race.
 */
export async function goBack(
  driver: WebDriver,
  destination: ReturnType<typeof By.css>,
  timeoutMs = 10_000,
): Promise<void> {
  await clickLocated(driver, By.css('button[aria-label="Back"]'));
  await driver.wait(until.elementLocated(destination), timeoutMs);
}

/** From Settings, open the Import Passwords screen. */
export async function navigateImport(driver: WebDriver): Promise<void> {
  await openSettings(driver);
  await clickElement(driver, By.xpath("//*[normalize-space(text())='Import Passwords']"));
  await waitForText(driver, 'from csv', 5_000);
}

/** From Settings, open the Export Vault screen. */
export async function navigateExport(driver: WebDriver): Promise<void> {
  await openSettings(driver);
  await clickElement(driver, By.xpath("//*[normalize-space(text())='Export Vault']"));
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
