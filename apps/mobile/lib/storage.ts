import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

/** Shared Keychain options for iOS App Group access */
const SHARED_KEYCHAIN_OPTIONS =
  Platform.OS === 'ios'
    ? ({ keychainAccessGroup: 'com.keykeykey.shared' } as SecureStore.SecureStoreOptions)
    : undefined;

const VAULT_HEADER_KEY = 'vault_header';
const BIOMETRIC_DEK_KEY = 'biometric_dek';
const VAULT_SETUP_KEY = 'vault_setup_complete';
const PIN_DATA_KEY = 'pin_data';
const PIN_ATTEMPTS_KEY = 'pin_attempts';
const QUICK_UNLOCK_PROMPT_KEY = 'quick_unlock_prompt_shown';

// --- SecureStore helpers (small sensitive data) ---

export async function saveVaultHeader(headerBase64: string): Promise<void> {
  await SecureStore.setItemAsync(VAULT_HEADER_KEY, headerBase64, SHARED_KEYCHAIN_OPTIONS);
}

export async function loadVaultHeader(): Promise<string | null> {
  return SecureStore.getItemAsync(VAULT_HEADER_KEY, SHARED_KEYCHAIN_OPTIONS);
}

export async function deleteVaultHeader(): Promise<void> {
  await SecureStore.deleteItemAsync(VAULT_HEADER_KEY, SHARED_KEYCHAIN_OPTIONS);
}

export async function saveBiometricDEK(dekBase64: string): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_DEK_KEY, dekBase64, {
    requireAuthentication: true,
    authenticationPrompt: 'Authenticate to unlock your vault',
    ...SHARED_KEYCHAIN_OPTIONS,
  });
}

export async function loadBiometricDEK(): Promise<string | null> {
  return SecureStore.getItemAsync(BIOMETRIC_DEK_KEY, SHARED_KEYCHAIN_OPTIONS);
}

export async function deleteBiometricDEK(): Promise<void> {
  await SecureStore.deleteItemAsync(BIOMETRIC_DEK_KEY, SHARED_KEYCHAIN_OPTIONS);
}

// --- PIN data ---

export async function savePinData(data: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_DATA_KEY, data, SHARED_KEYCHAIN_OPTIONS);
}

export async function loadPinData(): Promise<string | null> {
  return SecureStore.getItemAsync(PIN_DATA_KEY, SHARED_KEYCHAIN_OPTIONS);
}

export async function deletePinData(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_DATA_KEY, SHARED_KEYCHAIN_OPTIONS);
}

// --- PIN attempt counter ---

export async function savePinAttempts(remaining: number): Promise<void> {
  await SecureStore.setItemAsync(PIN_ATTEMPTS_KEY, String(remaining));
}

export async function loadPinAttempts(): Promise<number | null> {
  const val = await SecureStore.getItemAsync(PIN_ATTEMPTS_KEY);
  return val !== null ? parseInt(val, 10) : null;
}

export async function deletePinAttempts(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_ATTEMPTS_KEY);
}

// --- Quick unlock prompt flag ---

export async function setQuickUnlockPromptShown(shown: boolean): Promise<void> {
  if (shown) {
    await SecureStore.setItemAsync(QUICK_UNLOCK_PROMPT_KEY, 'true');
  } else {
    await SecureStore.deleteItemAsync(QUICK_UNLOCK_PROMPT_KEY);
  }
}

export async function isQuickUnlockPromptShown(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(QUICK_UNLOCK_PROMPT_KEY);
  return val === 'true';
}

export async function setVaultSetupComplete(complete: boolean): Promise<void> {
  if (complete) {
    await SecureStore.setItemAsync(VAULT_SETUP_KEY, 'true');
  } else {
    await SecureStore.deleteItemAsync(VAULT_SETUP_KEY);
  }
}

export async function isVaultSetupComplete(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(VAULT_SETUP_KEY);
  return val === 'true';
}

// --- SQLite helpers (encrypted vault items) ---

let db: SQLite.SQLiteDatabase | null = null;

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('keykeykey.db');
    await db.execAsync('PRAGMA journal_mode=WAL;');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS vault_items (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        encrypted_data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
  return db;
}

export type StoredItem = {
  id: string;
  type: string;
  encrypted_data: string;
  created_at: string;
  updated_at: string;
};

export async function saveEncryptedItem(
  id: string,
  type: string,
  encryptedDataBase64: string,
  createdAt: string,
  updatedAt: string,
): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    `INSERT OR REPLACE INTO vault_items (id, type, encrypted_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, type, encryptedDataBase64, createdAt, updatedAt],
  );
}

export async function loadAllEncryptedItems(): Promise<StoredItem[]> {
  const database = await getDB();
  return database.getAllAsync<StoredItem>('SELECT * FROM vault_items ORDER BY updated_at DESC');
}

export async function deleteEncryptedItem(id: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM vault_items WHERE id = ?', [id]);
}

export async function deleteAllEncryptedItems(): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM vault_items');
}
