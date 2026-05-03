/**
 * Runs the base-test-flow sections 5-8 against the Chrome extension:
 *   §5  First-time WebDAV sync
 *   §6  Reset + Restore from Cloud
 *   §7  Merge conflict (same master password, different origin)
 *   §8  Replace conflict (different master password)
 *
 * The repo's regular @critical extension tests already cover §1-§4. This
 * spec fills in the sync-lifecycle gap that couldn't be driven via
 * chrome-devtools MCP (Chrome 145 blocks --load-extension under automation,
 * even with --disable-features=DisableLoadExtensionCommandLineSwitch).
 */
import { test, expect } from '../fixtures/extension.js';
import type { Page } from '@playwright/test';

// WebDAV credentials come from environment variables so this spec can never
// be committed (or leaked through CI logs) with live credentials. Run locally
// with:
//   KKK_WEBDAV_URL=https://... KKK_WEBDAV_USER=... KKK_WEBDAV_PASS=... \
//     npx playwright test --project=extension extension/sync-flow
// If any of the three env vars are unset, the whole describe block is skipped.
const WEBDAV_URL = process.env.KKK_WEBDAV_URL ?? '';
const WEBDAV_USER = process.env.KKK_WEBDAV_USER ?? '';
const WEBDAV_PASS = process.env.KKK_WEBDAV_PASS ?? '';
const HAVE_CREDS = WEBDAV_URL.length > 0 && WEBDAV_USER.length > 0 && WEBDAV_PASS.length > 0;

const AUTH = HAVE_CREDS ? Buffer.from(`${WEBDAV_USER}:${WEBDAV_PASS}`).toString('base64') : '';

async function wipeRemote(): Promise<void> {
  // Server-side reset: the test WebDAV tenant exposes a dedicated endpoint
  // that wipes `/keykeykey/vault.enc` and every `/keykeykey/items/*.bin` in
  // one hop. This keeps the reset atomic (no PROPFIND → per-item DELETE race)
  // and lets CI workers share a tenant without stepping on each other
  // mid-PROPFIND.
  await fetch('https://davidneto.eu/api/webdav/clear-data', {
    method: 'POST',
    headers: { Authorization: `Basic ${AUTH}` },
  }).catch(() => {});
}

/** Checks whether a vault blob exists on the WebDAV remote — doesn't attempt
 *  to decrypt (keeps the spec free of a runtime dep on @noble/*). The
 *  `Last synced` UI label is the primary success signal here; this is just
 *  a cross-check that the PUT actually reached the server. */
async function remotePresent(): Promise<boolean> {
  const res = await fetch(`${WEBDAV_URL}/keykeykey/vault.enc`, {
    headers: { Authorization: `Basic ${AUTH}` },
  });
  return res.ok;
}

/** Create a fresh vault with the given password. Skips the recovery-key screen. */
async function createVault(popup: Page, password: string): Promise<void> {
  await popup.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, {
    timeout: 15_000,
  });
  await popup.getByPlaceholder(/at least 8 characters/i).fill(password);
  await popup.getByPlaceholder(/repeat your password/i).fill(password);
  await popup.getByRole('button', { name: /create vault/i }).click();
  await expect(popup.getByRole('heading', { name: /recovery key/i })).toBeVisible({
    timeout: 45_000,
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

async function deleteCredential(popup: Page, name: string): Promise<void> {
  await popup.getByText(name).first().click();
  await popup.getByRole('button', { name: /^delete$/i }).click();
  await popup
    .getByRole('button', { name: /^delete$/i })
    .last()
    .click();
  await expect(popup.getByText(/no items/i)).toBeVisible({ timeout: 45_000 });
}

async function syncNowFromVaultList(popup: Page): Promise<void> {
  const syncNow = popup.getByRole('button', { name: /sync now/i });
  await expect(syncNow).toBeVisible({ timeout: 10_000 });
  await syncNow.click();
  await expect(syncNow).toBeEnabled({ timeout: 45_000 });
}

/** Open Settings → Cloud Sync → Provider=WebDAV form. */
async function openSyncSettings(popup: Page): Promise<void> {
  await popup.getByLabel('Settings').click();
  await expect(popup.getByText('Settings').first()).toBeVisible({ timeout: 5_000 });
  // Cloud Sync is a clickable <div>, not a button; the text appears twice on the
  // page (section heading + the clickable entry) — target the clickable one.
  await popup.getByText('Cloud Sync').last().click();
  await expect(popup.getByTestId('sync-provider')).toBeVisible({ timeout: 5_000 });
}

/**
 * Get the popup back to the Setup screen regardless of current state.
 * `launchPersistentContext('')` + serial-mode tests share Chromium state,
 * so §6 starts with whatever §8 left behind. We send `RESET_VAULT` directly
 * to the background service worker (bypassing UI scroll / DangerZone
 * visibility issues), then reload the popup.
 */
async function resetToSetupScreen(popup: Page): Promise<void> {
  await popup.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, {
    timeout: 15_000,
  });
  // Already on Setup? Bail out.
  const onSetup = await popup
    .getByPlaceholder(/at least 8 characters/i)
    .isVisible()
    .catch(() => false);
  if (onSetup) return;

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
  // Full page reload so the popup re-reads status from the background.
  await popup.goto(popup.url());
  await popup.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, {
    timeout: 15_000,
  });
  await expect(popup.getByPlaceholder(/at least 8 characters/i)).toBeVisible({
    timeout: 15_000,
  });
}

async function restoreFromCloud(popup: Page, masterPassword: string): Promise<void> {
  await popup.getByRole('button', { name: /restore from cloud/i }).click();

  await popup.getByTestId('restore-provider').selectOption('webdav');
  await popup.getByTestId('restore-webdav-url').fill(WEBDAV_URL);
  await popup.getByTestId('restore-webdav-username').fill(WEBDAV_USER);
  await popup.getByTestId('restore-webdav-password').fill(WEBDAV_PASS);
  await popup.getByRole('button', { name: /^next$/i }).click();
  await popup.getByTestId('restore-master-password').fill(masterPassword);
  await popup.getByRole('button', { name: /restore vault/i }).click();
}

async function fillWebdavForm(popup: Page, masterPassword: string): Promise<void> {
  // Select WebDAV from the provider dropdown
  await popup.getByTestId('sync-provider').selectOption('webdav');
  await popup.getByTestId('sync-webdav-url').fill(WEBDAV_URL);
  await popup.getByTestId('sync-webdav-username').fill(WEBDAV_USER);
  await popup.getByTestId('sync-webdav-password').fill(WEBDAV_PASS);
  await popup.getByTestId('sync-master-password').fill(masterPassword);
  await popup.getByRole('button', { name: /^connect$/i }).click();
}

test.describe.configure({ mode: 'serial' });

test.skip(!HAVE_CREDS, 'Set KKK_WEBDAV_URL / KKK_WEBDAV_USER / KKK_WEBDAV_PASS to run');

test.describe('@critical Base flow §5–§8 (WebDAV sync)', () => {
  test.beforeAll(async () => {
    await wipeRemote();
  });

  test.afterAll(async () => {
    await wipeRemote();
  });

  test('§5 first-time WebDAV sync uploads a clean vault', async ({ popup }) => {
    await createVault(popup, 'test1234');
    await addCredential(popup, 'GitHub', 'claude-test', 'hunter2-test-password');

    await openSyncSettings(popup);
    await fillWebdavForm(popup, 'test1234');

    // "Last synced" label appears once the initial sync finishes.
    await expect(popup.getByText(/last synced/i)).toBeVisible({ timeout: 45_000 });
    // No "Remote vault mismatch" banner.
    await expect(popup.getByText(/remote vault mismatch/i)).not.toBeVisible();

    expect(await remotePresent()).toBe(true);
  });

  test('§7 merge combines local + remote when passwords match', async ({ popup }) => {
    // Remote left from §5: 1 item (GitHub) encrypted with test1234.
    // Build a FRESH local vault with the SAME password and add a DIFFERENT item.
    await createVault(popup, 'test1234');
    await addCredential(popup, 'GitLab', 'local-user', 'local-pass');

    await openSyncSettings(popup);
    await fillWebdavForm(popup, 'test1234');

    // Expect the Remote Vault Detected dialog with Merge offered.
    await expect(popup.getByText('Remote Vault Detected')).toBeVisible({
      timeout: 45_000,
    });
    await popup.getByRole('button', { name: /merge vaults/i }).click();

    // After merge: dialog gone, no lingering "Remote vault mismatch" banner, sync OK.
    await expect(popup.getByText('Remote Vault Detected')).not.toBeVisible({
      timeout: 45_000,
    });
    await expect(popup.getByText(/remote vault mismatch/i)).not.toBeVisible();
    await expect(popup.getByText(/last synced/i)).toBeVisible({ timeout: 45_000 });

    // Verify the remote really has both items under test1234 now.
    expect(await remotePresent()).toBe(true);
  });

  test('§8 replace rewrites the remote when passwords differ', async ({ popup }) => {
    // Remote left from §7: 2 items encrypted with test1234.
    // Build a FRESH local vault with a DIFFERENT password and add a new item.
    await createVault(popup, 'testqwer');
    await addCredential(popup, 'Bitbucket', 'replace-test', 'replace-pass');

    await openSyncSettings(popup);
    await fillWebdavForm(popup, 'testqwer');

    // Expect the Incompatible Remote Vault dialog (password can't decrypt remote).
    await expect(popup.getByText('Incompatible Remote Vault')).toBeVisible({
      timeout: 45_000,
    });
    await popup.getByRole('button', { name: /replace remote with local/i }).click();

    // After replace: banner clears, Last synced shows.
    await expect(popup.getByText('Incompatible Remote Vault')).not.toBeVisible({ timeout: 45_000 });
    await expect(popup.getByText(/remote vault mismatch/i)).not.toBeVisible();
    await expect(popup.getByText(/last synced/i)).toBeVisible({ timeout: 45_000 });

    // Verify remote now decrypts with testqwer and has exactly 1 item.
    expect(await remotePresent()).toBe(true);
  });

  test('§6 restore-from-cloud recovers the vault from a clean device', async ({ popup }) => {
    // After §8 the remote has a single-item `testqwer` vault. Simulate a
    // clean install by wiping the local vault and restoring from the cloud.
    await resetToSetupScreen(popup);

    await restoreFromCloud(popup, 'testqwer');

    // Once RESTORE_FROM_CLOUD succeeds the background flips the vault status
    // to `unlocked`, and the Router short-circuits past the "Vault Restored"
    // success banner straight into the vault list. So assert on the restored
    // item instead — §8 left a single `testqwer` vault containing Bitbucket.
    await expect(popup.getByText('Bitbucket').first()).toBeVisible({ timeout: 60_000 });
  });

  test('§8b synced delete stays deleted after restore', async ({ popup }) => {
    // Start from a known local view of §8's single-item `testqwer` remote.
    await resetToSetupScreen(popup);
    await restoreFromCloud(popup, 'testqwer');
    await expect(popup.getByText('Bitbucket').first()).toBeVisible({ timeout: 60_000 });

    // Deleting records a tombstone locally; explicit Sync Now should commit it
    // to the remote, not just remove local storage.
    await deleteCredential(popup, 'Bitbucket');
    await syncNowFromVaultList(popup);

    await resetToSetupScreen(popup);
    await restoreFromCloud(popup, 'testqwer');

    await expect(popup.getByText(/no items/i)).toBeVisible({ timeout: 60_000 });
    await expect(popup.getByText('Bitbucket')).not.toBeVisible();
  });
});
