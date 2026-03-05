import {
  saveVaultHeader,
  loadVaultHeader,
  deleteVaultHeader,
  saveBiometricDEK,
  loadBiometricDEK,
  deleteBiometricDEK,
  setVaultSetupComplete,
  isVaultSetupComplete,
  saveEncryptedItem,
  loadAllEncryptedItems,
  deleteEncryptedItem,
  deleteAllEncryptedItems,
} from '../../lib/storage';

// --- Mock expo-secure-store ---
const secureStoreData: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    secureStoreData[key] = value;
  }),
  getItemAsync: jest.fn(async (key: string) => secureStoreData[key] ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete secureStoreData[key];
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
    await saveBiometricDEK('dek-base64');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'biometric_dek',
      'dek-base64',
      expect.objectContaining({
        requireAuthentication: true,
        authenticationPrompt: expect.any(String),
      }),
    );
  });

  it('loads and deletes biometric DEK', async () => {
    secureStoreData['biometric_dek'] = 'dek-data';
    const result = await loadBiometricDEK();
    expect(result).toBe('dek-data');

    await deleteBiometricDEK();
    const after = await loadBiometricDEK();
    expect(after).toBeNull();
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
