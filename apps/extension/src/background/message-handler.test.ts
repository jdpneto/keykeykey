/**
 * Tests for the background message handler.
 *
 * The handler orchestrates the vault store, storage persistence, auto-lock,
 * and responds to popup messages. We mock the browser APIs and use fast
 * Argon2 params by mocking the core crypto constants.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserMock } from '../lib/browser-mock.js';
import type { BackgroundMessage } from '../lib/messages.js';

// --- Browser mock ---
const browserMock = createBrowserMock();
vi.mock('webextension-polyfill', () => ({ default: browserMock }));

// --- Speed up Argon2id for tests (override ARGON2_PRESETS.browser) ---
vi.mock('@keykeykey/core/crypto', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ARGON2_PRESETS: {
      ...(actual.ARGON2_PRESETS as Record<string, unknown>),
      browser: { t: 1, m: 1024, p: 1, dkLen: 32 },
    },
  };
});

const { createMessageHandler, tabAllowlists } = await import('./message-handler.js');

type Sender = { tab?: { id?: number; url?: string } };

// Helper to send a message
async function send(msg: BackgroundMessage, sender?: Sender): Promise<Record<string, unknown>> {
  const handler = currentHandler;
  return (await handler(msg, sender as never)) as Record<string, unknown>;
}

let currentHandler: ReturnType<typeof createMessageHandler>;

beforeEach(() => {
  browserMock._reset();
  currentHandler = createMessageHandler();
});

// ---------------------------------------------------------------------------
// GET_STATUS — needs_setup when no vault header
// ---------------------------------------------------------------------------

describe('GET_STATUS', () => {
  it('returns needs_setup when no vault header exists', async () => {
    const result = await send({ type: 'GET_STATUS' });
    expect(result).toEqual({
      status: 'needs_setup',
      hasPIN: false,
      itemCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// SETUP — creates vault, returns recovery key
// ---------------------------------------------------------------------------

describe('SETUP', () => {
  it('creates a vault and returns recovery key', async () => {
    const result = await send({ type: 'SETUP', password: 'TestPass123!' });

    expect(result).toHaveProperty('recoveryKey');
    expect(typeof result.recoveryKey).toBe('string');
    expect((result.recoveryKey as string).length).toBeGreaterThan(0);

    // After setup, status should be unlocked
    const status = await send({ type: 'GET_STATUS' });
    expect(status.status).toBe('unlocked');
  });
});

// ---------------------------------------------------------------------------
// LOCK → GET_STATUS returns locked
// ---------------------------------------------------------------------------

describe('LOCK', () => {
  it('locks the vault and status becomes locked', { timeout: 30_000 }, async () => {
    await send({ type: 'SETUP', password: 'TestPass123!' });

    const lockResult = await send({ type: 'LOCK' });
    expect(lockResult).toEqual({ ok: true });

    const status = await send({ type: 'GET_STATUS' });
    expect(status.status).toBe('locked');
  });
});

// ---------------------------------------------------------------------------
// UNLOCK
// ---------------------------------------------------------------------------

describe('UNLOCK', () => {
  it('unlocks with correct password', async () => {
    await send({ type: 'SETUP', password: 'TestPass123!' });
    await send({ type: 'LOCK' });

    const result = await send({ type: 'UNLOCK', password: 'TestPass123!' });
    expect(result).toEqual({ ok: true });

    const status = await send({ type: 'GET_STATUS' });
    expect(status.status).toBe('unlocked');
  });

  it('returns error with wrong password', async () => {
    await send({ type: 'SETUP', password: 'TestPass123!' });
    await send({ type: 'LOCK' });

    const result = await send({ type: 'UNLOCK', password: 'WrongPassword!' });
    expect(result).toHaveProperty('error');
    expect(typeof result.error).toBe('string');
  });

  it('returns friendly error when password is wrong (invalid tag)', async () => {
    await send({ type: 'SETUP', password: 'TestPass123!' });
    await send({ type: 'LOCK' });

    // Wrong password triggers "invalid tag" from @noble/ciphers Poly1305 verification
    const result = await send({ type: 'UNLOCK', password: 'WrongPassword!' });
    expect(result.error).toBe('Incorrect master password.');
  });
});

// ---------------------------------------------------------------------------
// ADD_ITEM + GET_ITEMS
// ---------------------------------------------------------------------------

describe('ADD_ITEM and GET_ITEMS', () => {
  it('adds an item and retrieves it', async () => {
    await send({ type: 'SETUP', password: 'TestPass123!' });

    const addResult = await send({
      type: 'ADD_ITEM',
      item: {
        type: 'credential',
        name: 'GitHub',
        username: 'user@example.com',
        password: 'secret123',
        url: 'https://github.com',
        notes: '',
        tags: [],
        favorite: false,
      },
    });
    expect(addResult).toHaveProperty('id');

    const getResult = await send({ type: 'GET_ITEMS' });
    const items = getResult.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe('GitHub');
  });
});

// ---------------------------------------------------------------------------
// SEARCH
// ---------------------------------------------------------------------------

describe('SEARCH', () => {
  it('finds matching items', async () => {
    await send({ type: 'SETUP', password: 'TestPass123!' });

    await send({
      type: 'ADD_ITEM',
      item: {
        type: 'credential',
        name: 'GitHub',
        username: 'user@example.com',
        password: 'secret123',
        url: 'https://github.com',
        notes: '',
        tags: [],
        favorite: false,
      },
    });

    await send({
      type: 'ADD_ITEM',
      item: {
        type: 'credential',
        name: 'GitLab',
        username: 'admin@example.com',
        password: 'secret456',
        url: 'https://gitlab.com',
        notes: '',
        tags: [],
        favorite: false,
      },
    });

    const result = await send({ type: 'SEARCH', query: 'GitHub' });
    const items = result.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe('GitHub');
  });
});

// ---------------------------------------------------------------------------
// DELETE_ITEM
// ---------------------------------------------------------------------------

describe('DELETE_ITEM', () => {
  it('removes an item', async () => {
    await send({ type: 'SETUP', password: 'TestPass123!' });

    const addResult = await send({
      type: 'ADD_ITEM',
      item: {
        type: 'credential',
        name: 'ToDelete',
        username: 'user',
        password: 'pass',
        url: 'https://example.com',
        notes: '',
        tags: [],
        favorite: false,
      },
    });

    const deleteResult = await send({ type: 'DELETE_ITEM', id: addResult.id as string });
    expect(deleteResult).toEqual({ ok: true });

    const getResult = await send({ type: 'GET_ITEMS' });
    const items = getResult.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// UNLOCK_PIN
// ---------------------------------------------------------------------------

describe('UNLOCK_PIN', () => {
  it('should unlock with correct PIN', async () => {
    // Setup vault
    await send({ type: 'SETUP', password: 'TestPassword123!' });

    // Set PIN
    await send({ type: 'SET_PIN', pin: '4829' });

    // Lock
    await send({ type: 'LOCK' });

    // Unlock with PIN
    const result = await send({ type: 'UNLOCK_PIN', pin: '4829' });
    expect(result.success).toBe(true);

    // Verify actually unlocked
    const status = await send({ type: 'GET_STATUS' });
    expect(status.status).toBe('unlocked');
  });
});

// ---------------------------------------------------------------------------
// GENERATE_PASSWORD
// ---------------------------------------------------------------------------

describe('GENERATE_PASSWORD', () => {
  it('returns a password and entropy', async () => {
    const result = await send({
      type: 'GENERATE_PASSWORD',
      options: { mode: 'random', length: 16 },
    });
    expect(typeof result.password).toBe('string');
    expect((result.password as string).length).toBe(16);
    expect(typeof result.entropy).toBe('number');
    expect(result.entropy as number).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GET_ACTIVE_TAB_URL
// ---------------------------------------------------------------------------

describe('GET_ACTIVE_TAB_URL', () => {
  it('returns the active tab URL', async () => {
    const result = await send({ type: 'GET_ACTIVE_TAB_URL' });
    expect(result.url).toBe('https://github.com/user/repo');
  });
});

// ---------------------------------------------------------------------------
// GET_SETTINGS and UPDATE_SETTINGS
// ---------------------------------------------------------------------------

describe('Settings', () => {
  it('returns default settings', async () => {
    const result = await send({ type: 'GET_SETTINGS' });
    expect(result.settings).toEqual({
      autoLockMode: 'timed',
      autoLockMinutes: 60,
      themeMode: 'system',
    });
  });

  it('persists updated settings', async () => {
    const updateResult = await send({
      type: 'UPDATE_SETTINGS',
      settings: { autoLockMinutes: 5 },
    });
    expect(updateResult).toEqual({ ok: true });

    const result = await send({ type: 'GET_SETTINGS' });
    expect((result.settings as Record<string, unknown>).autoLockMinutes).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Helper: set up vault with a test credential, returns the credential id
// ---------------------------------------------------------------------------

async function setupVaultWithCredential(): Promise<string> {
  await send({ type: 'SETUP', password: 'TestPass123!' });
  const addResult = await send({
    type: 'ADD_ITEM',
    item: {
      type: 'credential',
      name: 'GitHub',
      username: 'user@example.com',
      password: 'secret123',
      url: 'https://github.com',
      notes: '',
      tags: [],
      favorite: false,
    },
  });
  return addResult.id as string;
}

// ---------------------------------------------------------------------------
// GET_CREDENTIALS_FOR_TAB
// ---------------------------------------------------------------------------

describe('GET_CREDENTIALS_FOR_TAB', () => {
  it('returns count of matching credentials for hostname', async () => {
    await setupVaultWithCredential();
    const result = await send({ type: 'GET_CREDENTIALS_FOR_TAB', hostname: 'github.com' });
    expect(result.count).toBe(1);
  });

  it('returns 0 for unmatched hostname', async () => {
    await setupVaultWithCredential();
    const result = await send({ type: 'GET_CREDENTIALS_FOR_TAB', hostname: 'unknown.com' });
    expect(result.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET_MATCHING_CREDENTIALS
// ---------------------------------------------------------------------------

describe('GET_MATCHING_CREDENTIALS', () => {
  it('returns credentials without passwords', async () => {
    await setupVaultWithCredential();
    const result = await send(
      { type: 'GET_MATCHING_CREDENTIALS', hostname: 'github.com' },
      { tab: { id: 100, url: 'https://github.com/login' } },
    );
    const creds = result.credentials as { id: string; name: string; username: string }[];
    expect(creds).toHaveLength(1);
    expect(creds[0]).toHaveProperty('id');
    expect(creds[0]).toHaveProperty('name', 'GitHub');
    expect(creds[0]).toHaveProperty('username', 'user@example.com');
    expect(creds[0]).not.toHaveProperty('password');
  });

  it('populates tab allowlist', async () => {
    const credId = await setupVaultWithCredential();
    tabAllowlists.clear();
    await send(
      { type: 'GET_MATCHING_CREDENTIALS', hostname: 'github.com' },
      { tab: { id: 200, url: 'https://github.com/login' } },
    );
    expect(tabAllowlists.has(200)).toBe(true);
    expect(tabAllowlists.get(200)!.has(credId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FILL_CREDENTIAL
// ---------------------------------------------------------------------------

describe('FILL_CREDENTIAL', () => {
  it('returns username and password for valid ID in allowlist', async () => {
    const credId = await setupVaultWithCredential();
    // Populate allowlist
    await send(
      { type: 'GET_MATCHING_CREDENTIALS', hostname: 'github.com' },
      { tab: { id: 300, url: 'https://github.com/login' } },
    );
    const result = await send(
      { type: 'FILL_CREDENTIAL', id: credId },
      { tab: { id: 300, url: 'https://github.com/login' } },
    );
    expect(result.username).toBe('user@example.com');
    expect(result.password).toBe('secret123');
  });

  it('rejects when vault is locked', async () => {
    const credId = await setupVaultWithCredential();
    await send({ type: 'LOCK' });
    const result = await send(
      { type: 'FILL_CREDENTIAL', id: credId },
      { tab: { id: 300, url: 'https://github.com/login' } },
    );
    expect(result.error).toBe('Vault is locked');
  });

  it('rejects when ID not in allowlist', async () => {
    await setupVaultWithCredential();
    tabAllowlists.clear();
    const result = await send(
      { type: 'FILL_CREDENTIAL', id: 'nonexistent-id' },
      { tab: { id: 300, url: 'https://github.com/login' } },
    );
    expect(result).toHaveProperty('error');
  });

  it('rejects when sender domain does not match credential domain', async () => {
    const credId = await setupVaultWithCredential();
    // Manually populate allowlist to bypass GET_MATCHING_CREDENTIALS domain filter
    tabAllowlists.set(400, new Set([credId]));
    const result = await send(
      { type: 'FILL_CREDENTIAL', id: credId },
      { tab: { id: 400, url: 'https://evil.com/phish' } },
    );
    expect(result.error).toBe('Domain mismatch');
  });
});

// ---------------------------------------------------------------------------
// CHECK_CREDENTIAL_EXISTS
// ---------------------------------------------------------------------------

describe('CHECK_CREDENTIAL_EXISTS', () => {
  it('returns exists:false for new credential', async () => {
    await setupVaultWithCredential();
    const result = await send({
      type: 'CHECK_CREDENTIAL_EXISTS',
      hostname: 'github.com',
      username: 'newuser@example.com',
      password: 'newpass',
    });
    expect(result.exists).toBe(false);
    expect(result.changed).toBe(false);
  });

  it('returns exists:true,changed:false for unchanged credential', async () => {
    await setupVaultWithCredential();
    const result = await send({
      type: 'CHECK_CREDENTIAL_EXISTS',
      hostname: 'github.com',
      username: 'user@example.com',
      password: 'secret123',
    });
    expect(result.exists).toBe(true);
    expect(result.changed).toBe(false);
  });

  it('returns exists:true,changed:true for changed password', async () => {
    await setupVaultWithCredential();
    const result = await send({
      type: 'CHECK_CREDENTIAL_EXISTS',
      hostname: 'github.com',
      username: 'user@example.com',
      password: 'newpassword',
    });
    expect(result.exists).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.credentialId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SAVE_CREDENTIAL
// ---------------------------------------------------------------------------

describe('SAVE_CREDENTIAL', () => {
  it('adds credential to vault', async () => {
    await setupVaultWithCredential();
    const result = await send(
      {
        type: 'SAVE_CREDENTIAL',
        url: 'https://gitlab.com',
        username: 'admin@gitlab.com',
        password: 'gitlabpass',
        name: 'gitlab.com',
      },
      { tab: { id: 500, url: 'https://gitlab.com/login' } },
    );
    expect(result.success).toBe(true);

    const items = await send({ type: 'GET_ITEMS' });
    const allItems = items.items as Array<Record<string, unknown>>;
    expect(allItems).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// UPDATE_CREDENTIAL
// ---------------------------------------------------------------------------

describe('UPDATE_CREDENTIAL', () => {
  it('updates credential password', async () => {
    const credId = await setupVaultWithCredential();
    const result = await send(
      {
        type: 'UPDATE_CREDENTIAL',
        credentialId: credId,
        password: 'updatedPassword!',
      },
      { tab: { id: 600, url: 'https://github.com/settings' } },
    );
    expect(result.success).toBe(true);

    const items = await send({ type: 'GET_ITEMS' });
    const allItems = items.items as Array<Record<string, unknown>>;
    const updated = allItems.find((i) => i.id === credId);
    expect(updated).toBeDefined();
    expect(updated!.password).toBe('updatedPassword!');
  });
});

// ---------------------------------------------------------------------------
// RESET_VAULT
// ---------------------------------------------------------------------------

describe('RESET_VAULT', () => {
  it('should reset vault and clear all storage', async () => {
    // First setup a vault
    await send({ type: 'SETUP', password: 'TestPassword123!' });
    // Then reset
    const result = await send({ type: 'RESET_VAULT' });
    expect(result).toEqual({ ok: true });
    // Verify status is now needs_setup
    const status = await send({ type: 'GET_STATUS' });
    expect(status.status).toBe('needs_setup');
  });

  it('should reject RESET_VAULT from content scripts', async () => {
    await send({ type: 'SETUP', password: 'TestPassword123!' });
    // Content scripts have sender.tab set
    const result = await send({ type: 'RESET_VAULT' }, {
      tab: { id: 1, url: 'https://evil.com' },
    } as Sender);
    expect(result).toHaveProperty('error');
    // Vault should still exist
    const status = await send({ type: 'GET_STATUS' });
    expect(status.status).not.toBe('needs_setup');
  });
});
