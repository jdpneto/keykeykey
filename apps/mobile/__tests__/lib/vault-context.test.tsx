import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { VaultProvider, useVault } from '../../lib/vault-context';

// Mock storage module — use jest.fn() inline (hoisting-safe)
jest.mock('../../lib/storage', () => ({
  isVaultSetupComplete: jest.fn(),
  loadVaultHeader: jest.fn(),
  saveVaultHeader: jest.fn(),
  setVaultSetupComplete: jest.fn(),
  saveEncryptedItem: jest.fn(),
  loadAllEncryptedItems: jest.fn(),
  deleteEncryptedItem: jest.fn(),
}));

// Import after mock declaration
const mockStorage = jest.requireMock('../../lib/storage') as {
  isVaultSetupComplete: jest.Mock;
  loadVaultHeader: jest.Mock;
  saveVaultHeader: jest.Mock;
  setVaultSetupComplete: jest.Mock;
  saveEncryptedItem: jest.Mock;
  loadAllEncryptedItems: jest.Mock;
  deleteEncryptedItem: jest.Mock;
};

// Mock @keykeykey/core
const mockDEK = new Uint8Array(32).fill(42);
const mockWrappedDEK = new Uint8Array(72).fill(1);
const mockSalt = new Uint8Array(16).fill(2);
const mockHeader = {
  version: 1,
  masterSalt: mockSalt,
  recoverySalt: mockSalt,
  argon2Params: { t: 2, m: 19456, p: 1, dkLen: 32 },
  masterWrappedDEK: mockWrappedDEK,
  recoveryWrappedDEK: mockWrappedDEK,
};

const mockStoreState: any = {
  status: 'locked',
  items: [],
  header: null,
  loadHeader: jest.fn(),
  unlock: jest.fn(),
  lock: jest.fn(() => {
    mockStoreState.status = 'locked';
    mockStoreState.items = [];
  }),
  addItem: jest.fn(() => 'test-uuid'),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  search: jest.fn(() => []),
  encryptItem: jest.fn(() => new Uint8Array([1, 2, 3])),
  getDEK: jest.fn(() => mockDEK),
};

jest.mock('@keykeykey/core', () => ({
  createVaultStore: jest.fn(() => ({
    getState: () => mockStoreState,
  })),
  createVaultHeader: jest.fn(() => ({
    header: mockHeader,
    dek: mockDEK,
  })),
  serializeVaultHeader: jest.fn(() => new Uint8Array([1, 2, 3])),
  deserializeVaultHeader: jest.fn(() => mockHeader),
  generateRecoveryKey: jest.fn(() => ({
    raw: new Uint8Array(16).fill(3),
    formatted: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-F',
  })),
  ARGON2_PRESETS: {
    mobile: { t: 2, m: 19456, p: 1, dkLen: 32 },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <VaultProvider>{children}</VaultProvider>;
}

describe('VaultProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreState.status = 'locked';
    mockStoreState.items = [];
    mockStoreState.header = null;
  });

  it('starts in loading status', () => {
    const { result } = renderHook(() => useVault(), { wrapper });
    expect(result.current.status).toBe('loading');
  });

  it('transitions to needs_setup when no vault exists', async () => {
    mockStorage.isVaultSetupComplete.mockResolvedValue(false);

    const { result } = renderHook(() => useVault(), { wrapper });
    await act(async () => {
      await result.current.initialize();
    });

    expect(result.current.status).toBe('needs_setup');
  });

  it('transitions to locked when vault exists', async () => {
    mockStorage.isVaultSetupComplete.mockResolvedValue(true);
    mockStorage.loadVaultHeader.mockResolvedValue('AQID');

    const { result } = renderHook(() => useVault(), { wrapper });
    await act(async () => {
      await result.current.initialize();
    });

    expect(result.current.status).toBe('locked');
    expect(mockStoreState.loadHeader).toHaveBeenCalled();
  });

  it('transitions to needs_setup when header is missing despite flag', async () => {
    mockStorage.isVaultSetupComplete.mockResolvedValue(true);
    mockStorage.loadVaultHeader.mockResolvedValue(null);

    const { result } = renderHook(() => useVault(), { wrapper });
    await act(async () => {
      await result.current.initialize();
    });

    expect(result.current.status).toBe('needs_setup');
  });

  it('sets up a new vault and returns recovery key', async () => {
    mockStorage.saveVaultHeader.mockResolvedValue(undefined);
    mockStorage.setVaultSetupComplete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVault(), { wrapper });

    let recoveryKey: string = '';
    await act(async () => {
      recoveryKey = await result.current.setupVault('MyStr0ngP@ss');
    });

    expect(recoveryKey).toBe('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-F');
    expect(result.current.status).toBe('unlocked');
    expect(result.current.recoveryKey).toBe(recoveryKey);
    expect(mockStorage.saveVaultHeader).toHaveBeenCalled();
    expect(mockStorage.setVaultSetupComplete).toHaveBeenCalledWith(true);
  });

  it('unlocks the vault with master password', async () => {
    mockStorage.loadAllEncryptedItems.mockResolvedValue([]);

    const { result } = renderHook(() => useVault(), { wrapper });
    await act(async () => {
      await result.current.unlock('password123');
    });

    expect(result.current.status).toBe('unlocked');
    expect(mockStoreState.unlock).toHaveBeenCalledWith('password123', []);
  });

  it('locks the vault and clears items', async () => {
    const { result } = renderHook(() => useVault(), { wrapper });

    await act(async () => {
      result.current.lock();
    });

    expect(result.current.status).toBe('locked');
    expect(result.current.items).toEqual([]);
    expect(mockStoreState.lock).toHaveBeenCalled();
  });

  it('adds an item and persists to storage', async () => {
    mockStoreState.items = [
      {
        id: 'test-uuid',
        type: 'credential',
        name: 'Test',
        username: 'user',
        password: 'pass',
        tags: [],
        favorite: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ];

    const { result } = renderHook(() => useVault(), { wrapper });

    let id = '';
    await act(async () => {
      id = await result.current.addItem({
        type: 'credential',
        name: 'Test',
        username: 'user',
        password: 'pass',
        tags: [],
        favorite: false,
      } as any);
    });

    expect(id).toBe('test-uuid');
    expect(mockStorage.saveEncryptedItem).toHaveBeenCalled();
  });

  it('removes an item and deletes from storage', async () => {
    const { result } = renderHook(() => useVault(), { wrapper });

    await act(async () => {
      await result.current.removeItem('test-uuid');
    });

    expect(mockStoreState.deleteItem).toHaveBeenCalledWith('test-uuid');
    expect(mockStorage.deleteEncryptedItem).toHaveBeenCalledWith('test-uuid');
  });

  it('throws when useVault is used outside VaultProvider', () => {
    expect(() => {
      renderHook(() => useVault());
    }).toThrow('useVault must be used within VaultProvider');
  });
});
