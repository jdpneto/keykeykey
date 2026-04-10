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
  autoLockMinutes: 60,
  themeMode: 'system',
};

// ---------------------------------------------------------------------------
// Sync config (re-exported from core)
// ---------------------------------------------------------------------------

import type { SyncConfig, SyncProvider } from '@keykeykey/core/sync';
export type { SyncConfig, SyncProvider };

export interface SyncStatus {
  provider: SyncProvider;
  lastSynced: string | null;
  isSyncing: boolean;
  error: string | null;
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
  | { type: 'GET_ITEMS_FOR_HOST'; hostname: string }
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
  | { type: 'DISCONNECT_SYNC' }
  | { type: 'GET_CREDENTIALS_FOR_TAB'; hostname: string }
  | { type: 'GET_MATCHING_CREDENTIALS'; hostname: string }
  | { type: 'FILL_CREDENTIAL'; id: string }
  | { type: 'CHECK_CREDENTIAL_EXISTS'; hostname: string; username: string; password: string }
  | { type: 'SAVE_CREDENTIAL'; url: string; username: string; password: string; name: string }
  | { type: 'UPDATE_CREDENTIAL'; credentialId: string; password: string }
  | { type: 'FILL_ACTIVE_TAB'; username: string; password: string }
  | { type: 'RESET_VAULT' }
  | { type: 'VALIDATE_MASTER_PASSWORD'; password: string }
  | { type: 'RESTORE_FROM_CLOUD'; config: SyncConfig; masterPassword: string }
  | { type: 'GET_MISMATCH_INFO' }
  | { type: 'CLEAR_MISMATCH' }
  | { type: 'REPLACE_REMOTE' }
  | { type: 'REPLACE_LOCAL' }
  | { type: 'MERGE_VAULTS' }
  | { type: 'GOOGLE_OAUTH_CONNECT'; masterPassword: string }
  | { type: 'GOOGLE_OAUTH_DISCONNECT' }
  | { type: 'GOOGLE_OAUTH_GET_TOKEN' }
  | { type: 'DROPBOX_OAUTH_CONNECT'; masterPassword: string }
  | { type: 'DROPBOX_OAUTH_DISCONNECT' }
  | { type: 'DROPBOX_OAUTH_GET_TOKEN' }
  | { type: 'ONEDRIVE_OAUTH_CONNECT'; masterPassword: string }
  | { type: 'ONEDRIVE_OAUTH_DISCONNECT' }
  | { type: 'ONEDRIVE_OAUTH_GET_TOKEN' }
  | { type: 'IMPORT_ITEMS'; items: NewItemData[] }
  | { type: 'GET_IMPORT_STATUS' }
  | { type: 'CLEAR_IMPORT_STATUS' }
  | { type: 'CLEAR_RESTORE_STATUS' };

// ---------------------------------------------------------------------------
// Push messages: Background → Content
// ---------------------------------------------------------------------------

export type ContentPushMessage =
  | { type: 'VAULT_LOCKED' }
  | { type: 'VAULT_UNLOCKED' }
  | { type: 'VAULT_CHANGED' }
  | { type: 'FILL_FROM_POPUP'; username: string; password: string };

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
