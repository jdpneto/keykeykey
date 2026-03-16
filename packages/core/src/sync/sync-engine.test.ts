import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncEngine } from './sync-engine.js';
import type { SyncableStore } from './sync-engine.js';
import { MemoryAdapter } from './memory-adapter.js';
import { createVaultStore } from '../store/vault-store.js';
import { createVaultHeader } from '../crypto/vault-header.js';
import { generateRecoveryKey } from '../crypto/recovery.js';
import type { Argon2Params } from '../crypto/constants.js';
import type { SyncManifest } from './types.js';

const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };
const MASTER_PASSWORD = 'sync-engine-test';

async function makeUnlockedStore() {
  const { raw: recoveryRaw } = generateRecoveryKey();
  const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);
  const store = createVaultStore();
  store.getState().loadHeader(header);
  await store.getState().unlock(MASTER_PASSWORD, []);
  return store;
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
    engine = new SyncEngine({ adapter, store: syncStore });
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

      const manifest = await adapter.readManifest();
      expect(Object.keys(manifest!.items)).toHaveLength(1);
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
      const newEngine = new SyncEngine({ adapter, store });
      const result = await newEngine.sync();
      expect(result.pulled).toBe(1);
      expect(store.getState().items).toHaveLength(1);
    });

    it('should propagate tombstones', async () => {
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
      const manifest = await adapter.readManifest();
      expect(manifest!.tombstones).toHaveProperty(id);
    });

    it('should return zeros for empty sync', async () => {
      const result = await engine.sync();
      expect(result).toEqual({ pulled: 0, pushed: 0, deleted: 0, conflicts: 0 });
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

      const manifest = await adapter.readManifest();
      expect(manifest!.tombstones).toHaveProperty(id);
      expect(manifest!.items).not.toHaveProperty(id);
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
  it('calls onVaultReplaced when remote vaultId differs from local', async () => {
    const adapter = new MemoryAdapter();
    const mockStore = createMockStore('local-vault-id');
    const onVaultReplaced = vi.fn();

    // Seed remote manifest with a different vaultId
    const remoteManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: {},
      vaultId: 'remote-vault-id',
    };
    await adapter.writeManifest(remoteManifest);

    const engine = new SyncEngine({ adapter, store: mockStore, onVaultReplaced });
    const result = await engine.sync();

    expect(onVaultReplaced).toHaveBeenCalledWith({
      localVaultId: 'local-vault-id',
      remoteVaultId: 'remote-vault-id',
    });
    expect(result).toEqual({ pushed: 0, pulled: 0, deleted: 0, conflicts: 0 });
  });

  it('does NOT trigger when vaultIds match', async () => {
    const adapter = new MemoryAdapter();
    const mockStore = createMockStore('same-vault-id');
    const onVaultReplaced = vi.fn();

    const remoteManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: {},
      vaultId: 'same-vault-id',
    };
    await adapter.writeManifest(remoteManifest);

    const engine = new SyncEngine({ adapter, store: mockStore, onVaultReplaced });
    await engine.sync();

    expect(onVaultReplaced).not.toHaveBeenCalled();
  });

  it('does NOT trigger when remote manifest is null (fresh cloud)', async () => {
    const adapter = new MemoryAdapter();
    const mockStore = createMockStore('local-vault-id');
    const onVaultReplaced = vi.fn();

    // No manifest written — adapter.readManifest() returns null
    const engine = new SyncEngine({ adapter, store: mockStore, onVaultReplaced });
    await engine.sync();

    expect(onVaultReplaced).not.toHaveBeenCalled();
  });

  it('does NOT trigger when remote has no vaultId (legacy manifest)', async () => {
    const adapter = new MemoryAdapter();
    const mockStore = createMockStore('local-vault-id');
    const onVaultReplaced = vi.fn();

    // Legacy manifest without vaultId field
    const remoteManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: {},
    };
    await adapter.writeManifest(remoteManifest);

    const engine = new SyncEngine({ adapter, store: mockStore, onVaultReplaced });
    await engine.sync();

    expect(onVaultReplaced).not.toHaveBeenCalled();
  });
});

describe('SyncEngine path traversal protection', () => {
  it('should skip malformed item IDs from remote manifest during pull', async () => {
    const adapter = new MemoryAdapter();
    const store = await makeUnlockedStore();
    const syncStore = Object.assign(store, { getVaultId: () => 'test-vault-id' });
    const engine = new SyncEngine({ adapter, store: syncStore });

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
    const manifest = await adapter.readManifest();
    manifest!.items['../../etc/passwd'] = {
      updatedAt: new Date().toISOString(),
      hash: 'deadbeef',
    };
    await adapter.writeManifest(manifest!);

    // readItem should never be called with the malicious ID
    const readItemSpy = vi.spyOn(adapter, 'readItem');

    // Create fresh engine (simulates new device that sees the tampered manifest)
    store.getState().deleteItem(store.getState().items[0].id);
    const freshEngine = new SyncEngine({ adapter, store: syncStore });
    await freshEngine.sync();

    // The traversal ID should have been skipped
    const calledIds = readItemSpy.mock.calls.map((c) => c[0]);
    expect(calledIds).not.toContain('../../etc/passwd');
  });

  it('should skip malformed tombstone IDs from remote manifest', async () => {
    const adapter = new MemoryAdapter();
    const store = await makeUnlockedStore();
    const syncStore = Object.assign(store, { getVaultId: () => 'test-vault-id' });
    const engine = new SyncEngine({ adapter, store: syncStore });

    // Write a manifest with a malicious tombstone ID
    const manifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: {
        '../../../config': { deletedAt: new Date().toISOString() },
      },
    };
    await adapter.writeManifest(manifest);

    const deleteItemSpy = vi.spyOn(adapter, 'deleteItem');
    await engine.sync();

    // The traversal ID should have been skipped
    const deletedIds = deleteItemSpy.mock.calls.map((c) => c[0]);
    expect(deletedIds).not.toContain('../../../config');
  });
});
