import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Password history (Chromium)', () => {
  test.beforeEach(async ({ popup }) => {
    await setupAndUnlock(popup);
  });

  test('restores a previous password and updates the history list @critical', async ({ popup }) => {
    // 1. Add a credential with password 'p1'.
    await popup.getByLabel('Add item').click();
    await popup.getByPlaceholder('Item name').fill('GitHub');
    await popup.getByPlaceholder('user@example.com').fill('me');
    await popup.getByPlaceholder('Password').fill('p1');
    await popup.getByRole('button', { name: /^save$/i }).click();
    await expect(popup.getByText('GitHub')).toBeVisible({ timeout: 10_000 });

    // 2. Open detail → click Edit → change to 'p2'.
    //    After save, EditItemScreen calls onBack() which goes back to the list.
    await popup.getByText('GitHub').click();
    await popup.getByRole('button', { name: /^edit$/i }).click();
    await popup.getByPlaceholder('Password').fill('p2');
    await popup.getByRole('button', { name: /^save$/i }).click();
    await expect(popup.getByText('GitHub')).toBeVisible({ timeout: 5_000 });

    // 3. Edit again → change to 'p3'.
    //    Re-open detail from the list first.
    await popup.getByText('GitHub').click();
    await expect(popup.getByRole('button', { name: /^edit$/i })).toBeVisible({ timeout: 5_000 });
    await popup.getByRole('button', { name: /^edit$/i }).click();
    await popup.getByPlaceholder('Password').fill('p3');
    await popup.getByRole('button', { name: /^save$/i }).click();
    await expect(popup.getByText('GitHub')).toBeVisible({ timeout: 5_000 });

    // 4. History is now [p1, p2]; current is p3.
    //    Open detail, expand the history section.
    await popup.getByText('GitHub').click();
    await expect(popup.getByText(/Password History \(2\)/i)).toBeVisible({ timeout: 5_000 });
    // The section toggle 'Show' button is the last 'Show' on screen
    // (the password field's 'Show' button comes first).
    const showButtons = popup.getByRole('button', { name: /^show$/i });
    await showButtons.last().click();
    // Section is now expanded; its toggle changes to 'Hide'.
    await expect(popup.getByRole('button', { name: /^hide$/i })).toBeVisible({ timeout: 3_000 });

    // 5. Click Restore on the first history row.
    //    Reversed list displays [p2 (idx1), p1 (idx0)], so first row = p2.
    //    The button has aria-label="Restore this password".
    await popup.getByRole('button', { name: 'Restore this password' }).first().click();

    // 6. Brief inline feedback: visible text changes to 'Restored!' for ~1.5 s.
    await expect(
      popup.getByRole('button', { name: 'Restore this password' }).first(),
    ).toContainText('Restored!', { timeout: 3_000 });

    // 7. Wait for the feedback label to reset ('Restored!' → 'Restore').
    //    This confirms the 1.5 s timer fired and state settled.
    //    toHaveText(/^Restore$/) is an exact match: 'Restored!' does NOT match,
    //    so the assertion only passes after the timer fires and resets the label.
    await expect(popup.getByRole('button', { name: 'Restore this password' }).first()).toHaveText(
      /^Restore$/,
      { timeout: 4_000 },
    );

    // The history count is still 2 (p2 is now current; history = [p1, p3]).
    await expect(popup.getByText(/Password History \(2\)/i)).toBeVisible();

    // 8. Navigate back to the list and re-open the detail to get a fresh item
    //    (onRefresh only updates vault status, not the cached items array).
    //    Re-opening the detail triggers loadItems() which re-fetches from the store.
    await popup.getByLabel('Back').click();
    await expect(popup.getByText('GitHub')).toBeVisible({ timeout: 5_000 });
    await popup.getByText('GitHub').click();

    // 9. Confirm the new current password is p2 (restore swapped it in).
    //    Reveal the password field to verify.
    await expect(popup.getByText(/Password History \(2\)/i)).toBeVisible({ timeout: 5_000 });
    // There are two 'Show' buttons: password field (first) and section toggle (last).
    const freshShowButtons = popup.getByRole('button', { name: /^show$/i });
    // Reveal the main password field.
    await freshShowButtons.first().click();
    await expect(popup.getByText('p2')).toBeVisible({ timeout: 3_000 });

    // 10. Expand history and verify it contains p1 and p3 (not p2).
    //     After step 9 the password field is revealed ('Hide'), so the section
    //     toggle is the only remaining 'Show' button.
    await popup
      .getByRole('button', { name: /^show$/i })
      .last()
      .click();
    // Section is now expanded — two 'Hide' buttons are on screen (password
    // field + section toggle). Use .first() to avoid strict-mode violation.
    await expect(popup.getByRole('button', { name: /^hide$/i }).first()).toBeVisible({
      timeout: 3_000,
    });

    // Reveal each history row by clicking 'Show' buttons one at a time.
    // After expansion there are 2 per-row Show buttons: [p3 row, p1 row].
    // Clicking first() repeatedly resolves the locator fresh each time.
    await popup
      .getByRole('button', { name: /^show$/i })
      .first()
      .click();
    await popup
      .getByRole('button', { name: /^show$/i })
      .first()
      .click();

    await expect(popup.getByText('p1')).toBeVisible({ timeout: 5_000 });
    await expect(popup.getByText('p3')).toBeVisible({ timeout: 5_000 });
  });
});
