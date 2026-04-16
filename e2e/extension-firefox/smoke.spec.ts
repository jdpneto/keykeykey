/**
 * Minimum signal that the Firefox harness loads the extension and can
 * navigate to its popup URL. If this passes, the profile/UUID/pref plumbing
 * is working; the real specs live in the other files in this directory.
 */
import { test, expect } from './fixtures/extension.js';

test('@critical popup renders the setup form in Firefox', async ({ popup }) => {
  await expect(popup.getByPlaceholder(/at least 8 characters/i)).toBeVisible({
    timeout: 30_000,
  });
});
