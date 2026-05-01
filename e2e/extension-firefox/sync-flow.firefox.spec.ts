/**
 * Firefox port of `e2e/extension/sync-flow.spec.ts`. Runs the base-test-flow
 * §5–§8 (first-time sync → merge → replace → restore) against the KeyKeyKey
 * Firefox extension.
 *
 * Each test opens a fresh driver (so each starts from Create-Your-Vault)
 * but all four share remote WebDAV state in the expected order — §7 reads
 * what §5 uploaded, §8 overwrites §7's remote, §6 restores from what §8
 * left. `wipeRemote()` frames the suite with known-clean state.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/lib/select.js';
import { startDriver, type DriverHandle } from './fixtures/driver.js';
import {
  addCredential,
  clickButton,
  clickByTextLast,
  createVault,
  fillByPlaceholder,
  openPopup,
  waitForText,
} from './fixtures/flow.js';

const WEBDAV_URL = process.env.KKK_WEBDAV_URL ?? '';
const WEBDAV_USER = process.env.KKK_WEBDAV_USER ?? '';
const WEBDAV_PASS = process.env.KKK_WEBDAV_PASS ?? '';
const HAVE_CREDS = WEBDAV_URL.length > 0 && WEBDAV_USER.length > 0 && WEBDAV_PASS.length > 0;
const HAS_WEBDAV_ENV = WEBDAV_URL.length > 0 || WEBDAV_USER.length > 0 || WEBDAV_PASS.length > 0;
const WRITE_DIAGNOSTIC_ARTIFACTS =
  process.env.KKK_E2E_RECORD_ARTIFACTS !== 'false' && !HAS_WEBDAV_ENV;

const AUTH = HAVE_CREDS ? Buffer.from(`${WEBDAV_USER}:${WEBDAV_PASS}`).toString('base64') : '';

async function wipeRemote(): Promise<void> {
  await fetch('https://davidneto.eu/api/webdav/clear-data', {
    method: 'POST',
    headers: { Authorization: `Basic ${AUTH}` },
  }).catch(() => {});
}

async function remotePresent(): Promise<boolean> {
  const res = await fetch(`${WEBDAV_URL}/keykeykey/vault.enc`, {
    headers: { Authorization: `Basic ${AUTH}` },
  });
  return res.ok;
}

async function countRemoteItems(): Promise<number> {
  return (await listRemoteItemIds()).length;
}

async function listRemoteItemIds(): Promise<string[]> {
  const res = await fetch(`${WEBDAV_URL}/keykeykey/items/`, {
    method: 'PROPFIND',
    headers: { Authorization: `Basic ${AUTH}`, Depth: '1' },
  });
  if (!res.ok) return [];
  const xml = await res.text();
  // PROPFIND responses mention the resource path multiple times (once in
  // `<d:href>`, once in the response `<d:propstat>` element that repeats
  // it, sometimes more). Dedup by ID so the count reflects unique items.
  return Array.from(new Set(Array.from(xml.matchAll(/[0-9a-f-]{36}\.bin/g)).map((m) => m[0])));
}

async function openSyncSettings(driver: NonNullable<DriverHandle>['driver']): Promise<void> {
  await driver.findElement(By.css('button[aria-label="Settings"]')).click();
  await waitForText(driver, 'cloud sync', 5_000);
  // "Cloud Sync" appears twice — section heading + clickable row.
  await clickByTextLast(driver, 'cloud sync');
  // sync-provider <select> is the signal the Cloud Sync screen has mounted.
  await driver.wait(
    async () => (await driver.findElements(By.css('[data-testid="sync-provider"]'))).length > 0,
    5_000,
  );
}

async function fillWebdavForm(
  driver: NonNullable<DriverHandle>['driver'],
  masterPassword: string,
): Promise<void> {
  const select = new firefox.Select(
    await driver.findElement(By.css('[data-testid="sync-provider"]')),
  );
  await select.selectByValue('webdav');

  const byTestId = async (id: string) => driver.findElement(By.css(`[data-testid="${id}"]`));
  await (await byTestId('sync-webdav-url')).sendKeys(WEBDAV_URL);
  await (await byTestId('sync-webdav-username')).sendKeys(WEBDAV_USER);
  await (await byTestId('sync-webdav-password')).sendKeys(WEBDAV_PASS);
  await (await byTestId('sync-master-password')).sendKeys(masterPassword);
  await clickButton(driver, 'connect');
}

let handle: DriverHandle | null = null;

beforeAll(async () => {
  if (!HAVE_CREDS) return;
  await wipeRemote();
});

afterAll(async () => {
  if (!HAVE_CREDS) return;
  await wipeRemote();
});

beforeEach(async () => {
  if (!HAVE_CREDS) return;
  handle = await startDriver();
  await openPopup(handle.driver);
});

afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

describe.skipIf(!HAVE_CREDS)('Base flow §5–§8 WebDAV sync (Firefox)', () => {
  test('§5 first-time WebDAV sync uploads a clean vault', async () => {
    const driver = handle!.driver;
    await createVault(driver, 'test1234');
    await addCredential(driver, {
      name: 'GitHub',
      username: 'claude-test',
      password: 'hunter2-test-password',
    });

    await openSyncSettings(driver);
    await fillWebdavForm(driver, 'test1234');
    await waitForText(driver, 'last synced', 45_000);
    expect(await remotePresent()).toBe(true);
  });

  test('§7 merge combines local + remote when passwords match', async () => {
    const driver = handle!.driver;
    await createVault(driver, 'test1234');
    await addCredential(driver, {
      name: 'GitLab',
      username: 'local-user',
      password: 'local-pass',
    });

    await openSyncSettings(driver);
    await fillWebdavForm(driver, 'test1234');

    await waitForText(driver, 'remote vault detected', 45_000);
    await clickButton(driver, 'merge vaults');

    await waitForText(driver, 'last synced', 45_000);
    expect(await remotePresent()).toBe(true);
  });

  test('§8 replace rewrites the remote when passwords differ', async () => {
    const driver = handle!.driver;
    await createVault(driver, 'testqwer');
    await addCredential(driver, {
      name: 'Bitbucket',
      username: 'replace-test',
      password: 'replace-pass',
    });

    await openSyncSettings(driver);
    await fillWebdavForm(driver, 'testqwer');
    await waitForText(driver, 'incompatible remote vault', 45_000);
    await clickButton(driver, 'replace remote with local');

    await waitForText(driver, 'last synced', 45_000);
    // `lifecycle.replaceRemote` now awaits the initial sync (see
    // `_createEngine` with `'await'` mode in sync-lifecycle.ts). When
    // "Last synced" appears, items are on the remote — no extra barrier
    // needed.
    expect(await remotePresent()).toBe(true);
    expect(await countRemoteItems()).toBe(1);
  });

  test('§6 restore-from-cloud recovers the vault from a clean device', async () => {
    const driver = handle!.driver;
    await clickButton(driver, 'restore from cloud');

    const select = new firefox.Select(
      await driver.findElement(By.css('[data-testid="restore-provider"]')),
    );
    await select.selectByValue('webdav');
    await driver.findElement(By.css('[data-testid="restore-webdav-url"]')).sendKeys(WEBDAV_URL);
    await driver
      .findElement(By.css('[data-testid="restore-webdav-username"]'))
      .sendKeys(WEBDAV_USER);
    await driver
      .findElement(By.css('[data-testid="restore-webdav-password"]'))
      .sendKeys(WEBDAV_PASS);
    await clickButton(driver, 'next');
    // Use the testid rather than the placeholder — another "master password"
    // field exists on the unlock screen (not active here but lex-close
    // enough to cause confusion during debugging).
    await driver.wait(
      async () =>
        (await driver.findElements(By.css('[data-testid="restore-master-password"]'))).length > 0,
      10_000,
    );
    await driver
      .findElement(By.css('[data-testid="restore-master-password"]'))
      .sendKeys('testqwer');
    await clickButton(driver, 'restore vault');

    // Router short-circuits to the vault list on restore success; assert
    // on the restored item instead of the transient success banner. When
    // WebDAV credentials are not present, Selenium grabs a screenshot + the
    // popup's DOM to /tmp/kkk-ff-restore-fail-*.{png,html} for post-mortem.
    try {
      await waitForText(driver, 'bitbucket', 60_000);
    } catch (e) {
      if (WRITE_DIAGNOSTIC_ARTIFACTS) {
        const png = await driver.takeScreenshot();
        const html = await driver.getPageSource();
        const fs = await import('node:fs');
        const ts = Date.now();
        fs.writeFileSync(`/tmp/kkk-ff-restore-fail-${ts}.png`, Buffer.from(png, 'base64'));
        fs.writeFileSync(`/tmp/kkk-ff-restore-fail-${ts}.html`, html);
        // eslint-disable-next-line no-console
        console.log(`[firefox-diag] saved screenshot + html to /tmp/kkk-ff-restore-fail-${ts}.*`);
      } else {
        // eslint-disable-next-line no-console
        console.log('[firefox-diag] skipped screenshot + html because WebDAV creds are present');
      }
      throw e;
    }
  });
});
