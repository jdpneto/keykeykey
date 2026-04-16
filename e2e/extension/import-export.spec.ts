/**
 * End-to-end import/export coverage for the Chrome extension popup.
 *
 *   1. Import each vendor CSV format we claim to support (Chrome, Firefox,
 *      Bitwarden, iCloud, 1Password) — verifies the per-vendor parser wiring
 *      plus `detectSource()`.
 *   2. CSV export → reset → CSV re-import round-trip — verifies the KeyKeyKey
 *      CSV format is lossless for credential fields we care about.
 *   3. Encrypted backup export → reset → encrypted import round-trip —
 *      verifies the `.keykeykey` zip bundle's `vault.enc` + `items/*` layout
 *      unwraps correctly under the original master password.
 *
 * Fixtures (anonymized) live in e2e/fixtures/password-imports/. Never point
 * this spec at the real `passwords/` exports — those are gitignored for a
 * reason.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../fixtures/extension.js';
import type { Page } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../fixtures/password-imports');

// ---------------------------------------------------------------------------
// Shared UI helpers (mirror sync-flow.spec.ts conventions).
// ---------------------------------------------------------------------------

async function createVault(popup: Page, password: string): Promise<void> {
  await popup.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, {
    timeout: 15_000,
  });
  await popup.getByPlaceholder(/at least 8 characters/i).fill(password);
  await popup.getByPlaceholder(/repeat your password/i).fill(password);
  await popup.getByRole('button', { name: /create vault/i }).click();
  await expect(popup.getByRole('heading', { name: /recovery key/i })).toBeVisible({
    timeout: 30_000,
  });
  await popup.getByRole('checkbox').check();
  await popup.getByRole('button', { name: /continue/i }).click();
  await expect(popup.getByText(/no items/i)).toBeVisible({ timeout: 5_000 });
}

async function addCredential(
  popup: Page,
  name: string,
  username: string,
  password: string,
): Promise<void> {
  await popup.getByLabel('Add item').click();
  await popup.getByPlaceholder('Item name').fill(name);
  await popup.getByPlaceholder('user@example.com').fill(username);
  await popup.getByPlaceholder('Password').fill(password);
  await popup.getByRole('button', { name: /^save$/i }).click();
  await expect(popup.getByText(name).first()).toBeVisible({ timeout: 10_000 });
}

async function openSettings(popup: Page): Promise<void> {
  await popup.getByLabel('Settings').click();
  // The Settings heading appears once the screen mounts. Wait for the Import
  // row as a more specific readiness signal.
  await expect(popup.getByText('Import Passwords')).toBeVisible({ timeout: 5_000 });
}

async function navigateImport(popup: Page): Promise<void> {
  await openSettings(popup);
  await popup.getByText('Import Passwords').click();
  await expect(popup.getByRole('button', { name: /from csv/i })).toBeVisible({
    timeout: 5_000,
  });
}

async function navigateExport(popup: Page): Promise<void> {
  await openSettings(popup);
  await popup.getByText('Export Vault').click();
  await expect(popup.getByRole('button', { name: /export as csv/i })).toBeVisible({
    timeout: 5_000,
  });
}

/**
 * Reset the popup back to the Setup screen by sending RESET_VAULT to the
 * background service worker and reloading. Mirrors sync-flow.spec.ts's
 * resetToSetupScreen — needed because Playwright's persistent context shares
 * Chromium state across serial tests.
 */
async function resetToSetupScreen(popup: Page): Promise<void> {
  await popup.evaluate(
    () =>
      new Promise<void>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const C = chrome as any;
        C.runtime.sendMessage({ type: 'RESET_VAULT' }, () => {
          C.storage.local.clear(() => resolve());
        });
      }),
  );
  await popup.goto(popup.url());
  await popup.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, {
    timeout: 15_000,
  });
  await expect(popup.getByPlaceholder(/at least 8 characters/i)).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Install an in-page hook that captures the bytes passed to the next
 * `URL.createObjectURL(blob)` call. Both the `browser.downloads.download`
 * and the `<a>`-click fallback download paths route through `createObjectURL`
 * so this single hook covers both, and the extension's download API isn't
 * something Playwright intercepts natively.
 */
async function armDownloadCapture(popup: Page): Promise<void> {
  await popup.evaluate(() => {
    const orig = URL.createObjectURL.bind(URL);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__nextDownload = new Promise<number[]>((resolve) => {
      URL.createObjectURL = (obj: Blob | MediaSource) => {
        if (obj instanceof Blob) {
          obj.arrayBuffer().then((buf) => resolve(Array.from(new Uint8Array(buf))));
        }
        return orig(obj as Blob);
      };
    });
  });
}

async function collectCapturedDownload(popup: Page): Promise<Uint8Array> {
  const bytes = await popup.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__nextDownload as Promise<number[]>,
  );
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// Test fixtures and expectations.
// ---------------------------------------------------------------------------

/**
 * Per-vendor fixtures. `expectedLogins` lists a few representative items
 * we expect to end up in the vault after import — by title. The title
 * assertions are loose: we only require a specific subset appears, not the
 * entire vendor CSV, so that the importer's row-filtering behavior (skipping
 * the Firefox Accounts chrome:// entry, the 1Password Identity row) doesn't
 * turn every parser tweak into a failing expectation.
 */
const IMPORT_SOURCES = [
  {
    name: 'chrome',
    file: 'chrome.csv',
    badge: /chrome/i,
    expectedTitles: ['9gag.com', 'account.dji.com', 'account.samsung.com'],
  },
  {
    name: 'firefox',
    file: 'firefox.csv',
    badge: /firefox/i,
    expectedTitles: ['amazon.it', 'acp.pt'],
  },
  {
    name: 'bitwarden',
    file: 'bitwarden.csv',
    badge: /bitwarden/i,
    expectedTitles: ['1password', '9gag.com', 'account.jetbrains.com'],
  },
  {
    name: 'icloud',
    file: 'icloud.csv',
    badge: /icloud/i,
    expectedTitles: ['a1.net', 'backoffice.aan.pt'],
  },
  {
    name: '1password',
    file: '1password-without-header.csv',
    badge: /1password/i,
    expectedTitles: ['radiopopular.pt', 'accounts.google.com'],
  },
] as const;

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// §1  CSV import — one spec per vendor format.
// ---------------------------------------------------------------------------

test.describe('@critical Import — vendor CSV formats', () => {
  for (const source of IMPORT_SOURCES) {
    test(`imports ${source.name} CSV and shows items in the vault`, async ({ popup }) => {
      await resetToSetupScreen(popup);
      await createVault(popup, 'test1234');
      await navigateImport(popup);

      // The file input is display:none; setInputFiles targets it directly.
      await popup
        .locator('input[type="file"][accept=".csv"]')
        .setInputFiles(resolve(FIXTURES, source.file));

      // detectSource() result surfaces as the badge next to "Source:".
      await expect(popup.getByText('Source:')).toBeVisible({ timeout: 5_000 });
      await expect(popup.locator(`text=${source.badge.source}`).first()).toBeVisible();

      // Importer commits the rows and navigates back to the vault list.
      await popup.getByRole('button', { name: /^import$/i }).click();
      await expect(popup.getByText(/imported \d+ items?/i)).toBeVisible({
        timeout: 30_000,
      });

      // Close the Import screen; the vault list shows the items by title.
      await popup.getByLabel('Back').click();
      await popup.getByLabel('Back').click(); // Back from Settings too.
      for (const title of source.expectedTitles) {
        await expect(popup.getByText(title).first()).toBeVisible({ timeout: 5_000 });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// §2  CSV export → reset → re-import round-trip.
// ---------------------------------------------------------------------------

test('@critical CSV export and re-import round-trip preserves items', async ({ popup }) => {
  await resetToSetupScreen(popup);
  await createVault(popup, 'test1234');
  await addCredential(popup, 'GitHub', 'roundtrip@example.com', 'rtpass1');
  await addCredential(popup, 'GitLab', 'roundtrip@example.com', 'rtpass2');

  await navigateExport(popup);
  await armDownloadCapture(popup);
  await popup.getByRole('button', { name: /^export csv$/i }).click();
  await expect(popup.getByText(/exported successfully/i)).toBeVisible({ timeout: 10_000 });
  const csvBytes = await collectCapturedDownload(popup);
  expect(csvBytes.byteLength).toBeGreaterThan(0);
  const csvText = new TextDecoder().decode(csvBytes);
  expect(csvText).toContain('GitHub');
  expect(csvText).toContain('GitLab');

  await resetToSetupScreen(popup);
  await createVault(popup, 'test1234');
  await navigateImport(popup);

  await popup.locator('input[type="file"][accept=".csv"]').setInputFiles({
    name: 'keykeykey-export.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csvBytes),
  });
  await expect(popup.getByText('Source:')).toBeVisible({ timeout: 5_000 });

  await popup.getByRole('button', { name: /^import$/i }).click();
  await expect(popup.getByText(/imported 2 items/i)).toBeVisible({ timeout: 30_000 });
  await popup.getByLabel('Back').click();
  await popup.getByLabel('Back').click();
  await expect(popup.getByText('GitHub')).toBeVisible();
  await expect(popup.getByText('GitLab')).toBeVisible();
});

// ---------------------------------------------------------------------------
// §3  Encrypted backup export → reset → encrypted import round-trip.
// ---------------------------------------------------------------------------

test('@critical encrypted backup round-trip preserves items', async ({ popup }) => {
  await resetToSetupScreen(popup);
  await createVault(popup, 'test1234');
  await addCredential(popup, 'GitHub', 'roundtrip@example.com', 'encpass1');

  await navigateExport(popup);
  await popup.getByRole('button', { name: /encrypted backup/i }).click();
  await popup.getByPlaceholder(/choose a password for the backup/i).fill('backup1234');
  await popup.getByPlaceholder(/confirm the backup password/i).fill('backup1234');

  await armDownloadCapture(popup);
  await popup.getByRole('button', { name: /export backup/i }).click();
  await expect(popup.getByText(/backup exported successfully/i)).toBeVisible({
    timeout: 15_000,
  });
  const backupBytes = await collectCapturedDownload(popup);
  // Wire format is [16-byte salt][16-byte argon2 params][encrypted zip];
  // preamble alone is 32 bytes and a non-trivial vault's ciphertext pushes
  // it well past that. The real integrity check is the re-import below.
  expect(backupBytes.byteLength).toBeGreaterThan(64);

  await resetToSetupScreen(popup);
  await createVault(popup, 'test1234');
  await navigateImport(popup);

  await popup.getByRole('button', { name: /from encrypted backup/i }).click();
  await popup.locator('input[type="file"][accept=".keykeykey"]').setInputFiles({
    name: 'backup.keykeykey',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(backupBytes),
  });
  await popup.getByPlaceholder(/master password of the backup vault/i).fill('test1234');
  await popup.getByPlaceholder(/leave blank if same as master password/i).fill('backup1234');

  await popup.getByRole('button', { name: /import backup/i }).click();
  await expect(popup.getByText(/imported 1 item/i)).toBeVisible({ timeout: 30_000 });

  await popup.getByLabel('Back').click();
  await popup.getByLabel('Back').click();
  await expect(popup.getByText('GitHub')).toBeVisible();
});
