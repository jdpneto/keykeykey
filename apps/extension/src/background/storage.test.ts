/**
 * Tests for browser.storage.local persistence layer.
 *
 * The storage module imports `browser` from 'webextension-polyfill'.
 * We mock the module with vi.mock() so the polyfill (which requires a real
 * browser environment) is never executed during tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserMock } from '../lib/browser-mock.js';
import { DEFAULT_SETTINGS } from '../lib/messages.js';

const browserMock = createBrowserMock();

vi.mock('webextension-polyfill', () => ({ default: browserMock }));

const {
  loadVaultHeader,
  saveVaultHeader,
  loadEncryptedItems,
  saveEncryptedItem,
  deleteEncryptedItem,
  loadSettings,
  saveSettings,
  loadPinData,
  savePinData,
  updatePinAttempts,
  clearPinData,
  loadSyncConfig,
  saveSyncConfig,
  clearSyncConfig,
} = await import('./storage.js');

beforeEach(() => {
  browserMock._reset();
});

// ---------------------------------------------------------------------------
// Vault header
// ---------------------------------------------------------------------------

describe('loadVaultHeader / saveVaultHeader', () => {
  it('returns null when storage is empty', async () => {
    const result = await loadVaultHeader();
    expect(result).toBeNull();
  });

  it('round-trips a vault header string', async () => {
    const header = 'base64encodedvaultheader==';
    await saveVaultHeader(header);
    const loaded = await loadVaultHeader();
    expect(loaded).toBe(header);
  });

  it('overwrites a previous vault header', async () => {
    await saveVaultHeader('first-header');
    await saveVaultHeader('second-header');
    const loaded = await loadVaultHeader();
    expect(loaded).toBe('second-header');
  });
});

// ---------------------------------------------------------------------------
// Encrypted items
// ---------------------------------------------------------------------------

describe('loadEncryptedItems / saveEncryptedItem / deleteEncryptedItem', () => {
  it('returns empty object when storage is empty', async () => {
    const items = await loadEncryptedItems();
    expect(items).toEqual({});
  });

  it('saves an item with the item_ prefix', async () => {
    await saveEncryptedItem('abc-123', 'encryptedblob==');
    const items = await loadEncryptedItems();
    expect(items).toEqual({ 'abc-123': 'encryptedblob==' });
  });

  it('saves multiple items and returns all of them', async () => {
    await saveEncryptedItem('id-1', 'blob1==');
    await saveEncryptedItem('id-2', 'blob2==');
    const items = await loadEncryptedItems();
    expect(items).toEqual({ 'id-1': 'blob1==', 'id-2': 'blob2==' });
  });

  it('deletes an individual item by id', async () => {
    await saveEncryptedItem('id-1', 'blob1==');
    await saveEncryptedItem('id-2', 'blob2==');
    await deleteEncryptedItem('id-1');
    const items = await loadEncryptedItems();
    expect(items).toEqual({ 'id-2': 'blob2==' });
  });

  it('deleting a non-existent item does not throw', async () => {
    await expect(deleteEncryptedItem('does-not-exist')).resolves.not.toThrow();
  });

  it('non-item_ keys do not appear in loadEncryptedItems result', async () => {
    // Directly set an unrelated key to ensure it is filtered out.
    await browserMock.storage.local.set({ vault_header: 'header', item_x: 'blobx==' });
    const items = await loadEncryptedItems();
    expect(items).toEqual({ x: 'blobx==' });
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('loadSettings / saveSettings', () => {
  it('returns DEFAULT_SETTINGS when storage is empty', async () => {
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips settings', async () => {
    await saveSettings({ autoLockMode: 'never', autoLockMinutes: 0, themeMode: 'dark' });
    const settings = await loadSettings();
    expect(settings).toEqual({ autoLockMode: 'never', autoLockMinutes: 0, themeMode: 'dark' });
  });

  it('merges partial settings updates over existing settings', async () => {
    await saveSettings({ autoLockMode: 'never', autoLockMinutes: 0, themeMode: 'dark' });
    await saveSettings({ themeMode: 'light' });
    const settings = await loadSettings();
    expect(settings).toEqual({ autoLockMode: 'never', autoLockMinutes: 0, themeMode: 'light' });
  });

  it('merges partial updates over DEFAULT_SETTINGS when no prior save', async () => {
    await saveSettings({ themeMode: 'dark' });
    const settings = await loadSettings();
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, themeMode: 'dark' });
  });
});

// ---------------------------------------------------------------------------
// PIN data
// ---------------------------------------------------------------------------

describe('loadPinData / savePinData / updatePinAttempts / clearPinData', () => {
  const pinData = {
    pinHash: 'hashedpin==',
    salt: 'somesalt==',
    attemptsRemaining: 5,
  };

  it('returns null when storage is empty', async () => {
    const data = await loadPinData();
    expect(data).toBeNull();
  });

  it('round-trips pin data', async () => {
    await savePinData(pinData);
    const loaded = await loadPinData();
    expect(loaded).toEqual(pinData);
  });

  it('updatePinAttempts decrements attemptsRemaining', async () => {
    await savePinData(pinData);
    await updatePinAttempts(4);
    const loaded = await loadPinData();
    expect(loaded?.attemptsRemaining).toBe(4);
  });

  it('updatePinAttempts wipes pin data when attempts reach 0', async () => {
    await savePinData(pinData);
    await updatePinAttempts(0);
    const loaded = await loadPinData();
    expect(loaded).toBeNull();
  });

  it('clearPinData removes pin data', async () => {
    await savePinData(pinData);
    await clearPinData();
    const loaded = await loadPinData();
    expect(loaded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sync config
// ---------------------------------------------------------------------------

describe('loadSyncConfig / saveSyncConfig / clearSyncConfig', () => {
  it("returns default 'none' provider when storage is empty", async () => {
    const config = await loadSyncConfig();
    expect(config).toEqual({ provider: 'none' });
  });

  it('saves and loads sync config', async () => {
    const config = {
      provider: 'webdav' as const,
      webdav: {
        url: 'https://dav.example.com',
        username: 'alice',
        password: '',
      },
    };
    await saveSyncConfig(config);
    const loaded = await loadSyncConfig();
    expect(loaded).toEqual(config);
  });

  it('saves and loads google-drive config', async () => {
    await saveSyncConfig({ provider: 'google-drive' });
    const loaded = await loadSyncConfig();
    expect(loaded).toEqual({ provider: 'google-drive' });
  });

  it('clearSyncConfig resets to default none provider', async () => {
    await saveSyncConfig({ provider: 'google-drive' });
    await clearSyncConfig();
    const loaded = await loadSyncConfig();
    expect(loaded).toEqual({ provider: 'none' });
  });
});
