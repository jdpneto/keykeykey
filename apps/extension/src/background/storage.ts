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
import type { Settings, SyncConfig, SyncProvider } from '../lib/messages.js';

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
// Sync config
// ---------------------------------------------------------------------------

const DEFAULT_SYNC_CONFIG: SyncConfig = { provider: 'none' as SyncProvider };

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
