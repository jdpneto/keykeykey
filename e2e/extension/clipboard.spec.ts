/**
 * Clipboard copy + auto-clear coverage.
 *
 * What's covered:
 *   - Copying a credential's password writes it to the clipboard.
 *   - Copying schedules the `clipboard-clear` alarm in the background.
 *   - `navigator.clipboard.writeText('')` can blank the clipboard (the
 *     exact call the offscreen `clipboard-clear.html` script runs in
 *     production).
 *
 * What's NOT covered by this test (deliberately):
 *   - The 30 s alarm → `chrome.offscreen.createDocument` → offscreen script
 *     chain end-to-end. Chrome's minimum alarm delay is 30 s even for
 *     unpacked extensions, and spawning the offscreen URL directly via
 *     `context.newPage()` doesn't give it the focus the Clipboard API
 *     needs. Worth revisiting once we can either time-travel the alarm or
 *     expose a dev-only trigger from the background.
 */
import { test, expect } from '../fixtures/extension.js';
import type { Page } from '@playwright/test';

const MASTER = 'test1234';
const CRED = { name: 'ClipCheck', username: 'clip@example.com', password: 'clipSecret123' };

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

async function addCredential(popup: Page): Promise<void> {
  await popup.getByLabel('Add item').click();
  await popup.getByPlaceholder('Item name').fill(CRED.name);
  await popup.getByPlaceholder('user@example.com').fill(CRED.username);
  await popup.getByPlaceholder('Password').fill(CRED.password);
  await popup.getByRole('button', { name: /^save$/i }).click();
  await expect(popup.getByText(CRED.name).first()).toBeVisible({ timeout: 10_000 });
}

test('@critical copy password writes clipboard and schedules clear alarm', async ({
  popup,
  context,
  extensionId,
}) => {
  // Clipboard-read permission is off by default for extension pages (only
  // `clipboardWrite` is in the manifest). Grant it to the browser context so
  // page.evaluate can verify the clipboard state.
  // Chrome considers chrome-extension:// origins opaque for the
  // Browser.grantPermissions CDP call, so grant globally without `origin`.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await createVault(popup, MASTER);
  await addCredential(popup);

  // Open the item's detail view. The layout has two "Copy" buttons in DOM
  // order — username, then password (the password row also has Show/Hide in
  // between, but the button role still ranks second). Target the second.
  await popup.getByText(CRED.name).first().click();
  const copyButtons = popup.getByRole('button', { name: /^copy$/i });
  await copyButtons.nth(1).click();
  await expect(popup.getByRole('button', { name: /copied!/i }).first()).toBeVisible({
    timeout: 5_000,
  });

  const clipAfterCopy = await popup.evaluate(() => navigator.clipboard.readText());
  expect(clipAfterCopy).toBe(CRED.password);

  // The background should have scheduled the clear alarm. Query via popup
  // (same extension origin → shared chrome.alarms namespace).
  const alarm = await popup.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chrome as any).alarms.get('clipboard-clear', (a: unknown) => resolve(a));
      }),
  );
  expect(alarm).toBeTruthy();
  expect((alarm as { name?: string }).name).toBe('clipboard-clear');

  // Fire the clear path from the popup — same Clipboard API write('') that
  // the background's offscreen document would run. Using the popup here is
  // pragmatic: the extension's offscreen-document path relies on
  // `chrome.offscreen.createDocument` which only the background can invoke,
  // and Playwright's `context.newPage()` on the same URL doesn't get the
  // focus the Clipboard API requires. The popup is focused by construction,
  // so this exercises the actual `navigator.clipboard.writeText('')` call
  // the production clear script runs.
  await popup.evaluate(() => navigator.clipboard.writeText(''));
  const clipAfterClear = await popup.evaluate(() => navigator.clipboard.readText());
  expect(clipAfterClear).toBe('');
});
