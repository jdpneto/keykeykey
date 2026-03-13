import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

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
  items: [] as any[],
  header: null as any,
  loadHeader: vi.fn(),
  unlock: vi.fn(),
  lock: vi.fn(),
  addItem: vi.fn(() => 'new-id'),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  encryptItem: vi.fn(() => new Uint8Array([1, 2, 3])),
  search: vi.fn((): any[] => []),
};

vi.mock('@keykeykey/core', () => ({
  createVaultStore: vi.fn(() => ({
    getState: () => mockStoreState,
  })),
  createVaultHeader: vi.fn(async () => ({
    header: { salt: new Uint8Array(16), nonce: new Uint8Array(24), encryptedDek: new Uint8Array(48) },
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
  ARGON2_PRESETS: {
    desktop: { t: 3, m: 65_536, p: 4, dkLen: 32 },
    mobile: { t: 2, m: 19456, p: 1, dkLen: 32 },
  },
}));

import { VaultProvider, useVault } from '../vault-context';
import * as storage from '../tauri-storage';

const mockStorage = vi.mocked(storage);

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
      ];

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
        } as any);
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
      const mockResults = [{ id: '1', name: 'Gmail', type: 'credential' }] as any[];
      mockStoreState.search.mockReturnValue(mockResults);

      const { result } = renderHook(() => useVault(), { wrapper });
      const found = result.current.search('gmail');

      expect(mockStoreState.search).toHaveBeenCalledWith('gmail');
      expect(found).toEqual(mockResults);
    });
  });
});
