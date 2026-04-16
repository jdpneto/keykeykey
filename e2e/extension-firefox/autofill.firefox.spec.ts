/**
 * Firefox port of `e2e/extension/autofill.spec.ts`. Matches the Chromium
 * approach: serve a synthetic login form at a URL the content-script
 * match pattern (`http://localhost/*`, `https://*`) covers, then fire
 * `FILL_FROM_POPUP` directly into the content script.
 *
 * Firefox considerations:
 *   - Selenium doesn't have Playwright's `page.route` request
 *     interception. We start a tiny Node http server on 127.0.0.1 that
 *     returns the login page HTML.
 *   - Selenium's `driver.executeAsyncScript` awaits a callback fired
 *     via `arguments[arguments.length - 1]`, so the `chrome.tabs.query`
 *     / `chrome.tabs.sendMessage` chain is wired through that.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from 'vitest';
import { By } from 'selenium-webdriver';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { startDriver, type DriverHandle } from './fixtures/driver.js';
import { addCredential, createVault, openPopup, waitForText } from './fixtures/flow.js';

const MASTER = 'test1234';
const CRED = {
  name: 'localhost-login',
  username: 'filltest@example.com',
  password: 'fillpass123',
};

const LOGIN_HTML = `<!doctype html>
<html>
  <body>
    <form id="loginform">
      <input type="email" name="username" autocomplete="username" />
      <input type="password" name="password" autocomplete="current-password" />
      <button type="submit">Log in</button>
    </form>
  </body>
</html>`;

let server: Server;
let loginUrl: string;
let handle: DriverHandle | null = null;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(LOGIN_HTML);
  });
  // Bind on 127.0.0.1 but connect through the `localhost` hostname:
  // `manifest.json`'s content-script match is `http://localhost/*`, which
  // Chrome wildcard-matches any port but NOT `127.0.0.1` as a distinct
  // host. Connecting as `localhost` resolves to `127.0.0.1` via the OS
  // and the content script activates.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  loginUrl = `http://localhost:${port}/login`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  handle = await startDriver();
  await openPopup(handle.driver);
});

afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

describe('Autofill (Firefox)', () => {
  test('fills username and password on a login form', async () => {
    const driver = handle!.driver;
    await createVault(driver, MASTER);
    await addCredential(driver, { ...CRED, url: loginUrl });

    // Open the login page in a new tab.
    const popupHandle = await driver.getWindowHandle();
    await driver.switchTo().newWindow('tab');
    await driver.get(loginUrl);
    await driver.findElement(By.css('input[type="password"]'));

    const loginTabHandle = await driver.getWindowHandle();

    // Swap back to the popup to dispatch the message. Playwright's
    // equivalent uses `chrome.tabs.sendMessage(tabId, ...)` — we mirror
    // that exactly so the content-script receive path is what gets
    // exercised.
    await driver.switchTo().window(popupHandle);
    await driver.executeAsyncScript(
      `
        const done = arguments[arguments.length - 1];
        const [username, password] = [arguments[0], arguments[1]];
        chrome.tabs.query({ url: 'http://localhost/*' }, (tabs) => {
          const tabId = tabs[0] && tabs[0].id;
          if (typeof tabId !== 'number') return done('no tab');
          chrome.tabs.sendMessage(
            tabId,
            { type: 'FILL_FROM_POPUP', username, password },
            () => done('ok'),
          );
        });
      `,
      CRED.username,
      CRED.password,
    );

    await driver.switchTo().window(loginTabHandle);
    await driver.wait(
      async () => {
        const uv = await driver.findElement(By.css('input[name="username"]')).getAttribute('value');
        return uv === CRED.username;
      },
      10_000,
      'username field never populated',
    );
    const pv = await driver.findElement(By.css('input[name="password"]')).getAttribute('value');
    if (pv !== CRED.password) throw new Error(`password field had "${pv}"`);
  });
});
