/**
 * browser.storage.local persistence layer for KeyKeyKey extension.
 *
 * Key layout:
 *   vault_header       — serialised vault header string (base64)
 *   item_<id>          — encrypted vault item blob (one key per item)
 *   settings           — JSON-serialised Settings object
 *   pin_data           — JSON-serialised PinData object
 *   sync_config        — JSON-serialised SyncConfig object
 */

import browser from 'webextension-polyfill';
import { DEFAULT_SETTINGS } from '../lib/messages.js';
import type { Settings, SyncConfig } from '../lib/messages.js';
import { encryptSyncConfig, decryptSyncConfig, DEFAULT_SYNC_CONFIG } from '@keykeykey/core/sync';
import type { PlatformStorage } from '@keykeykey/core/sync';
import { toBase64, fromBase64 } from '@keykeykey/core/utils';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const KEY_VAULT_HEADER = 'vault_header';
const KEY_SETTINGS = 'settings';
const KEY_PIN_DATA = 'pin_data';
const KEY_SYNC_CONFIG = 'sync_config';
const ITEM_PREFIX = 'item_';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PinData {
  pinHash: string;
  salt: string;
  attemptsRemaining: number;
}

// ---------------------------------------------------------------------------
// Vault header
// ---------------------------------------------------------------------------

export async function loadVaultHeader(): Promise<string | null> {
  const result = await browser.storage.local.get(KEY_VAULT_HEADER);
  const value = result[KEY_VAULT_HEADER];
  return typeof value === 'string' ? value : null;
}

export async function saveVaultHeader(header: string): Promise<void> {
  await browser.storage.local.set({ [KEY_VAULT_HEADER]: header });
}

// ---------------------------------------------------------------------------
// Encrypted items  (one key per item: item_<id>)
// ---------------------------------------------------------------------------

export async function loadEncryptedItems(): Promise<Record<string, string>> {
  // Fetch everything and filter to item_ keys.
  const all = await browser.storage.local.get(null);
  const items: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(ITEM_PREFIX) && typeof value === 'string') {
      items[key.slice(ITEM_PREFIX.length)] = value;
    }
  }
  return items;
}

export async function saveEncryptedItem(id: string, blob: string): Promise<void> {
  await browser.storage.local.set({ [`${ITEM_PREFIX}${id}`]: blob });
}

export async function deleteEncryptedItem(id: string): Promise<void> {
  await browser.storage.local.remove(`${ITEM_PREFIX}${id}`);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function loadSettings(): Promise<Settings> {
  const result = await browser.storage.local.get(KEY_SETTINGS);
  const stored = result[KEY_SETTINGS];
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(updates: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  const merged: Settings = { ...current, ...updates };
  await browser.storage.local.set({ [KEY_SETTINGS]: merged });
}

// ---------------------------------------------------------------------------
// PIN data
// ---------------------------------------------------------------------------

export async function loadPinData(): Promise<PinData | null> {
  const result = await browser.storage.local.get(KEY_PIN_DATA);
  const stored = result[KEY_PIN_DATA];
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return stored as PinData;
  }
  return null;
}

export async function savePinData(data: PinData): Promise<void> {
  await browser.storage.local.set({ [KEY_PIN_DATA]: data });
}

export async function updatePinAttempts(attemptsRemaining: number): Promise<void> {
  if (attemptsRemaining <= 0) {
    await clearPinData();
    return;
  }
  const current = await loadPinData();
  if (current === null) return;
  await savePinData({ ...current, attemptsRemaining });
}

export async function clearPinData(): Promise<void> {
  await browser.storage.local.remove(KEY_PIN_DATA);
}

// ---------------------------------------------------------------------------
// Sync config (legacy unencrypted — kept for migration)
// ---------------------------------------------------------------------------

export async function loadSyncConfig(): Promise<SyncConfig> {
  const result = await browser.storage.local.get(KEY_SYNC_CONFIG);
  const stored = result[KEY_SYNC_CONFIG];
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return stored as SyncConfig;
  }
  return { ...DEFAULT_SYNC_CONFIG };
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await browser.storage.local.set({ [KEY_SYNC_CONFIG]: config });
}

export async function clearSyncConfig(): Promise<void> {
  await browser.storage.local.remove(KEY_SYNC_CONFIG);
}

// ---------------------------------------------------------------------------
// Sync config (encrypted with DEK)
// ---------------------------------------------------------------------------

const KEY_SYNC_CONFIG_ENCRYPTED = 'sync_config_encrypted';

export async function saveSyncConfigEncrypted(config: SyncConfig, dek: Uint8Array): Promise<void> {
  const encrypted = encryptSyncConfig(config, dek);
  const base64 = toBase64(encrypted);
  await browser.storage.local.set({ [KEY_SYNC_CONFIG_ENCRYPTED]: base64 });
}

export async function clearSyncConfigEncrypted(): Promise<void> {
  await browser.storage.local.remove(KEY_SYNC_CONFIG_ENCRYPTED);
}

export async function loadSyncConfigEncrypted(dek: Uint8Array): Promise<SyncConfig> {
  const result = await browser.storage.local.get(KEY_SYNC_CONFIG_ENCRYPTED);
  const base64 = result[KEY_SYNC_CONFIG_ENCRYPTED];
  if (!base64 || typeof base64 !== 'string') return { ...DEFAULT_SYNC_CONFIG };
  try {
    const data = fromBase64(base64);
    return decryptSyncConfig(data, dek);
  } catch {
    return { ...DEFAULT_SYNC_CONFIG };
  }
}

// ---------------------------------------------------------------------------
// Sync config migration (flat unencrypted → nested encrypted)
// ---------------------------------------------------------------------------

export async function migrateSyncConfig(dek: Uint8Array): Promise<SyncConfig> {
  // Check for new encrypted format first
  const encrypted = await loadSyncConfigEncrypted(dek);
  if (encrypted.provider !== 'none') return encrypted;

  // Check for old unencrypted flat format
  const result = await browser.storage.local.get(KEY_SYNC_CONFIG);
  const old = result[KEY_SYNC_CONFIG] as Record<string, unknown> | undefined;
  if (!old || typeof old !== 'object' || old.provider === 'none') {
    return { ...DEFAULT_SYNC_CONFIG };
  }

  // Convert flat to nested
  const config: SyncConfig = { provider: old.provider as SyncConfig['provider'] };
  if (old.provider === 'webdav') {
    config.webdav = {
      url: (old.webdavUrl as string) ?? '',
      username: (old.webdavUsername as string) ?? '',
      password: (old.webdavPassword as string) ?? '',
    };
  }

  // Save in new format and delete old
  await saveSyncConfigEncrypted(config, dek);
  await browser.storage.local.remove(KEY_SYNC_CONFIG);

  return config;
}

// ---------------------------------------------------------------------------
// PlatformStorage implementation for SyncLifecycle
// ---------------------------------------------------------------------------

const KEY_VAULT_SETUP_COMPLETE = 'vault_setup_complete';

export function createExtensionPlatformStorage(): PlatformStorage {
  return {
    async loadSyncConfigFile(): Promise<Uint8Array | null> {
      const result = await browser.storage.local.get(KEY_SYNC_CONFIG_ENCRYPTED);
      const base64 = result[KEY_SYNC_CONFIG_ENCRYPTED];
      if (!base64 || typeof base64 !== 'string') return null;
      return fromBase64(base64);
    },

    async saveSyncConfigFile(data: Uint8Array): Promise<void> {
      const base64 = toBase64(data);
      await browser.storage.local.set({ [KEY_SYNC_CONFIG_ENCRYPTED]: base64 });
    },

    async deleteSyncConfigFile(): Promise<void> {
      await browser.storage.local.remove(KEY_SYNC_CONFIG_ENCRYPTED);
    },

    async saveEncryptedItem(
      id: string,
      _type: string,
      encryptedBase64: string,
      _createdAt: string,
      _updatedAt: string,
    ): Promise<void> {
      // Store as plain base64 string under item_<id> for backward compatibility
      // with the existing loadEncryptedItems / saveEncryptedItem functions.
      await browser.storage.local.set({ [`${ITEM_PREFIX}${id}`]: encryptedBase64 });
    },

    async loadAllEncryptedItems(): Promise<Array<{ id: string; encrypted_data: string }>> {
      const all = await browser.storage.local.get(null);
      const items: Array<{ id: string; encrypted_data: string }> = [];
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith(ITEM_PREFIX) && typeof value === 'string') {
          items.push({ id: key.slice(ITEM_PREFIX.length), encrypted_data: value });
        }
      }
      return items;
    },

    async deleteAllItems(): Promise<void> {
      const all = await browser.storage.local.get(null);
      const itemKeys = Object.keys(all).filter((k) => k.startsWith(ITEM_PREFIX));
      if (itemKeys.length > 0) {
        await browser.storage.local.remove(itemKeys);
      }
    },

    async saveVaultHeader(headerBase64: string): Promise<void> {
      await browser.storage.local.set({ [KEY_VAULT_HEADER]: headerBase64 });
    },

    async loadVaultHeader(): Promise<string | null> {
      const result = await browser.storage.local.get(KEY_VAULT_HEADER);
      const value = result[KEY_VAULT_HEADER];
      return typeof value === 'string' ? value : null;
    },

    async setVaultSetupComplete(complete: boolean): Promise<void> {
      await browser.storage.local.set({ [KEY_VAULT_SETUP_COMPLETE]: complete });
    },
  };
}
