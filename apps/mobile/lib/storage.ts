import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

const VAULT_HEADER_KEY = 'vault_header';
const BIOMETRIC_DEK_KEY = 'biometric_dek';
const VAULT_SETUP_KEY = 'vault_setup_complete';

// --- SecureStore helpers (small sensitive data) ---

export async function saveVaultHeader(headerBase64: string): Promise<void> {
  await SecureStore.setItemAsync(VAULT_HEADER_KEY, headerBase64);
}

export async function loadVaultHeader(): Promise<string | null> {
  return SecureStore.getItemAsync(VAULT_HEADER_KEY);
}

export async function deleteVaultHeader(): Promise<void> {
  await SecureStore.deleteItemAsync(VAULT_HEADER_KEY);
}

export async function saveBiometricDEK(dekBase64: string): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_DEK_KEY, dekBase64, {
    requireAuthentication: true,
    authenticationPrompt: 'Authenticate to unlock your vault',
  });
}

export async function loadBiometricDEK(): Promise<string | null> {
  return SecureStore.getItemAsync(BIOMETRIC_DEK_KEY);
}

export async function deleteBiometricDEK(): Promise<void> {
  await SecureStore.deleteItemAsync(BIOMETRIC_DEK_KEY);
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

async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('keykeykey.db');
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
