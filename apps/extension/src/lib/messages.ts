import type { VaultItem } from '@keykeykey/core';
import type { PasswordGeneratorOptions } from '@keykeykey/core';

// ---------------------------------------------------------------------------
// Item data types matching core store signatures
// ---------------------------------------------------------------------------

export type NewItemData = Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>;
export type ItemUpdates = Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type AutoLockMode = 'timed' | 'browser_close' | 'never';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface Settings {
  autoLockMode: AutoLockMode;
  autoLockMinutes: number;
  themeMode: ThemeMode;
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMode: 'timed',
  autoLockMinutes: 15,
  themeMode: 'system',
};

// ---------------------------------------------------------------------------
// Sync config
// ---------------------------------------------------------------------------

export type SyncProvider = 'google-drive' | 'icloud' | 'webdav' | 'none';

export interface SyncConfig {
  provider: SyncProvider;
  webdavUrl?: string;
  webdavUsername?: string;
}

export interface SyncStatus {
  provider: SyncProvider;
  lastSynced: string | null;
  isSyncing: boolean;
}

// ---------------------------------------------------------------------------
// Messages: Popup → Background
// ---------------------------------------------------------------------------

export type BackgroundMessage =
  | { type: 'GET_STATUS' }
  | { type: 'SETUP'; password: string }
  | { type: 'UNLOCK'; password: string }
  | { type: 'UNLOCK_PIN'; pin: string }
  | { type: 'LOCK' }
  | { type: 'GET_ITEMS' }
  | { type: 'SEARCH'; query: string }
  | { type: 'ADD_ITEM'; item: NewItemData }
  | { type: 'UPDATE_ITEM'; id: string; updates: ItemUpdates }
  | { type: 'DELETE_ITEM'; id: string }
  | {
      type: 'GENERATE_PASSWORD';
      options: Partial<PasswordGeneratorOptions> & { mode: 'random' | 'passphrase' };
    }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<Settings> }
  | { type: 'SET_PIN'; pin: string }
  | { type: 'REMOVE_PIN' }
  | { type: 'GET_ACTIVE_TAB_URL' }
  | { type: 'CLIPBOARD_COPIED' }
  | { type: 'GET_SYNC_STATUS' }
  | { type: 'CONFIGURE_SYNC'; config: SyncConfig }
  | { type: 'TRIGGER_SYNC' }
  | { type: 'DISCONNECT_SYNC' };

// ---------------------------------------------------------------------------
// Responses: Background → Popup
// ---------------------------------------------------------------------------

export type VaultStatusResponse = {
  status: 'loading' | 'needs_setup' | 'locked' | 'unlocked';
  hasPIN: boolean;
  itemCount: number;
};

// All responses may include { error: string } on failure.
export type MessageResponse<T = void> = (T extends void ? { ok: true } : T) | { error: string };
