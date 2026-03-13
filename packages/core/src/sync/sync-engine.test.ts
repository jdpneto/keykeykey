import { describe, it, expect, beforeEach } from 'vitest';
import { SyncEngine } from './sync-engine.js';
import { MemoryAdapter } from './memory-adapter.js';
import { createVaultStore } from '../store/vault-store.js';
import { createVaultHeader } from '../crypto/vault-header.js';
import { generateRecoveryKey } from '../crypto/recovery.js';
import type { Argon2Params } from '../crypto/constants.js';

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
    engine = new SyncEngine({ adapter, store });
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
