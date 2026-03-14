import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Vault CRUD', () => {
  test.beforeEach(async ({ popup }) => {
    await setupAndUnlock(popup);
  });

  test('should add a credential @critical', async ({ popup }) => {
    // Click add button
    await popup.getByRole('button', { name: /\+|add/i }).click();

    // Fill credential form
    await popup.getByPlaceholder(/name/i).first().fill('GitHub');
    await popup.getByPlaceholder(/username/i).fill('testuser');
    await popup.getByPlaceholder(/password/i).first().fill('secretpass123');

    // Save
    await popup.getByRole('button', { name: /save/i }).click();

    // Should return to list with the new item
    await expect(popup.getByText('GitHub')).toBeVisible({ timeout: 5_000 });
  });

  test('should view credential detail @crud', async ({ popup }) => {
    // Add an item first
    await popup.getByRole('button', { name: /\+|add/i }).click();
    await popup.getByPlaceholder(/name/i).first().fill('TestSite');
    await popup.getByPlaceholder(/username/i).fill('myuser');
    await popup.getByPlaceholder(/password/i).first().fill('mypass');
    await popup.getByRole('button', { name: /save/i }).click();

    // Click the item to see detail
    await popup.getByText('TestSite').click();

    // Should show detail screen with fields
    await expect(popup.getByText('myuser')).toBeVisible();
  });

  test('should delete a credential @crud', async ({ popup }) => {
    // Add an item
    await popup.getByRole('button', { name: /\+|add/i }).click();
    await popup.getByPlaceholder(/name/i).first().fill('ToDelete');
    await popup.getByPlaceholder(/username/i).fill('user');
    await popup.getByPlaceholder(/password/i).first().fill('pass');
    await popup.getByRole('button', { name: /save/i }).click();
    await expect(popup.getByText('ToDelete')).toBeVisible();

    // Open detail
    await popup.getByText('ToDelete').click();

    // Delete with confirmation
    await popup.getByRole('button', { name: /delete/i }).click();
    // Confirm dialog
    await popup.getByRole('button', { name: /confirm|yes|delete/i }).last().click();

    // Should return to list without the item
    await expect(popup.getByText('ToDelete')).not.toBeVisible({ timeout: 5_000 });
  });
});
