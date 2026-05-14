import {
  saveVaultHeader,
  loadVaultHeader,
  deleteVaultHeader,
  saveBiometricDEK,
  loadBiometricDEK,
  deleteBiometricDEK,
  setBiometricEnabledFlag,
  isBiometricEnabled,
  setVaultSetupComplete,
  isVaultSetupComplete,
  saveEncryptedItem,
  loadAllEncryptedItems,
  deleteEncryptedItem,
  deleteAllEncryptedItems,
} from '../../lib/storage';

// --- Mock the native bridge that returns the team-prefixed access group ---
// storage.ts resolves this once at module load and bakes the resulting group
// string into SHARED_KEYCHAIN_OPTIONS, so the mock must be installed first.
const TEST_ACCESS_GROUP = 'TESTTEAM.com.keykeykey.shared';
jest.mock('../../modules/app-group-path', () => ({
  getAppGroupContainerPath: jest.fn(() => null),
  getKeychainAccessGroup: jest.fn(() => TEST_ACCESS_GROUP),
  saveBiometricDEKNative: jest.fn(async () => false),
  loadBiometricDEKNative: jest.fn(async () => null),
  deleteBiometricDEKNative: jest.fn(async () => true),
  runKeychainDiagnostic: jest.fn(() => ''),
}));

// --- Mock expo-secure-store ---
// Keychain items are bucketed by access group. Without `keychainAccessGroup`,
// writes hit the implicit app-private bucket ('' below); with it set to
// 'com.keykeykey.shared', writes hit the shared-appex bucket. `saveShared`
// writes to the shared bucket and cleans up the legacy app-private bucket —
// a flat key → value mock can't model that and silently wipes values.
const secureStoreData: Record<string, string> = {};
const bucketKey = (key: string, options?: { keychainAccessGroup?: string }) =>
  `${options?.keychainAccessGroup ?? ''}::${key}`;

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(
    async (key: string, value: string, options?: { keychainAccessGroup?: string }) => {
      secureStoreData[bucketKey(key, options)] = value;
    },
  ),
  getItemAsync: jest.fn(
    async (key: string, options?: { keychainAccessGroup?: string }) =>
      secureStoreData[bucketKey(key, options)] ?? null,
  ),
  deleteItemAsync: jest.fn(async (key: string, options?: { keychainAccessGroup?: string }) => {
    delete secureStoreData[bucketKey(key, options)];
  }),
}));

// --- Mock expo-sqlite ---
const sqliteRows: Record<string, any>[] = [];
const mockRunAsync = jest.fn(async (sql: string, params?: any[]) => {
  if (sql.includes('INSERT OR REPLACE')) {
    const [id, type, encrypted_data, created_at, updated_at] = params!;
    const existingIdx = sqliteRows.findIndex((r) => r.id === id);
    const row = { id, type, encrypted_data, created_at, updated_at };
    if (existingIdx >= 0) {
      sqliteRows[existingIdx] = row;
    } else {
      sqliteRows.push(row);
    }
  } else if (sql.includes('DELETE') && params?.length) {
    const idx = sqliteRows.findIndex((r) => r.id === params[0]);
    if (idx >= 0) sqliteRows.splice(idx, 1);
  } else if (sql === 'DELETE FROM vault_items') {
    sqliteRows.length = 0;
  }
});
const mockGetAllAsync = jest.fn(async () => [...sqliteRows]);
const mockExecAsync = jest.fn(async () => {});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: mockExecAsync,
    runAsync: mockRunAsync,
    getAllAsync: mockGetAllAsync,
  })),
}));

describe('storage — SecureStore helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(secureStoreData).forEach((k) => delete secureStoreData[k]);
  });

  it('saves and loads vault header', async () => {
    await saveVaultHeader('header-base64-data');
    const result = await loadVaultHeader();
    expect(result).toBe('header-base64-data');
  });

  it('returns null when no vault header exists', async () => {
    const result = await loadVaultHeader();
    expect(result).toBeNull();
  });

  it('deletes vault header', async () => {
    await saveVaultHeader('header-data');
    await deleteVaultHeader();
    const result = await loadVaultHeader();
    expect(result).toBeNull();
  });

  it('saves biometric DEK with authentication requirement', async () => {
    const SecureStore = require('expo-secure-store');
    const native = require('../../modules/app-group-path');
    native.saveBiometricDEKNative.mockResolvedValueOnce(true);

    await saveBiometricDEK('dek-base64');

    expect(native.saveBiometricDEKNative).toHaveBeenCalledWith('dek-base64');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith(
      'biometric_dek',
      expect.any(String),
      expect.anything(),
    );
  });

  it('does not fall back to SecureStore for iOS biometric DEK when the native writer fails', async () => {
    const SecureStore = require('expo-secure-store');
    const native = require('../../modules/app-group-path');
    native.saveBiometricDEKNative.mockResolvedValueOnce(false);

    await expect(saveBiometricDEK('dek-base64')).rejects.toThrow(
      'Failed to save biometric unlock key',
    );

    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith(
      'biometric_dek',
      'dek-base64',
      expect.anything(),
    );
  });

  it('loads and deletes biometric DEK', async () => {
    // Seed the shared-appex bucket — matches the mock's bucketKey format.
    secureStoreData[`${TEST_ACCESS_GROUP}::biometric_dek`] = 'dek-data';
    const result = await loadBiometricDEK();
    expect(result).toBe('dek-data');

    await deleteBiometricDEK();
    const after = await loadBiometricDEK();
    expect(after).toBeNull();
  });

  it('persists biometric-enabled flag without requiring authentication', async () => {
    const SecureStore = require('expo-secure-store');
    expect(await isBiometricEnabled()).toBe(false);

    await setBiometricEnabledFlag(true);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('biometric_enabled', 'true');
    // The flag itself is non-sensitive and must NOT be biometric-gated,
    // otherwise the app would prompt for biometrics just to check existence.
    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith(
      'biometric_enabled',
      'true',
      expect.objectContaining({ requireAuthentication: true }),
    );
    expect(await isBiometricEnabled()).toBe(true);

    await setBiometricEnabledFlag(false);
    expect(await isBiometricEnabled()).toBe(false);
  });

  it('sets vault setup complete flag', async () => {
    expect(await isVaultSetupComplete()).toBe(false);

    await setVaultSetupComplete(true);
    expect(await isVaultSetupComplete()).toBe(true);

    await setVaultSetupComplete(false);
    expect(await isVaultSetupComplete()).toBe(false);
  });
});

describe('storage — SQLite helpers', () => {
  beforeEach(() => {
    sqliteRows.length = 0;
    mockRunAsync.mockClear();
    mockGetAllAsync.mockClear();
  });

  it('saves and loads encrypted items', async () => {
    await saveEncryptedItem(
      'id-1',
      'credential',
      'enc-data-1',
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:00:00Z',
    );
    await saveEncryptedItem(
      'id-2',
      'card',
      'enc-data-2',
      '2024-01-02T00:00:00Z',
      '2024-01-02T00:00:00Z',
    );

    const items = await loadAllEncryptedItems();
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('id-1');
    expect(items[1].id).toBe('id-2');
  });

  it('upserts items with INSERT OR REPLACE', async () => {
    await saveEncryptedItem(
      'id-1',
      'credential',
      'enc-v1',
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:00:00Z',
    );
    await saveEncryptedItem(
      'id-1',
      'credential',
      'enc-v2',
      '2024-01-01T00:00:00Z',
      '2024-01-02T00:00:00Z',
    );

    const items = await loadAllEncryptedItems();
    expect(items).toHaveLength(1);
    expect(items[0].encrypted_data).toBe('enc-v2');
  });

  it('uses parameterized queries (SQL injection safe)', async () => {
    await saveEncryptedItem(
      'id-1',
      'credential',
      'data',
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:00:00Z',
    );
    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('VALUES (?, ?, ?, ?, ?)'),
      expect.any(Array),
    );
  });

  it('deletes a single encrypted item', async () => {
    await saveEncryptedItem(
      'id-1',
      'credential',
      'enc-1',
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:00:00Z',
    );
    await saveEncryptedItem(
      'id-2',
      'card',
      'enc-2',
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:00:00Z',
    );

    await deleteEncryptedItem('id-1');
    const items = await loadAllEncryptedItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('id-2');
  });

  it('deletes all encrypted items', async () => {
    await saveEncryptedItem(
      'id-1',
      'credential',
      'enc-1',
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:00:00Z',
    );
    await saveEncryptedItem(
      'id-2',
      'card',
      'enc-2',
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:00:00Z',
    );

    await deleteAllEncryptedItems();
    const items = await loadAllEncryptedItems();
    expect(items).toHaveLength(0);
  });

  it('initializes database with correct schema (called once across all tests)', () => {
    // getDB() is a singleton — the CREATE TABLE runs on first DB access
    // which happens in the first test that touches SQLite
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS vault_items'),
    );
  });
});
