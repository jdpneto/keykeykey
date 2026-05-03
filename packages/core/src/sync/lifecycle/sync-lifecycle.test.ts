import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncLifecycle } from './sync-lifecycle.js';
import type { PlatformStorage, SyncLifecycleCallbacks } from './sync-lifecycle.js';
import type { SyncableStore } from '../core/sync-engine.js';
import type { SyncConfig } from '../config/schema.js';
import { DEFAULT_SYNC_CONFIG } from '../config/schema.js';
import { encryptSyncConfig } from '../config/encryption.js';
import { randomBytes } from '@noble/hashes/utils';
import { createVaultHeader, serializeVaultHeader } from '../../crypto/vault-header.js';
import type { VaultHeader } from '../../crypto/vault-header.js';
import { encrypt } from '../../crypto/encryption.js';
import type { VaultItem } from '../../models/vault-item.js';
import { MemoryAdapter } from '../adapters/memory-adapter.js';
import { encryptVaultBlob } from '../blob/vault-blob.js';
import { generateSyncSalt, deriveMEK } from '../blob/mek.js';
import { generateRecoveryKey } from '../../crypto/recovery.js';
import type { SyncManifest } from '../core/types.js';
import type { RestoreProgressEvent } from './restore.js';
import { hashEncryptedItem } from '../core/item-hash.js';

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
  store: SyncableStore & {
    getState: () => {
      status: string;
      items: VaultItem[];
      header: VaultHeader;
      encryptItem: (item: VaultItem) => Uint8Array;
      getDEK: () => Uint8Array;
    };
  };
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
  } as SyncableStore & {
    getState: () => {
      status: string;
      items: VaultItem[];
      header: VaultHeader;
      encryptItem: (item: VaultItem) => Uint8Array;
      getDEK: () => Uint8Array;
    };
  };

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

    it('should return recorded mismatch info with mismatch errors', async () => {
      const { store, header } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });
      const mismatchInfo = {
        localVaultId: 'local-vault',
        remoteVaultId: 'remote-vault',
        canRestore: true,
        remoteItemCount: 2,
        remoteVaultHeader: null,
      };
      (lifecycle as unknown as { _mismatchInfo: typeof mismatchInfo })._mismatchInfo = mismatchInfo;

      const result = await lifecycle.triggerSync();

      expect(result.error).toBe('Remote vault mismatch — resolve it before syncing');
      expect(result.lastSynced).toBeNull();
      expect(result.mismatchInfo).toBe(mismatchInfo);
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

  // ---------------------------------------------------------------------------
  // mergeVaults / replaceRemote — sync must complete before methods return
  // ---------------------------------------------------------------------------
  //
  // These pin the fix for the `lastSynced`-before-upload race. The old
  // `_createEngine(withInitialSync=true)` path used `initSyncEngine` which
  // fired `engine.sync()` fire-and-forget. That meant `mergeVaults` and
  // `replaceRemote` returned `{ success: true }` before items were actually
  // on the remote — so the extension handler's `ctx.setLastSynced(...)`
  // lied whenever the popup or service worker closed mid-upload.

  async function setupMergeReplaceLifecycle(): Promise<{
    lifecycle: SyncLifecycle;
    adapter: MemoryAdapter;
    store: Awaited<ReturnType<typeof createTestVaultStore>>['store'];
    config: SyncConfig;
  }> {
    const { store, header } = await createTestVaultStore();
    const adapter = new MemoryAdapter();

    const lifecycle = new SyncLifecycle({
      store,
      storage,
      platformCallbacks: {},
      callbacks,
      getHeader: () => header,
      // `adapterFactory` short-circuits `createAdapterFromConfig` to
      // return the in-memory adapter — cleaner than vi.spyOn which can't
      // catch within-module calls from `createSyncEngineFromConfig`.
      adapterOverrides: { adapterFactory: () => adapter },
    });

    const config: SyncConfig = {
      provider: 'webdav',
      masterPassword: TEST_PASSWORD,
      webdav: { url: 'https://example.com/dav', username: 'u', password: 'p' },
    };
    await lifecycle.saveConfig(config);

    return { lifecycle, adapter, store, config };
  }

  describe('replaceRemote', () => {
    it('uploads local items before returning', { timeout: 30_000 }, async () => {
      const { lifecycle, adapter, store } = await setupMergeReplaceLifecycle();
      {
        const now = new Date().toISOString();
        const item: VaultItem = {
          id: '00000000-0000-4000-a000-000000000010',
          type: 'credential',
          name: 'Local Item',
          tags: [],
          createdAt: now,
          updatedAt: now,
          favorite: false,
          username: 'u',
          password: 'p',
          passwordHistory: [],
        };
        store.setState({ items: [item] });

        const result = await lifecycle.replaceRemote();
        expect(result.success).toBe(true);

        // Without the fix, listItems() would race and return 0 when called
        // synchronously after replaceRemote. With the fix, the initial
        // sync is awaited, so the item is already uploaded.
        const remoteItems = await adapter.listItems();
        expect(remoteItems).toEqual([item.id]);
        expect(lifecycle.engine?.isSyncing()).toBe(false);
      }
    });
  });

  describe('mergeVaults', () => {
    it('uploads merged items before returning', { timeout: 30_000 }, async () => {
      const { lifecycle, adapter, store } = await setupMergeReplaceLifecycle();
      {
        // Seed the remote with one item under the same master password, so
        // mergeVaults has something to merge rather than falling through.
        const { header: remoteHeader, dek: remoteDek } = await createVaultHeader(
          TEST_PASSWORD,
          randomBytes(32),
          TEST_PARAMS,
        );
        const remoteHeaderBytes = serializeVaultHeader(remoteHeader);
        const now = new Date().toISOString();
        const remoteItem: VaultItem = {
          id: '00000000-0000-4000-a000-000000000020',
          type: 'credential',
          name: 'Remote Item',
          tags: [],
          createdAt: now,
          updatedAt: now,
          favorite: false,
          username: 'ru',
          password: 'rp',
          passwordHistory: [],
        };
        const enc = encrypt(new TextEncoder().encode(JSON.stringify(remoteItem)), remoteDek);
        await adapter.writeItem(remoteItem.id, enc);
        const manifest: SyncManifest = {
          version: 2,
          lastModified: now,
          vaultId: remoteHeader.vaultId,
          items: {
            [remoteItem.id]: { updatedAt: now, hash: hashEncryptedItem(enc) },
          },
        };
        const salt = generateSyncSalt();
        const mek = await deriveMEK(TEST_PASSWORD, salt, TEST_PARAMS);
        await adapter.writeVaultBlob(
          encryptVaultBlob(manifest, remoteHeaderBytes, mek, salt, TEST_PARAMS),
        );

        // Local has one item too.
        const localItem: VaultItem = {
          id: '00000000-0000-4000-a000-000000000021',
          type: 'credential',
          name: 'Local Item',
          tags: [],
          createdAt: now,
          updatedAt: now,
          favorite: false,
          username: 'lu',
          password: 'lp',
          passwordHistory: [],
        };
        store.setState({ items: [localItem] });

        const result = await lifecycle.mergeVaults();
        expect(result.success).toBe(true);

        const remoteItems = await adapter.listItems();
        // Both items should be on the remote by the time mergeVaults returns.
        expect(new Set(remoteItems)).toEqual(new Set([localItem.id, remoteItem.id]));
        expect(lifecycle.engine?.isSyncing()).toBe(false);
      }
    });
  });

  describe('restoreFromCloud progress', () => {
    it(
      'does not delete local storage when remote item integrity fails',
      { timeout: 30_000 },
      async () => {
        const { store, header } = await createTestVaultStore();
        const adapter = new MemoryAdapter();
        const recoveryKey = generateRecoveryKey();
        const { header: cloudHeader, dek: cloudDek } = await createVaultHeader(
          TEST_PASSWORD,
          recoveryKey.raw,
          TEST_PARAMS,
        );
        const headerBytes = serializeVaultHeader(cloudHeader);
        const now = new Date().toISOString();
        const itemId = '00000000-0000-4000-a000-000000000099';
        const item: VaultItem = {
          id: itemId,
          type: 'credential',
          name: 'Tampered Item',
          tags: [],
          createdAt: now,
          updatedAt: now,
          favorite: false,
          username: 'user',
          password: 'pass',
          passwordHistory: [],
        };
        const encrypted = encrypt(new TextEncoder().encode(JSON.stringify(item)), cloudDek);
        await adapter.writeItem(itemId, encrypted);

        const manifest: SyncManifest = {
          version: 2,
          lastModified: now,
          items: {
            [itemId]: { updatedAt: now, hash: hashEncryptedItem(new Uint8Array([1, 2, 3])) },
          },
        };
        const syncSalt = generateSyncSalt();
        const mek = await deriveMEK(TEST_PASSWORD, syncSalt, TEST_PARAMS);
        await adapter.writeVaultBlob(
          encryptVaultBlob(manifest, headerBytes, mek, syncSalt, TEST_PARAMS),
        );

        const factoryModule = await import('../config/factory.js');
        const spy = vi
          .spyOn(factoryModule, 'createAdapterFromConfig')
          .mockReturnValue(
            adapter as unknown as ReturnType<typeof factoryModule.createAdapterFromConfig>,
          );

        try {
          const lifecycle = new SyncLifecycle({
            store,
            storage,
            platformCallbacks: {},
            callbacks,
            getHeader: () => header,
          });

          const config: SyncConfig = {
            provider: 'webdav',
            webdavUrl: 'https://example.com/dav',
            webdavUsername: 'user',
            webdavPassword: 'pass',
          };

          const result = await lifecycle.restoreFromCloud(config, TEST_PASSWORD);

          expect(result.success).toBe(false);
          expect(result.error).toContain('Remote item integrity check failed');
          expect(storage.saveVaultHeader).not.toHaveBeenCalled();
          expect(storage.deleteAllItems).not.toHaveBeenCalled();
        } finally {
          spy.mockRestore();
        }
      },
    );

    it(
      'does not delete local storage when a manifest item is missing',
      { timeout: 30_000 },
      async () => {
        const { store, header } = await createTestVaultStore();
        const adapter = new MemoryAdapter();
        const recoveryKey = generateRecoveryKey();
        const { header: cloudHeader } = await createVaultHeader(
          TEST_PASSWORD,
          recoveryKey.raw,
          TEST_PARAMS,
        );
        const headerBytes = serializeVaultHeader(cloudHeader);
        const now = new Date().toISOString();
        const missingItemId = '00000000-0000-4000-a000-000000000098';

        const manifest: SyncManifest = {
          version: 2,
          lastModified: now,
          items: {
            [missingItemId]: { updatedAt: now, hash: 'deadbeef' },
          },
        };
        const syncSalt = generateSyncSalt();
        const mek = await deriveMEK(TEST_PASSWORD, syncSalt, TEST_PARAMS);
        await adapter.writeVaultBlob(
          encryptVaultBlob(manifest, headerBytes, mek, syncSalt, TEST_PARAMS),
        );

        const factoryModule = await import('../config/factory.js');
        const spy = vi
          .spyOn(factoryModule, 'createAdapterFromConfig')
          .mockReturnValue(
            adapter as unknown as ReturnType<typeof factoryModule.createAdapterFromConfig>,
          );

        try {
          const lifecycle = new SyncLifecycle({
            store,
            storage,
            platformCallbacks: {},
            callbacks,
            getHeader: () => header,
          });

          const config: SyncConfig = {
            provider: 'webdav',
            webdavUrl: 'https://example.com/dav',
            webdavUsername: 'user',
            webdavPassword: 'pass',
          };

          const result = await lifecycle.restoreFromCloud(config, TEST_PASSWORD);

          expect(result.success).toBe(false);
          expect(result.error).toContain('Remote item missing');
          expect(storage.saveVaultHeader).not.toHaveBeenCalled();
          expect(storage.deleteAllItems).not.toHaveBeenCalled();
        } finally {
          spy.mockRestore();
        }
      },
    );

    it('should fire downloading and importing progress events', { timeout: 30000 }, async () => {
      const { store, header } = await createTestVaultStore();

      // Build a MemoryAdapter with a valid encrypted vault
      const adapter = new MemoryAdapter();
      const recoveryKey = generateRecoveryKey();
      const { header: cloudHeader, dek: cloudDek } = await createVaultHeader(
        TEST_PASSWORD,
        recoveryKey.raw,
        TEST_PARAMS,
      );
      const headerBytes = serializeVaultHeader(cloudHeader);

      // Create two valid VaultItem objects
      const itemId1 = '00000000-0000-4000-a000-000000000001';
      const itemId2 = '00000000-0000-4000-a000-000000000002';
      const now = new Date().toISOString();
      const item1: VaultItem = {
        id: itemId1,
        type: 'credential',
        name: 'Test Credential 1',
        tags: [],
        createdAt: now,
        updatedAt: now,
        favorite: false,
        username: 'user1',
        password: 'pass1',
        passwordHistory: [],
      };
      const item2: VaultItem = {
        id: itemId2,
        type: 'credential',
        name: 'Test Credential 2',
        tags: [],
        createdAt: now,
        updatedAt: now,
        favorite: false,
        username: 'user2',
        password: 'pass2',
        passwordHistory: [],
      };

      // Encrypt items with the cloud DEK and write to adapter
      const enc1 = encrypt(new TextEncoder().encode(JSON.stringify(item1)), cloudDek);
      const enc2 = encrypt(new TextEncoder().encode(JSON.stringify(item2)), cloudDek);
      await adapter.writeItem(itemId1, enc1);
      await adapter.writeItem(itemId2, enc2);

      // Build manifest and encrypted vault blob
      const manifest: SyncManifest = {
        version: 2,
        lastModified: now,
        items: {
          [itemId1]: { updatedAt: now, hash: hashEncryptedItem(enc1) },
          [itemId2]: { updatedAt: now, hash: hashEncryptedItem(enc2) },
        },
      };
      const syncSalt = generateSyncSalt();
      const mek = await deriveMEK(TEST_PASSWORD, syncSalt, TEST_PARAMS);
      const blobData = encryptVaultBlob(manifest, headerBytes, mek, syncSalt, TEST_PARAMS);
      await adapter.writeVaultBlob(blobData);

      // Mock createAdapterFromConfig to return our adapter
      const factoryModule = await import('../config/factory.js');
      const spy = vi
        .spyOn(factoryModule, 'createAdapterFromConfig')
        .mockReturnValue(
          adapter as unknown as ReturnType<typeof factoryModule.createAdapterFromConfig>,
        );

      const lifecycle = new SyncLifecycle({
        store,
        storage,
        platformCallbacks: {},
        callbacks,
        getHeader: () => header,
      });

      const progressEvents: RestoreProgressEvent[] = [];
      const onProgress = (event: RestoreProgressEvent) => {
        progressEvents.push({ ...event });
      };

      const config: SyncConfig = {
        provider: 'webdav',
        webdavUrl: 'https://example.com/dav',
        webdavUsername: 'user',
        webdavPassword: 'pass',
      };

      const result = await lifecycle.restoreFromCloud(config, TEST_PASSWORD, onProgress);

      expect(result.success).toBe(true);
      expect(result.itemCount).toBe(2);

      // Verify downloading events fired
      const downloadingEvents = progressEvents.filter((e) => e.phase === 'downloading');
      expect(downloadingEvents.length).toBeGreaterThanOrEqual(1);

      // Verify importing events fired
      const importingEvents = progressEvents.filter((e) => e.phase === 'importing');
      expect(importingEvents.length).toBe(2);
      expect(importingEvents[0]).toEqual({ phase: 'importing', completed: 1, total: 2 });
      expect(importingEvents[1]).toEqual({ phase: 'importing', completed: 2, total: 2 });

      spy.mockRestore();
    });
  });
});
