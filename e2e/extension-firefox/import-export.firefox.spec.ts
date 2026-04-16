/**
 * Firefox port of `e2e/extension/import-export.spec.ts`. Covers:
 *
 *   1. Import each vendor CSV format (Chrome, Firefox, Bitwarden, iCloud,
 *      1Password) — verifies `detectSource()` + per-vendor parser wiring.
 *   2. CSV export → reset → CSV re-import round-trip.
 *   3. Encrypted backup export → reset → encrypted import round-trip.
 *
 * Firefox/Selenium twists vs the Playwright original:
 *   - File upload via `input[type=file]`.sendKeys(absolutePath) — both
 *     fixture paths and captured-blob temp files go through the same
 *     call.
 *   - Captured blobs are written to a temp directory before re-upload
 *     because Selenium's file input only accepts absolute paths.
 *   - `test.each` from Vitest parameterises the vendor-CSV cases.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { By } from 'selenium-webdriver';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDriver, type DriverHandle } from './fixtures/driver.js';
import {
  addCredential,
  armDownloadCapture,
  clickButton,
  collectCapturedDownload,
  createVault,
  fillByPlaceholder,
  navigateExport,
  navigateImport,
  openPopup,
  resetToSetupScreen,
  waitForText,
} from './fixtures/flow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../fixtures/password-imports');

let tmpDir: string;
let handle: DriverHandle | null = null;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'kkk-ff-impexp-'));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  handle = await startDriver();
  await openPopup(handle.driver);
});

afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

const IMPORT_SOURCES = [
  {
    name: 'chrome',
    file: 'chrome.csv',
    expectedTitles: ['9gag.com', 'account.dji.com', 'account.samsung.com'],
  },
  {
    name: 'firefox',
    file: 'firefox.csv',
    expectedTitles: ['amazon.it', 'acp.pt'],
  },
  {
    name: 'bitwarden',
    file: 'bitwarden.csv',
    expectedTitles: ['1password', '9gag.com', 'account.jetbrains.com'],
  },
  {
    name: 'icloud',
    file: 'icloud.csv',
    expectedTitles: ['a1.net', 'backoffice.aan.pt'],
  },
  {
    name: '1password',
    file: '1password-without-header.csv',
    expectedTitles: ['radiopopular.pt', 'accounts.google.com'],
  },
] as const;

describe('Import — vendor CSV formats (Firefox)', () => {
  test.each(IMPORT_SOURCES)(
    'imports $name CSV and shows items in the vault',
    async ({ file, expectedTitles }) => {
      const driver = handle!.driver;
      await createVault(driver, 'test1234');
      await navigateImport(driver);

      const input = await driver.findElement(By.css('input[type="file"][accept=".csv"]'));
      await input.sendKeys(resolve(FIXTURES, file));

      await waitForText(driver, 'source:', 5_000);
      await clickButton(driver, 'import');
      await waitForText(driver, 'imported', 30_000);

      // Back to vault list.
      await driver.findElement(By.css('button[aria-label="Back"]')).click();
      await driver.findElement(By.css('button[aria-label="Back"]')).click();
      for (const title of expectedTitles) {
        await waitForText(driver, title, 5_000);
      }
    },
  );
});

describe('CSV round-trip (Firefox)', () => {
  test('export and re-import preserves items', async () => {
    const driver = handle!.driver;
    await createVault(driver, 'test1234');
    await addCredential(driver, {
      name: 'GitHub',
      username: 'roundtrip@example.com',
      password: 'rtpass1',
    });
    await addCredential(driver, {
      name: 'GitLab',
      username: 'roundtrip@example.com',
      password: 'rtpass2',
    });

    await navigateExport(driver);
    await armDownloadCapture(driver);
    await clickButton(driver, 'export csv');
    await waitForText(driver, 'exported successfully', 10_000);
    const csvBytes = await collectCapturedDownload(driver);
    expect(csvBytes.byteLength).toBeGreaterThan(0);
    const csvText = new TextDecoder().decode(csvBytes);
    expect(csvText).toContain('GitHub');
    expect(csvText).toContain('GitLab');

    // Write the captured CSV to disk and re-import it.
    const csvPath = join(tmpDir, 'roundtrip.csv');
    writeFileSync(csvPath, csvBytes);

    await resetToSetupScreen(driver);
    await createVault(driver, 'test1234');
    await navigateImport(driver);

    await driver.findElement(By.css('input[type="file"][accept=".csv"]')).sendKeys(csvPath);
    await waitForText(driver, 'source:', 5_000);
    await clickButton(driver, 'import');
    await waitForText(driver, 'imported 2 items', 30_000);

    await driver.findElement(By.css('button[aria-label="Back"]')).click();
    await driver.findElement(By.css('button[aria-label="Back"]')).click();
    await waitForText(driver, 'github', 5_000);
    await waitForText(driver, 'gitlab', 5_000);
  });
});

describe('Encrypted backup round-trip (Firefox)', () => {
  test('preserves items across reset', async () => {
    const driver = handle!.driver;
    await createVault(driver, 'test1234');
    await addCredential(driver, {
      name: 'GitHub',
      username: 'roundtrip@example.com',
      password: 'encpass1',
    });

    await navigateExport(driver);
    await clickButton(driver, 'encrypted backup');
    await fillByPlaceholder(driver, 'choose a password for the backup', 'backup1234');
    await fillByPlaceholder(driver, 'confirm the backup password', 'backup1234');

    await armDownloadCapture(driver);
    await clickButton(driver, 'export backup');
    await waitForText(driver, 'backup exported successfully', 15_000);
    const backupBytes = await collectCapturedDownload(driver);
    // Wire format is [16-byte salt][16-byte argon2 params][encrypted zip];
    // preamble alone is 32 bytes, a non-trivial vault is well past that.
    expect(backupBytes.byteLength).toBeGreaterThan(64);

    const backupPath = join(tmpDir, 'roundtrip.keykeykey');
    writeFileSync(backupPath, backupBytes);

    await resetToSetupScreen(driver);
    await createVault(driver, 'test1234');
    await navigateImport(driver);

    await clickButton(driver, 'from encrypted backup');
    await driver
      .findElement(By.css('input[type="file"][accept=".keykeykey"]'))
      .sendKeys(backupPath);
    await fillByPlaceholder(driver, 'master password of the backup vault', 'test1234');
    await fillByPlaceholder(driver, 'leave blank if same as master password', 'backup1234');

    await clickButton(driver, 'import backup');
    await waitForText(driver, 'imported 1 item', 30_000);

    await driver.findElement(By.css('button[aria-label="Back"]')).click();
    await driver.findElement(By.css('button[aria-label="Back"]')).click();
    await waitForText(driver, 'github', 5_000);
  });
});
