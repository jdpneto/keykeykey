import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

// expo-secure-store v14 does not natively support kSecAttrAccessGroup — we
// ship a pnpm patch (patches/expo-secure-store@14.0.1.patch) that adds the
// `keychainAccessGroup` field and wires it into the query dict. Without that
// patch, this option is silently dropped and items land in the app-private
// keychain group, invisible to the CredentialProvider appex.
//
// The access group string must be the FULLY team-prefixed form
// (e.g. "BZ7UTZY2UQ.com.keykeykey.shared"). Passing the bare suffix
// "com.keykeykey.shared" sometimes causes SecItemAdd to silently drop the
// item when the app has multiple `keychain-access-groups` entries, because
// iOS's auto-team-prefix resolution is ambiguous in that case. We read the
// prefixed value from the app's Info.plist (same key the appex uses) via the
// AppGroupPath native module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  getKeychainAccessGroup,
  saveBiometricDEKNative,
  loadBiometricDEKNative,
  deleteBiometricDEKNative,
} = require('../modules/app-group-path') as {
  getKeychainAccessGroup: () => string | null;
  saveBiometricDEKNative: (payload: string) => Promise<boolean>;
  loadBiometricDEKNative: () => Promise<string | null>;
  deleteBiometricDEKNative: () => Promise<boolean>;
};

const SHARED_KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions | undefined = (() => {
  if (Platform.OS !== 'ios') return undefined;
  const accessGroup = getKeychainAccessGroup();
  if (!accessGroup) return undefined;
  return { keychainAccessGroup: accessGroup } as SecureStore.SecureStoreOptions;
})();

// Pre-patch builds stored items in the app-private keychain group (no access
// group specified). After the patch ships, shared-group reads return null for
// those legacy items. `migrateAndLoad` transparently fills the gap: read from
// shared, fall through to the legacy app-private group, and copy-forward any
// orphan it finds. One-shot per install; the old entry is deleted after copy.
// Non-destructive migration: read from shared, fall back to legacy app-private
// if absent, and best-effort copy forward. We NEVER delete the legacy copy —
// a silently-failing shared-group write followed by a legacy delete can brick
// the user's vault (no readable copy anywhere). Once both the shared-write
// path is verified end-to-end and users have upgraded past it, we can add
// a separate one-shot cleanup pass.
async function migrateAndLoad(
  key: string,
  extraOptions?: SecureStore.SecureStoreOptions,
): Promise<string | null> {
  const sharedOptions = { ...extraOptions, ...SHARED_KEYCHAIN_OPTIONS };
  let sharedValue: string | null = null;
  try {
    sharedValue = await SecureStore.getItemAsync(key, sharedOptions);
  } catch (err) {
    console.warn(`[storage] shared keychain read failed for ${key}:`, err);
  }
  if (sharedValue !== null || Platform.OS !== 'ios') {
    return sharedValue;
  }
  let legacyValue: string | null = null;
  try {
    legacyValue = await SecureStore.getItemAsync(key, extraOptions);
  } catch (err) {
    console.warn(`[storage] legacy keychain read failed for ${key}:`, err);
    return null;
  }
  if (legacyValue === null) return null;
  // Best-effort copy forward. Errors are swallowed and the legacy entry is
  // preserved so the app continues to function from the old location.
  try {
    await SecureStore.setItemAsync(key, legacyValue, sharedOptions);
  } catch (err) {
    console.warn(`[storage] migration copy of ${key} failed:`, err);
  }
  return legacyValue;
}

// Writes to both the shared group (for the appex) AND the legacy app-private
// group (for this app's ongoing reads). Keeps both in sync so either path is
// authoritative — if one write fails the other still has the value.
async function saveShared(
  key: string,
  value: string,
  extraOptions?: SecureStore.SecureStoreOptions,
): Promise<void> {
  const sharedOptions = { ...extraOptions, ...SHARED_KEYCHAIN_OPTIONS };
  await SecureStore.setItemAsync(key, value, sharedOptions);
  if (Platform.OS === 'ios') {
    try {
      await SecureStore.setItemAsync(key, value, extraOptions);
    } catch (err) {
      console.warn(`[storage] legacy keychain write mirror failed for ${key}:`, err);
    }
  }
}

async function deleteShared(
  key: string,
  extraOptions?: SecureStore.SecureStoreOptions,
): Promise<void> {
  const sharedOptions = { ...extraOptions, ...SHARED_KEYCHAIN_OPTIONS };
  await SecureStore.deleteItemAsync(key, sharedOptions);
  if (Platform.OS === 'ios') {
    await SecureStore.deleteItemAsync(key, extraOptions);
  }
}

const VAULT_HEADER_KEY = 'vault_header';
const BIOMETRIC_DEK_KEY = 'biometric_dek';
const BIOMETRIC_ENABLED_FLAG_KEY = 'biometric_enabled';
const VAULT_SETUP_KEY = 'vault_setup_complete';
const PIN_DATA_KEY = 'pin_data';
const PIN_ATTEMPTS_KEY = 'pin_attempts';
const QUICK_UNLOCK_PROMPT_KEY = 'quick_unlock_prompt_shown';

// --- SecureStore helpers (small sensitive data) ---

export async function saveVaultHeader(headerBase64: string): Promise<void> {
  await saveShared(VAULT_HEADER_KEY, headerBase64);
}

export async function loadVaultHeader(): Promise<string | null> {
  return migrateAndLoad(VAULT_HEADER_KEY);
}

export async function deleteVaultHeader(): Promise<void> {
  await deleteShared(VAULT_HEADER_KEY);
}

const BIOMETRIC_DEK_WRITE_OPTIONS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Authenticate to unlock your vault',
};

export async function saveBiometricDEK(dekBase64: string): Promise<void> {
  // On iOS, bypass expo-secure-store: its biometric-gated write path stores
  // items with a shape (Data-encoded account + "app:auth" service) that
  // silently fails to land in a shared access group on iOS 26. The native
  // path mirrors Bitwarden iOS exactly — single generic-password item with
  // plain-string account "biometric_dek" + ACL(.biometryCurrentSet) +
  // kSecAttrAccessible, upserted via SecItemUpdate-then-SecItemAdd.
  if (Platform.OS === 'ios') {
    const ok = await saveBiometricDEKNative(dekBase64);
    if (ok) return;
    console.warn('[storage] native saveBiometricDEK failed, falling back to SecureStore');
  }
  await saveShared(BIOMETRIC_DEK_KEY, dekBase64, BIOMETRIC_DEK_WRITE_OPTIONS);
}

export async function loadBiometricDEK(): Promise<string | null> {
  // Match the save path: on iOS, read the Bitwarden-shape item via the
  // native module. iOS auto-presents Face ID because the item carries an
  // ACL(.biometryCurrentSet) — no explicit LAContext dance needed here.
  if (Platform.OS === 'ios') {
    try {
      const value = await loadBiometricDEKNative();
      if (value !== null) return value;
    } catch (err) {
      console.warn('[storage] native loadBiometricDEK failed:', err);
    }
  }
  return migrateAndLoad(BIOMETRIC_DEK_KEY, BIOMETRIC_DEK_WRITE_OPTIONS);
}

export async function deleteBiometricDEK(): Promise<void> {
  if (Platform.OS === 'ios') {
    await deleteBiometricDEKNative();
  }
  await deleteShared(BIOMETRIC_DEK_KEY, BIOMETRIC_DEK_WRITE_OPTIONS);
}

// Non-sensitive "user has opted in to biometric unlock" flag. Kept separate
// from the DEK itself because the DEK entry is biometric-gated on read,
// so we cannot cheaply check whether it exists at app startup without
// triggering a biometric prompt. This flag mirrors the DEK's presence
// and can be read silently.
export async function setBiometricEnabledFlag(enabled: boolean): Promise<void> {
  if (enabled) {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_FLAG_KEY, 'true');
  } else {
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_FLAG_KEY);
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_FLAG_KEY);
  return val === 'true';
}

// --- PIN data ---

export async function savePinData(data: string): Promise<void> {
  await saveShared(PIN_DATA_KEY, data);
}

export async function loadPinData(): Promise<string | null> {
  return migrateAndLoad(PIN_DATA_KEY);
}

export async function deletePinData(): Promise<void> {
  await deleteShared(PIN_DATA_KEY);
}

// --- PIN attempt counter ---

export async function savePinAttempts(remaining: number): Promise<void> {
  await saveShared(PIN_ATTEMPTS_KEY, String(remaining));
}

export async function loadPinAttempts(): Promise<number | null> {
  const val = await migrateAndLoad(PIN_ATTEMPTS_KEY);
  return val !== null ? parseInt(val, 10) : null;
}

export async function deletePinAttempts(): Promise<void> {
  await deleteShared(PIN_ATTEMPTS_KEY);
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

const APP_GROUP_ID = 'group.com.keykeykey.shared';

// The SQLite DB must live in the App Group container so the CredentialProvider
// appex can read it. Earlier builds silently fell back to the app-private
// FileSystem.documentDirectory because the AppGroupPath native module wasn't
// autolinked — so real users have a populated DB at the old path and an empty
// one at the new path. On first call after the fix ships, copy the old file
// into place before opening, so the user's items keep working.
async function migrateLegacyDBIfNeeded(newPath: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const FileSystem = require('expo-file-system');
  const legacyPath = `${FileSystem.documentDirectory}SQLite/keykeykey.db`;
  // Earlier builds passed the absolute App Group path as the first arg to
  // `openDatabaseAsync`, which expo-sqlite interprets as a RELATIVE path
  // under the hardcoded `Documents/SQLite/` prefix. The result was that the
  // user's DB ended up nested at
  //   Documents/SQLite<absoluteAppGroupPath>/keykeykey.db
  // inside the app sandbox — invisible to the CredentialProvider appex and
  // to any explicit App Group reads. `newPath` is the correct App Group
  // path; derive the misplaced sandbox location by prepending it with
  // `Documents/SQLite`.
  const nestedSandboxPath = `${FileSystem.documentDirectory}SQLite${newPath}`;
  try {
    const [newInfo, legacyInfo, nestedInfo] = await Promise.all([
      FileSystem.getInfoAsync(newPath),
      FileSystem.getInfoAsync(legacyPath),
      FileSystem.getInfoAsync(nestedSandboxPath),
    ]);
    console.log('[storage] migration check', {
      newPath,
      newExists: newInfo.exists,
      legacyPath,
      legacyExists: legacyInfo.exists,
      nestedSandboxPath,
      nestedExists: nestedInfo.exists,
    });
    if (newInfo.exists) {
      console.log('[storage] migration: target exists, skipping');
      return;
    }
    // Prefer the nested-sandbox DB — it's the one with recent user data from
    // the broken build. Fall back to the original pre-fix legacy path.
    const source = nestedInfo.exists ? nestedSandboxPath : legacyInfo.exists ? legacyPath : null;
    if (!source) {
      console.log('[storage] migration: no source DB found');
      return;
    }
    console.log('[storage] migration: copying from', source, 'to', newPath);
    await FileSystem.copyAsync({ from: source, to: newPath });
    console.log('[storage] migration: copy complete');
  } catch (err) {
    console.warn('[storage] legacy DB migration failed:', err);
  }
}

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    // `openDatabaseAsync` treats its first argument as a RELATIVE path under
    // the hardcoded `Documents/SQLite/` subdirectory of the app sandbox —
    // passing an absolute path creates the DB nested at
    // `Documents/SQLite/<absolutePath>/keykeykey.db` inside the app sandbox
    // (NOT at the absolute location), which the CredentialProvider appex
    // cannot see. Use the third `directory` parameter to actually land the
    // DB in the App Group container on iOS.
    let dbName = 'keykeykey.db';
    let dbDirectory: string | undefined;

    if (Platform.OS === 'ios') {
      try {
        const { getAppGroupContainerPath } = require('../modules/app-group-path');
        const containerPath = getAppGroupContainerPath(APP_GROUP_ID);
        console.log('[storage] iOS containerPath:', containerPath);
        if (containerPath) {
          // Store inside `Library/` because iOS App Group containers back
          // up most subdirectories but prefer non-root locations for app
          // data. The CredentialProvider extension's DatabaseReader looks
          // here first (and falls back to the container root for legacy
          // installs).
          dbDirectory = `${containerPath}/Library`;
          await migrateLegacyDBIfNeeded(`${dbDirectory}/keykeykey.db`);
        }
      } catch (err) {
        console.warn('[storage] AppGroupPath module error:', err);
      }
    }

    console.log('[storage] opening DB name=', dbName, 'directory=', dbDirectory);
    db = await SQLite.openDatabaseAsync(dbName, undefined, dbDirectory);
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

/**
 * Drop the cached SQLite handle so the next `getDB()` opens a fresh one.
 *
 * The CredentialProvider appex reads the same on-disk database in its own
 * process. When the main app is backgrounded, the appex may open (read-only)
 * and close the DB, and iOS may also suspend the main app's JS runtime and
 * release OS-level handles out from under us. On return to foreground,
 * reusing the cached handle can lead to subtly wrong results (we saw a case
 * where `SELECT * FROM vault_items` returned an empty set even though the
 * on-disk DB had 507 rows). Forcing a fresh open on every foreground gives
 * us a clean connection.
 */
export async function closeDB(): Promise<void> {
  if (!db) return;
  try {
    await db.closeAsync();
  } catch (err) {
    console.warn('[storage] closeDB failed:', err);
  } finally {
    db = null;
  }
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
