import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import type { VaultItem, VaultHeader } from '@keykeykey/core';

// Mock sync module before importing vault-context
vi.mock('../sync', () => ({
  createDesktopPlatformStorage: vi.fn(() => ({})),
  clearSyncConfigData: vi.fn(),
}));

// Mock tauri-storage before importing vault-context
vi.mock('../tauri-storage', () => ({
  isVaultSetupComplete: vi.fn(),
  loadVaultHeader: vi.fn(),
  saveVaultHeader: vi.fn(),
  saveEncryptedItem: vi.fn(),
  loadAllEncryptedItems: vi.fn(),
  deleteEncryptedItem: vi.fn(),
  setVaultSetupComplete: vi.fn(),
}));

// Mock core with controlled store state
const mockStoreState = {
  status: 'locked' as string,
  items: [] as VaultItem[],
  header: null as VaultHeader | null,
  loadHeader: vi.fn(),
  unlock: vi.fn(),
  lock: vi.fn(),
  addItem: vi.fn(() => 'new-id'),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  encryptItem: vi.fn(() => new Uint8Array([1, 2, 3])),
  search: vi.fn((): VaultItem[] => []),
  getDEK: vi.fn(() => new Uint8Array(32)),
  resetVault: vi.fn(),
};

vi.mock('@keykeykey/core', () => ({
  createVaultStore: vi.fn(() => ({
    getState: () => mockStoreState,
  })),
  createVaultHeader: vi.fn(async () => ({
    header: {
      salt: new Uint8Array(16),
      nonce: new Uint8Array(24),
      encryptedDek: new Uint8Array(48),
    },
  })),
  serializeVaultHeader: vi.fn(() => new Uint8Array([1, 2, 3])),
  deserializeVaultHeader: vi.fn(() => ({
    salt: new Uint8Array(16),
    nonce: new Uint8Array(24),
    encryptedDek: new Uint8Array(48),
  })),
  generateRecoveryKey: vi.fn(() => ({
    raw: new Uint8Array(16).fill(3),
    formatted: 'AAAAA-BBBBB-CCCCC-DDDDD',
  })),
  unlockVault: vi.fn(async () => new Uint8Array(32)),
  ARGON2_PRESETS: {
    desktop: { t: 3, m: 65_536, p: 4, dkLen: 32 },
    mobile: { t: 2, m: 19456, p: 1, dkLen: 32 },
  },
}));

// Mock @keykeykey/core/sync to prevent real crypto calls
const mockLifecycleInstance = {
  initAfterUnlock: vi.fn(async () => ({ provider: 'none' })),
  saveConfig: vi.fn(),
  teardown: vi.fn(),
  triggerSync: vi.fn(async () => ({ lastSynced: null, error: 'No sync engine' })),
  getStatus: vi.fn(() => ({ isSyncing: false })),
  recordTombstone: vi.fn(),
  validateMasterPassword: vi.fn(async () => false),
  clearMismatch: vi.fn(),
  replaceRemote: vi.fn(async () => ({ success: false })),
  replaceLocal: vi.fn(async () => ({ success: false })),
  mergeVaults: vi.fn(async () => ({ success: false })),
  restoreFromCloud: vi.fn(async () => ({ success: false })),
  config: null,
  mismatchInfo: null,
  engine: null,
};

vi.mock('@keykeykey/core/sync', () => ({
  // `SyncLifecycle` is constructed with `new`; Vitest 4+ mocks are only
  // constructible when the implementation is a `function`/class, not an arrow.
  SyncLifecycle: vi.fn(function () {
    return mockLifecycleInstance;
  }),
  deriveMEK: vi.fn(async () => new Uint8Array(32)),
  generateSyncSalt: vi.fn(() => new Uint8Array(16)),
  readPreambleFromBlob: vi.fn(),
  validateArgon2Params: vi.fn(),
  PREAMBLE_SIZE: 32,
  createAdapterFromConfig: vi.fn(() => null),
  restoreFromCloud: vi.fn(),
  deleteCloudVault: vi.fn(),
}));

import { VaultProvider, useVault } from '../vault-context';
import * as storage from '../tauri-storage';
import { invoke } from '@tauri-apps/api/core';

const mockStorage = vi.mocked(storage);
const mockInvoke = vi.mocked(invoke);

function wrapper({ children }: { children: React.ReactNode }) {
  return <VaultProvider>{children}</VaultProvider>;
}

describe('VaultProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.status = 'locked';
    mockStoreState.items = [];
    mockStoreState.header = null;
  });

  it('starts with loading status', () => {
    const { result } = renderHook(() => useVault(), { wrapper });
    expect(result.current.status).toBe('loading');
  });

  describe('initialize', () => {
    it('sets needs_setup when vault is not set up', async () => {
      mockStorage.isVaultSetupComplete.mockResolvedValue(false);

      const { result } = renderHook(() => useVault(), { wrapper });
      await act(async () => {
        await result.current.initialize();
      });

      expect(result.current.status).toBe('needs_setup');
    });

    it('sets locked when vault is set up and header exists', async () => {
      mockStorage.isVaultSetupComplete.mockResolvedValue(true);
      // Provide valid base64 (3 bytes → AQID)
      mockStorage.loadVaultHeader.mockResolvedValue('AQID');

      const { result } = renderHook(() => useVault(), { wrapper });
      await act(async () => {
        await result.current.initialize();
      });

      expect(result.current.status).toBe('locked');
      expect(mockStoreState.loadHeader).toHaveBeenCalled();
    });

    it('sets needs_setup when header is missing', async () => {
      mockStorage.isVaultSetupComplete.mockResolvedValue(true);
      mockStorage.loadVaultHeader.mockResolvedValue(null);

      const { result } = renderHook(() => useVault(), { wrapper });
      await act(async () => {
        await result.current.initialize();
      });

      expect(result.current.status).toBe('needs_setup');
    });
  });

  describe('Touch ID', () => {
    async function initLocked(keyring: Record<string, string> = {}) {
      mockStorage.isVaultSetupComplete.mockResolvedValue(true);
      mockStorage.loadVaultHeader.mockResolvedValue('AQID');
      mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === 'biometric_is_available') return true;
        if (cmd === 'load_from_keyring') return keyring[(args as { key: string }).key] ?? null;
        return null;
      });
      const hook = renderHook(() => useVault(), { wrapper });
      await act(async () => {
        await hook.result.current.initialize();
      });
      return hook;
    }

    it('is not enabled just because the hardware is available', async () => {
      const { result } = await initLocked();
      expect(result.current.biometricAvailable).toBe(true);
      expect(result.current.biometricEnabled).toBe(false);
    });

    it('reads the enabled flag on initialize', async () => {
      const { result } = await initLocked({ keykeykey_biometric_enabled: 'true' });
      expect(result.current.biometricEnabled).toBe(true);
    });

    it('enable stores the DEK and sets the flag; disable clears both', async () => {
      const { result } = await initLocked();
      await act(async () => {
        await result.current.enableBiometric();
      });
      expect(mockInvoke).toHaveBeenCalledWith('biometric_save_dek', expect.anything());
      expect(mockInvoke).toHaveBeenCalledWith('save_to_keyring', {
        key: 'keykeykey_biometric_enabled',
        value: 'true',
      });
      expect(result.current.biometricEnabled).toBe(true);

      await act(async () => {
        await result.current.disableBiometric();
      });
      expect(mockInvoke).toHaveBeenCalledWith('biometric_clear_dek');
      expect(mockInvoke).toHaveBeenCalledWith('delete_from_keyring', {
        key: 'keykeykey_biometric_enabled',
      });
      expect(result.current.biometricEnabled).toBe(false);
      // Hardware availability is untouched by disabling the feature.
      expect(result.current.biometricAvailable).toBe(true);
    });

    it('resetVault clears the Touch ID keychain item and the flag', async () => {
      const { result } = await initLocked({ keykeykey_biometric_enabled: 'true' });
      await act(async () => {
        await result.current.resetVault();
      });
      expect(mockInvoke).toHaveBeenCalledWith('biometric_clear_dek');
      expect(mockInvoke).toHaveBeenCalledWith('delete_from_keyring', {
        key: 'keykeykey_biometric_enabled',
      });
      expect(result.current.biometricEnabled).toBe(false);
    });

    it('resetVault re-arms the quick-unlock offer for the next vault', async () => {
      const { result } = await initLocked({ keykeykey_quick_unlock_prompt: 'dismissed' });
      expect(result.current.quickUnlockPromptShown).toBe(true);
      await act(async () => {
        await result.current.resetVault();
      });
      expect(mockInvoke).toHaveBeenCalledWith('delete_from_keyring', {
        key: 'keykeykey_quick_unlock_prompt',
      });
      expect(result.current.quickUnlockPromptShown).toBe(false);
    });
  });

  describe('setupVault', () => {
    it('creates vault and returns recovery key', async () => {
      mockStorage.saveVaultHeader.mockResolvedValue(undefined);
      mockStorage.setVaultSetupComplete.mockResolvedValue(undefined);

      const { result } = renderHook(() => useVault(), { wrapper });
      let recoveryKey: string = '';
      await act(async () => {
        recoveryKey = await result.current.setupVault('mypassword');
      });

      expect(recoveryKey).toBe('AAAAA-BBBBB-CCCCC-DDDDD');
      expect(result.current.status).toBe('unlocked');
      expect(mockStorage.saveVaultHeader).toHaveBeenCalled();
      expect(mockStorage.setVaultSetupComplete).toHaveBeenCalledWith(true);
    });
  });

  describe('unlock', () => {
    it('loads encrypted items and unlocks store', async () => {
      mockStorage.loadAllEncryptedItems.mockResolvedValue([
        { id: '1', type: 'credential', encrypted_data: 'AQID', created_at: 'x', updated_at: 'y' },
      ]);

      const { result } = renderHook(() => useVault(), { wrapper });
      await act(async () => {
        await result.current.unlock('mypassword');
      });

      expect(result.current.status).toBe('unlocked');
      expect(mockStoreState.unlock).toHaveBeenCalled();
    });
  });

  describe('lock', () => {
    it('locks the vault and clears items', async () => {
      const { result } = renderHook(() => useVault(), { wrapper });
      act(() => {
        result.current.lock();
      });

      expect(result.current.status).toBe('locked');
      expect(result.current.items).toEqual([]);
      expect(mockStoreState.lock).toHaveBeenCalled();
    });
  });

  describe('addItem', () => {
    it('adds item and persists encrypted data', async () => {
      mockStorage.saveEncryptedItem.mockResolvedValue(undefined);
      mockStoreState.items = [
        { id: 'new-id', type: 'credential', name: 'Test', createdAt: 'a', updatedAt: 'b' },
      ] as unknown as VaultItem[];

      const { result } = renderHook(() => useVault(), { wrapper });
      let id: string = '';
      await act(async () => {
        id = await result.current.addItem({
          type: 'credential',
          name: 'Test',
          username: 'user',
          password: 'pass',
          favorite: false,
          tags: [],
        } as Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>);
      });

      expect(id).toBe('new-id');
      expect(mockStoreState.addItem).toHaveBeenCalled();
      expect(mockStorage.saveEncryptedItem).toHaveBeenCalled();
    });
  });

  describe('removeItem', () => {
    it('deletes item from store and storage', async () => {
      mockStorage.deleteEncryptedItem.mockResolvedValue(undefined);

      const { result } = renderHook(() => useVault(), { wrapper });
      await act(async () => {
        await result.current.removeItem('item-1');
      });

      expect(mockStoreState.deleteItem).toHaveBeenCalledWith('item-1');
      expect(mockStorage.deleteEncryptedItem).toHaveBeenCalledWith('item-1');
    });
  });

  describe('search', () => {
    it('delegates to store search', () => {
      const mockResults = [
        { id: '1', name: 'Gmail', type: 'credential' },
      ] as unknown as VaultItem[];
      mockStoreState.search.mockReturnValue(mockResults);

      const { result } = renderHook(() => useVault(), { wrapper });
      const found = result.current.search('gmail');

      // Second arg is the SearchOptions parameter (undefined when caller
      // passes only the query — the default = shallow, all-types behavior).
      expect(mockStoreState.search).toHaveBeenCalledWith('gmail', undefined);
      expect(found).toEqual(mockResults);
    });
  });
});
