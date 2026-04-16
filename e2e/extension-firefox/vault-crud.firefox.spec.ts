/**
 * Firefox port of `e2e/extension/vault-crud.spec.ts`. Only the `@critical`
 * happy-path case is ported — the `@crud`-tagged detail/delete tests
 * weren't in the Chromium critical set either.
 */
import { afterEach, beforeEach, describe, test } from 'vitest';
import { startDriver, type DriverHandle } from './fixtures/driver.js';
import { addCredential, createVault, openPopup, waitForText } from './fixtures/flow.js';

let handle: DriverHandle | null = null;

beforeEach(async () => {
  handle = await startDriver();
  await openPopup(handle.driver);
});

afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

describe('Vault CRUD (Firefox)', () => {
  test('should add a credential', async () => {
    const driver = handle!.driver;
    await createVault(driver, 'TestPassword123!');
    await addCredential(driver, {
      name: 'GitHub',
      username: 'testuser',
      password: 'secretpass123',
    });
    // `addCredential` already waits for the item to appear; belt-and-braces
    // check to catch a regression where the list doesn't refresh.
    await waitForText(driver, 'github', 10_000);
  });
});
