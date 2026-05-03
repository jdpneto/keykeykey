import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Vault CRUD', () => {
  test.beforeEach(async ({ popup }) => {
    await setupAndUnlock(popup);
  });

  test('should add a credential @critical', async ({ popup }) => {
    // Click add button — the FAB has aria-label="Add item"
    await popup.getByLabel('Add item').click();

    // Fill credential form
    await popup.getByPlaceholder('Item name').fill('GitHub');
    await popup.getByPlaceholder('user@example.com').fill('testuser');
    await popup.getByPlaceholder('Password').fill('secretpass123');

    // Save
    await popup.getByRole('button', { name: /^save$/i }).click();

    // Should return to list with the new item
    await expect(popup.getByText('GitHub')).toBeVisible({ timeout: 10_000 });
  });

  test('should view credential detail @crud', async ({ popup }) => {
    // Add an item first
    await popup.getByLabel('Add item').click();
    await popup.getByPlaceholder('Item name').fill('TestSite');
    await popup.getByPlaceholder('user@example.com').fill('myuser');
    await popup.getByPlaceholder('Password').fill('mypass');
    await popup.getByRole('button', { name: /^save$/i }).click();

    // Click the item to see detail
    await popup.getByText('TestSite').click();

    // Should show detail screen with fields
    await expect(popup.getByText('myuser')).toBeVisible();
  });

  test('should delete a credential @critical @crud', async ({ popup }) => {
    // Add an item
    await popup.getByLabel('Add item').click();
    await popup.getByPlaceholder('Item name').fill('ToDelete');
    await popup.getByPlaceholder('user@example.com').fill('user');
    await popup.getByPlaceholder('Password').fill('pass');
    await popup.getByRole('button', { name: /^save$/i }).click();
    await expect(popup.getByText('ToDelete')).toBeVisible({ timeout: 10_000 });

    // Open detail
    await popup.getByText('ToDelete').click();

    // Delete — first click shows confirmation dialog
    await popup.getByRole('button', { name: /^delete$/i }).click();
    // Confirm dialog appears — click the red "Delete" button
    await popup
      .getByRole('button', { name: /^delete$/i })
      .last()
      .click();

    // Should return to list without the item — vault is empty after deletion
    await expect(popup.getByText(/no items yet/i)).toBeVisible({ timeout: 10_000 });
  });
});
