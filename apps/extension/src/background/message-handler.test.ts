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

const { createMessageHandler } = await import('./message-handler.js');

// Helper to send a message
async function send(msg: BackgroundMessage): Promise<Record<string, unknown>> {
  const handler = currentHandler;
  return (await handler(msg)) as Record<string, unknown>;
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
    await send({ type: 'SET_PIN', pin: '1234' });

    // Lock
    await send({ type: 'LOCK' });

    // Unlock with PIN
    const result = await send({ type: 'UNLOCK_PIN', pin: '1234' });
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
      autoLockMinutes: 15,
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
