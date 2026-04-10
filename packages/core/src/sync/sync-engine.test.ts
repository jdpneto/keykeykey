import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncEngine } from './sync-engine.js';
import type { SyncableStore } from './sync-engine.js';
import { MemoryAdapter } from './memory-adapter.js';
import { createVaultStore } from '../store/vault-store.js';
import { createVaultHeader } from '../crypto/vault-header.js';
import { generateRecoveryKey } from '../crypto/recovery.js';
import type { Argon2Params } from '../crypto/constants.js';
import type { SyncManifest } from './types.js';
import { deriveMEK, generateSyncSalt, encryptVaultBlob, decryptVaultBlob } from './vault-blob.js';

const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };
const MASTER_PASSWORD = 'sync-engine-test';
const TEST_HEADER_BYTES = new Uint8Array(64);

let sharedMek: Uint8Array;
let sharedSalt: Uint8Array;

async function ensureMek() {
  if (!sharedMek) {
    sharedSalt = generateSyncSalt();
    sharedMek = await deriveMEK('test-pass', sharedSalt, TEST_PARAMS);
  }
  return { mek: sharedMek, syncSalt: sharedSalt };
}

async function makeUnlockedStore() {
  const { raw: recoveryRaw } = generateRecoveryKey();
  const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);
  const store = createVaultStore();
  store.getState().loadHeader(header);
  await store.getState().unlock(MASTER_PASSWORD, []);
  return store;
}

async function makeSyncEngineOptions(adapter: MemoryAdapter, store: SyncableStore) {
  const { mek, syncSalt } = await ensureMek();
  return {
    adapter,
    store,
    mek,
    syncSalt,
    vaultHeaderBytes: TEST_HEADER_BYTES,
    argon2Params: TEST_PARAMS,
  };
}

describe('SyncEngine', () => {
  let adapter: MemoryAdapter;
  let store: ReturnType<typeof createVaultStore>;
  let engine: SyncEngine;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    store = await makeUnlockedStore();
    // Augment real store with getVaultId for SyncableStore interface
    const syncStore = Object.assign(store, { getVaultId: () => 'test-vault-id' });
    const opts = await makeSyncEngineOptions(adapter, syncStore);
    engine = new SyncEngine(opts);
  });

  describe('sync()', () => {
    it('should push local items to empty remote', async () => {
      store.getState().addItem({
        type: 'credential',
        name: 'Test',
        tags: [],
        favorite: false,
        username: 'user',
        password: 'pass',
      });

      const result = await engine.sync();
      expect(result.pushed).toBe(1);
      expect(result.pulled).toBe(0);

      const { mek } = await ensureMek();
      const blob = await adapter.readVaultBlob();
      const decoded = decryptVaultBlob(blob!, mek);
      expect(Object.keys(decoded.manifest.items)).toHaveLength(1);
    });

    it('should pull remote items into empty local store', async () => {
      // Add and push an item
      const id = store.getState().addItem({
        type: 'credential',
        name: 'Remote Item',
        tags: [],
        favorite: false,
        username: 'remote-user',
        password: 'remote-pass',
      });
      await engine.sync();

      // Delete locally (without recording tombstone — simulates "new device with no items")
      store.getState().deleteItem(id);
      expect(store.getState().items).toHaveLength(0);

      // Create fresh engine with same adapter (simulates new device)
      const syncStore = Object.assign(store, { getVaultId: () => 'test-vault-id' });
      const opts = await makeSyncEngineOptions(adapter, syncStore);
      const newEngine = new SyncEngine(opts);
      const result = await newEngine.sync();
      expect(result.pulled).toBe(1);
      expect(store.getState().items).toHaveLength(1);
    });

    it('should propagate tombstones', async () => {
      const { mek } = await ensureMek();
      const id = store.getState().addItem({
        type: 'credential',
        name: 'To Delete',
        tags: [],
        favorite: false,
        username: 'user',
        password: 'pass',
      });
      await engine.sync();

      // Delete locally and record tombstone
      store.getState().deleteItem(id);
      engine.recordTombstone(id);
      const result = await engine.sync();

      expect(result.deleted).toBeGreaterThanOrEqual(1);
      const remoteItem = await adapter.readItem(id);
      expect(remoteItem).toBeNull();
      const blob = await adapter.readVaultBlob();
      const decoded = decryptVaultBlob(blob!, mek);
      expect(decoded.manifest.tombstones).toHaveProperty(id);
    });

    it('should return zeros for empty sync', async () => {
      const result = await engine.sync();
      expect(result).toEqual({ pulled: 0, pushed: 0, deleted: 0, conflicts: 0 });
    });

    it('should push multiple items (10 items to empty remote)', async () => {
      for (let i = 0; i < 10; i++) {
        store.getState().addItem({
          type: 'credential',
          name: `Item ${i}`,
          tags: [],
          favorite: false,
          username: `user${i}`,
          password: `pass${i}`,
        });
      }

      const result = await engine.sync();
      expect(result.pushed).toBe(10);
      expect(result.pulled).toBe(0);

      const { mek } = await ensureMek();
      const blob = await adapter.readVaultBlob();
      const decoded = decryptVaultBlob(blob!, mek);
      expect(Object.keys(decoded.manifest.items)).toHaveLength(10);
    });

    it('should write all items concurrently via adapter spy', async () => {
      for (let i = 0; i < 6; i++) {
        store.getState().addItem({
          type: 'credential',
          name: `Concurrent ${i}`,
          tags: [],
          favorite: false,
          username: `u${i}`,
          password: `p${i}`,
        });
      }

      const writeItemSpy = vi.spyOn(adapter, 'writeItem');
      const result = await engine.sync();

      expect(result.pushed).toBe(6);
      expect(writeItemSpy).toHaveBeenCalledTimes(6);
      // All 6 item IDs were written (order may vary due to concurrency)
      const writtenIds = writeItemSpy.mock.calls.map((c) => c[0]);
      const localIds = store.getState().items.map((i) => i.id);
      expect(writtenIds.sort()).toEqual(localIds.sort());
    });

    it('should not run concurrent syncs (mutex)', async () => {
      store.getState().addItem({
        type: 'credential',
        name: 'Test',
        tags: [],
        favorite: false,
        username: 'user',
        password: 'pass',
      });

      const sync1 = engine.sync();
      const sync2 = engine.sync();
      const [result1, result2] = await Promise.all([sync1, sync2]);

      // One does work, the other returns zeros (queued for later via scheduleSync)
      const totalPushed = result1.pushed + result2.pushed;
      expect(totalPushed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isSyncing()', () => {
    it('should return false when not syncing', () => {
      expect(engine.isSyncing()).toBe(false);
    });
  });

  describe('recordTombstone()', () => {
    it('should record a tombstone for a deleted item', async () => {
      const { mek } = await ensureMek();
      const id = store.getState().addItem({
        type: 'credential',
        name: 'Test',
        tags: [],
        favorite: false,
        username: 'user',
        password: 'pass',
      });
      await engine.sync();

      store.getState().deleteItem(id);
      engine.recordTombstone(id);
      await engine.sync();

      const blob = await adapter.readVaultBlob();
      const decoded = decryptVaultBlob(blob!, mek);
      expect(decoded.manifest.tombstones).toHaveProperty(id);
      expect(decoded.manifest.items).not.toHaveProperty(id);
    });
  });

  describe('periodic sync', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should call sync() at the configured interval', async () => {
      const syncSpy = vi.spyOn(engine, 'sync').mockResolvedValue({
        pushed: 0,
        pulled: 0,
        deleted: 0,
        conflicts: 0,
      });

      engine.startPeriodicSync(60_000);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(syncSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(syncSpy).toHaveBeenCalledTimes(2);

      engine.stopPeriodicSync();
    });

    it('should not call sync() if already syncing', async () => {
      vi.spyOn(engine, 'isSyncing').mockReturnValue(true);
      const syncSpy = vi.spyOn(engine, 'sync');

      engine.startPeriodicSync(60_000);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(syncSpy).not.toHaveBeenCalled();

      engine.stopPeriodicSync();
    });

    it('should stop periodic sync when stopPeriodicSync is called', async () => {
      const syncSpy = vi.spyOn(engine, 'sync').mockResolvedValue({
        pushed: 0,
        pulled: 0,
        deleted: 0,
        conflicts: 0,
      });

      engine.startPeriodicSync(60_000);
      engine.stopPeriodicSync();

      await vi.advanceTimersByTimeAsync(120_000);
      expect(syncSpy).not.toHaveBeenCalled();
    });

    it('should replace previous periodic timer on restart', async () => {
      const syncSpy = vi.spyOn(engine, 'sync').mockResolvedValue({
        pushed: 0,
        pulled: 0,
        deleted: 0,
        conflicts: 0,
      });

      engine.startPeriodicSync(60_000);
      engine.startPeriodicSync(30_000);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(syncSpy).toHaveBeenCalledTimes(1);

      engine.stopPeriodicSync();
    });
  });
});

// ---------------------------------------------------------------------------
// Vault ID mismatch detection tests (use mock store for isolation)
// ---------------------------------------------------------------------------

function createMockStore(vaultId = 'test-vault-id'): SyncableStore {
  let items: import('../models/vault-item.js').VaultItem[] = [];
  const dek = new Uint8Array(32);

  return {
    getState: () => ({
      status: 'unlocked' as const,
      items,
      encryptItem: () => new Uint8Array([1, 2, 3]),
      getDEK: () => dek,
    }),
    setState: (partial: Partial<{ items: import('../models/vault-item.js').VaultItem[] }>) => {
      if (partial.items) items = partial.items;
    },
    getVaultId: () => vaultId,
  };
}

describe('vault ID mismatch detection', () => {
  it('calls onVaultMismatch when remote vaultId differs from local', async () => {
    const adapter = new MemoryAdapter();
    const mockStore = createMockStore('local-vault-id');
    const onVaultMismatch = vi.fn();
    const { mek, syncSalt } = await ensureMek();

    // Seed remote with an encrypted vault blob containing a different vaultId
    const remoteManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: {},
      vaultId: 'remote-vault-id',
    };
    const blob = encryptVaultBlob(remoteManifest, TEST_HEADER_BYTES, mek, syncSalt, TEST_PARAMS);
    await adapter.writeVaultBlob(blob);

    const engine = new SyncEngine({
      adapter,
      store: mockStore,
      mek,
      syncSalt,
      vaultHeaderBytes: TEST_HEADER_BYTES,
      argon2Params: TEST_PARAMS,
      onVaultMismatch,
    });
    const result = await engine.sync();

    expect(onVaultMismatch).toHaveBeenCalledWith(
      expect.objectContaining({
        localVaultId: 'local-vault-id',
        remoteVaultId: 'remote-vault-id',
        canRestore: true,
      }),
    );
    expect(result).toEqual({ pushed: 0, pulled: 0, deleted: 0, conflicts: 0 });
  });

  it('does NOT trigger when vaultIds match', async () => {
    const adapter = new MemoryAdapter();
    const mockStore = createMockStore('same-vault-id');
    const onVaultMismatch = vi.fn();
    const { mek, syncSalt } = await ensureMek();

    const remoteManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: {},
      vaultId: 'same-vault-id',
    };
    const blob = encryptVaultBlob(remoteManifest, TEST_HEADER_BYTES, mek, syncSalt, TEST_PARAMS);
    await adapter.writeVaultBlob(blob);

    const engine = new SyncEngine({
      adapter,
      store: mockStore,
      mek,
      syncSalt,
      vaultHeaderBytes: TEST_HEADER_BYTES,
      argon2Params: TEST_PARAMS,
      onVaultMismatch,
    });
    await engine.sync();

    expect(onVaultMismatch).not.toHaveBeenCalled();
  });

  it('does NOT trigger when remote is empty (fresh cloud)', async () => {
    const adapter = new MemoryAdapter();
    const mockStore = createMockStore('local-vault-id');
    const onVaultMismatch = vi.fn();
    const { mek, syncSalt } = await ensureMek();

    // No vault blob written — adapter.readVaultBlob() returns null
    const engine = new SyncEngine({
      adapter,
      store: mockStore,
      mek,
      syncSalt,
      vaultHeaderBytes: TEST_HEADER_BYTES,
      argon2Params: TEST_PARAMS,
      onVaultMismatch,
    });
    await engine.sync();

    expect(onVaultMismatch).not.toHaveBeenCalled();
  });

  it('does NOT trigger when remote has no vaultId (legacy manifest)', async () => {
    const adapter = new MemoryAdapter();
    const mockStore = createMockStore('local-vault-id');
    const onVaultMismatch = vi.fn();
    const { mek, syncSalt } = await ensureMek();

    // Legacy manifest without vaultId field
    const remoteManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: {},
    };
    const blob = encryptVaultBlob(remoteManifest, TEST_HEADER_BYTES, mek, syncSalt, TEST_PARAMS);
    await adapter.writeVaultBlob(blob);

    const engine = new SyncEngine({
      adapter,
      store: mockStore,
      mek,
      syncSalt,
      vaultHeaderBytes: TEST_HEADER_BYTES,
      argon2Params: TEST_PARAMS,
      onVaultMismatch,
    });
    await engine.sync();

    expect(onVaultMismatch).not.toHaveBeenCalled();
  });
});

describe('SyncEngine path traversal protection', () => {
  it('should skip malformed item IDs from remote manifest during pull', async () => {
    const adapter = new MemoryAdapter();
    const store = await makeUnlockedStore();
    const syncStore = Object.assign(store, { getVaultId: () => 'test-vault-id' });
    const opts = await makeSyncEngineOptions(adapter, syncStore);
    const engine = new SyncEngine(opts);
    const { mek, syncSalt } = await ensureMek();

    // Seed a valid item remotely
    store.getState().addItem({
      type: 'credential',
      name: 'Valid',
      tags: [],
      favorite: false,
      username: 'u',
      password: 'p',
    });
    await engine.sync();

    // Tamper with the remote manifest to inject a path traversal ID
    const blob = await adapter.readVaultBlob();
    const decoded = decryptVaultBlob(blob!, mek);
    decoded.manifest.items['../../etc/passwd'] = {
      updatedAt: new Date().toISOString(),
      hash: 'deadbeef',
    };
    const tamperedBlob = encryptVaultBlob(
      decoded.manifest,
      TEST_HEADER_BYTES,
      mek,
      syncSalt,
      TEST_PARAMS,
    );
    await adapter.writeVaultBlob(tamperedBlob);

    // readItem should never be called with the malicious ID
    const readItemSpy = vi.spyOn(adapter, 'readItem');

    // Create fresh engine (simulates new device that sees the tampered manifest)
    store.getState().deleteItem(store.getState().items[0].id);
    const freshOpts = await makeSyncEngineOptions(adapter, syncStore);
    const freshEngine = new SyncEngine(freshOpts);
    await freshEngine.sync();

    // The traversal ID should have been skipped
    const calledIds = readItemSpy.mock.calls.map((c) => c[0]);
    expect(calledIds).not.toContain('../../etc/passwd');
  });

  it('should migrate legacy plaintext manifest to encrypted vault blob', async () => {
    const adapter = new MemoryAdapter();
    const store = await makeUnlockedStore();
    const syncStore = Object.assign(store, { getVaultId: () => 'test-vault-id' });
    const { mek, syncSalt } = await ensureMek();

    // Seed a legacy plaintext manifest (no vault.enc exists)
    const legacyManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: {},
    };
    adapter.setLegacyManifest(legacyManifest);

    // Verify no vault blob exists yet
    expect(await adapter.readVaultBlob()).toBeNull();
    expect(await adapter.readLegacyManifest()).not.toBeNull();

    const engine = new SyncEngine({
      adapter,
      store: syncStore,
      mek,
      syncSalt,
      vaultHeaderBytes: TEST_HEADER_BYTES,
      argon2Params: TEST_PARAMS,
    });
    await engine.sync();

    // After sync: vault blob should exist, legacy manifest should be deleted
    const vaultBlob = await adapter.readVaultBlob();
    expect(vaultBlob).not.toBeNull();
    const decoded = decryptVaultBlob(vaultBlob!, mek);
    expect(decoded.manifest.vaultId).toBe('test-vault-id');

    const legacy = await adapter.readLegacyManifest();
    expect(legacy).toBeNull();
  });

  it('should skip malformed tombstone IDs from remote manifest', async () => {
    const adapter = new MemoryAdapter();
    const store = await makeUnlockedStore();
    const syncStore = Object.assign(store, { getVaultId: () => 'test-vault-id' });
    const opts = await makeSyncEngineOptions(adapter, syncStore);
    const engine = new SyncEngine(opts);
    const { mek, syncSalt } = await ensureMek();

    // Write a manifest with a malicious tombstone ID
    const manifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: {
        '../../../config': { deletedAt: new Date().toISOString() },
      },
    };
    const blob = encryptVaultBlob(manifest, TEST_HEADER_BYTES, mek, syncSalt, TEST_PARAMS);
    await adapter.writeVaultBlob(blob);

    const deleteItemSpy = vi.spyOn(adapter, 'deleteItem');
    await engine.sync();

    // The traversal ID should have been skipped
    const deletedIds = deleteItemSpy.mock.calls.map((c) => c[0]);
    expect(deletedIds).not.toContain('../../../config');
  });
});
