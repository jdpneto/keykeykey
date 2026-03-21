import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncLifecycle } from './sync-lifecycle.js';
import type { PlatformStorage, SyncLifecycleCallbacks } from './sync-lifecycle.js';
import type { SyncableStore } from './sync-engine.js';
import type { SyncConfig } from './sync-config.js';
import { DEFAULT_SYNC_CONFIG, encryptSyncConfig } from './sync-config.js';
import { randomBytes } from '@noble/hashes/utils';
import { createVaultHeader } from '../crypto/vault-header.js';
import type { VaultHeader } from '../crypto/vault-header.js';
import { encrypt } from '../crypto/encryption.js';
import type { VaultItem } from '../models/vault-item.js';

// Lightweight Argon2 params for tests
const TEST_PARAMS = { t: 1, m: 8192, p: 1, dkLen: 32 };
const TEST_PASSWORD = 'test-password-123';

function createMockStorage(): PlatformStorage {
  const files = new Map<string, Uint8Array>();
  let headerB64: string | null = null;

  return {
    loadSyncConfigFile: vi.fn(async () => files.get('sync-config') ?? null),
    saveSyncConfigFile: vi.fn(async (data: Uint8Array) => {
      files.set('sync-config', data);
    }),
    deleteSyncConfigFile: vi.fn(async () => {
      files.delete('sync-config');
    }),
    saveEncryptedItem: vi.fn(async () => {}),
    loadAllEncryptedItems: vi.fn(async () => []),
    deleteAllItems: vi.fn(async () => {}),
    saveVaultHeader: vi.fn(async (b64: string) => {
      headerB64 = b64;
    }),
    loadVaultHeader: vi.fn(async () => headerB64),
    setVaultSetupComplete: vi.fn(async () => {}),
    setSyncUrlPrefix: vi.fn(async () => {}),
  };
}

function createMockCallbacks(): SyncLifecycleCallbacks {
  return {
    onConfigChanged: vi.fn(),
    onMismatch: vi.fn(),
    onMismatchCleared: vi.fn(),
    onItemsChanged: vi.fn(),
  };
}

async function createTestVaultStore(): Promise<{
  store: SyncableStore & { getState: () => { status: string; items: VaultItem[]; header: VaultHeader; encryptItem: (item: VaultItem) => Uint8Array; getDEK: () => Uint8Array } };
  header: VaultHeader;
  dek: Uint8Array;
}> {
  const recoveryKey = randomBytes(32);
  const { header, dek } = await createVaultHeader(TEST_PASSWORD, recoveryKey, TEST_PARAMS);
  const items: VaultItem[] = [];

  const store = {
    getState: () => ({
      status: 'unlocked' as const,
      items,
      header,
      encryptItem: (item: VaultItem) => {
        return encrypt(new TextEncoder().encode(JSON.stringify(item)), dek);
      },
      getDEK: () => dek,
    }),
    setState: (partial: Partial<{ items: VaultItem[] }>) => {
      if (partial.items) {
        items.length = 0;
        items.push(...partial.items);
      }
    },
    getVaultId: () => header.vaultId,
    subscribe: () => () => {},
  } as SyncableStore & { getState: () => { status: string; items: VaultItem[]; header: VaultHeader; encryptItem: (item: VaultItem) => Uint8Array; getDEK: () => Uint8Array } };

  return { store, header, dek };
}

describe('SyncLifecycle', () => {
  let storage: PlatformStorage;
  let callbacks: SyncLifecycleCallbacks;

  beforeEach(() => {
    storage = createMockStorage();
    callbacks = createMockCallbacks();
  });

  describe('initAfterUnlock', () => {
    it('should return DEFAULT_SYNC_CONFIG when no config file exists', async () => {
      const { store, header } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });

      const config = await lifecycle.initAfterUnlock();

      expect(config).toEqual(DEFAULT_SYNC_CONFIG);
      expect(callbacks.onConfigChanged).toHaveBeenCalledWith(DEFAULT_SYNC_CONFIG);
      expect(lifecycle.engine).toBeNull();
    });

    it('should load and decrypt saved config', async () => {
      const { store, dek, header } = await createTestVaultStore();
      const savedConfig: SyncConfig = { provider: 'none' };
      const encrypted = encryptSyncConfig(savedConfig, dek);
      await storage.saveSyncConfigFile(encrypted);

      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });

      const config = await lifecycle.initAfterUnlock();

      expect(config).toEqual(savedConfig);
      expect(callbacks.onConfigChanged).toHaveBeenCalledWith(savedConfig);
    });

    it('should return DEFAULT_SYNC_CONFIG on corrupted config', async () => {
      const { store, header } = await createTestVaultStore();
      await storage.saveSyncConfigFile(new Uint8Array([1, 2, 3]));

      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });

      const config = await lifecycle.initAfterUnlock();

      expect(config).toEqual(DEFAULT_SYNC_CONFIG);
    });
  });

  describe('saveConfig', () => {
    it('should persist encrypted config', async () => {
      const { store, header } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });
      await lifecycle.initAfterUnlock();

      const config: SyncConfig = { provider: 'none' };
      await lifecycle.saveConfig(config);

      expect(storage.saveSyncConfigFile).toHaveBeenCalled();
      expect(lifecycle.config).toEqual(config);
      expect(callbacks.onConfigChanged).toHaveBeenCalledWith(config);
    });

    it('should teardown engine when saving provider none', async () => {
      const { store, header } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });
      await lifecycle.initAfterUnlock();

      await lifecycle.saveConfig({ provider: 'none' });

      expect(lifecycle.engine).toBeNull();
    });
  });

  describe('teardown', () => {
    it('should null out engine and config', async () => {
      const { store, header } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });
      await lifecycle.initAfterUnlock();

      lifecycle.teardown();

      expect(lifecycle.engine).toBeNull();
      expect(lifecycle.config).toBeNull();
    });
  });

  describe('triggerSync', () => {
    it('should return error when no engine', async () => {
      const { store, header } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });

      const result = await lifecycle.triggerSync();

      expect(result.error).toBe('No sync engine');
      expect(result.lastSynced).toBeNull();
    });
  });

  describe('getStatus', () => {
    it('should return isSyncing false when no engine', async () => {
      const { store, header } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });

      expect(lifecycle.getStatus()).toEqual({ isSyncing: false });
    });
  });

  describe('validateMasterPassword', () => {
    it('should return true for correct password', async () => {
      const { store, header } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });
      await lifecycle.initAfterUnlock();

      const valid = await lifecycle.validateMasterPassword(TEST_PASSWORD);

      expect(valid).toBe(true);
    });

    it('should return false for wrong password', async () => {
      const { store, header } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });
      await lifecycle.initAfterUnlock();

      const valid = await lifecycle.validateMasterPassword('wrong-password');

      expect(valid).toBe(false);
    });

    it('should return false when no header available', async () => {
      const { store } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => null,
      });

      const valid = await lifecycle.validateMasterPassword(TEST_PASSWORD);

      expect(valid).toBe(false);
    });
  });

  describe('clearMismatch', () => {
    it('should reset config to none and call callbacks', async () => {
      const { store, header } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });
      await lifecycle.initAfterUnlock();

      await lifecycle.clearMismatch();

      expect(lifecycle.config).toEqual({ provider: 'none' });
      expect(lifecycle.mismatchInfo).toBeNull();
      expect(callbacks.onMismatchCleared).toHaveBeenCalled();
      expect(callbacks.onConfigChanged).toHaveBeenCalledWith({ provider: 'none' });
      expect(storage.saveSyncConfigFile).toHaveBeenCalled();
    });

    it('should teardown engine on clearMismatch', async () => {
      const { store, header } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });
      await lifecycle.initAfterUnlock();

      await lifecycle.clearMismatch();

      expect(lifecycle.engine).toBeNull();
    });
  });
});
