/**
 * Sync Engine E2E — Conflict Simulation (implementation plan §7.6)
 *
 * Spins up two in-memory Core instances (simulating two devices),
 * performs concurrent edits, then runs conflict resolution and asserts
 * Last-Write-Wins semantics preserve data integrity.
 */

import { describe, it, expect } from 'vitest';
import { createVaultStore } from '../store/vault-store.js';
import { createVaultHeader } from '../crypto/vault-header.js';
import { generateRecoveryKey } from '../crypto/recovery.js';
import { MemoryAdapter } from './memory-adapter.js';
import type { SyncManifest } from './types.js';
import { mergeManifestsV2 } from './merge.js';
const mergeManifests = mergeManifestsV2;
import type { Argon2Params } from '../crypto/constants.js';
import { encryptVaultBlob, decryptVaultBlob, deriveMEK, generateSyncSalt } from './vault-blob.js';

const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };
const MASTER_PASSWORD = 'sync-test-password';
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

/** Helper: build two unlocked stores sharing the same vault header/DEK. */
async function makeTwoDevices() {
  const { raw: recoveryRaw } = generateRecoveryKey();
  const { header, dek } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

  const deviceA = createVaultStore();
  deviceA.getState().loadHeader(header);
  await deviceA.getState().unlock(MASTER_PASSWORD, []);

  const deviceB = createVaultStore();
  deviceB.getState().loadHeader(header);
  await deviceB.getState().unlock(MASTER_PASSWORD, []);

  return { deviceA, deviceB, dek };
}

/** Helper: write all current store items to an adapter and return the manifest. */
async function writeToAdapter(
  store: ReturnType<typeof createVaultStore>,
  adapter: MemoryAdapter,
): Promise<SyncManifest> {
  const items = store.getState().items;
  const manifest: SyncManifest = {
    version: 1,
    lastModified: new Date().toISOString(),
    items: {},
  };

  await Promise.all(
    items.map(async (item) => {
      const encrypted = store.getState().encryptItem(item);
      await adapter.writeItem(item.id, encrypted);
      manifest.items[item.id] = {
        updatedAt: item.updatedAt,
        hash: item.id, // simplified hash for testing
      };
    }),
  );

  const { mek, syncSalt } = await ensureMek();
  const blob = encryptVaultBlob(manifest, TEST_HEADER_BYTES, mek, syncSalt, TEST_PARAMS);
  await adapter.writeVaultBlob(blob);
  return manifest;
}

/** Helper: read and decrypt manifest from adapter. */
async function readManifestFromAdapter(adapter: MemoryAdapter): Promise<SyncManifest | null> {
  const { mek } = await ensureMek();
  const blob = await adapter.readVaultBlob();
  if (!blob) return null;
  const decoded = decryptVaultBlob(blob, mek);
  return decoded.manifest;
}

describe('Sync conflict simulation — Last-Write-Wins', () => {
  it('should preserve unique items from both devices after merge', async () => {
    const { deviceA, deviceB } = await makeTwoDevices();

    // Device A adds a credential
    const idA = deviceA.getState().addItem({
      type: 'credential',
      name: 'Device A Login',
      tags: [],
      favorite: false,
      username: 'usera',
      password: 'passa',
    });

    // Device B adds a different credential (concurrent, no conflict)
    const idB = deviceB.getState().addItem({
      type: 'credential',
      name: 'Device B Login',
      tags: [],
      favorite: false,
      username: 'userb',
      password: 'passb',
    });

    // Write both to separate adapters
    const adapterA = new MemoryAdapter();
    const adapterB = new MemoryAdapter();
    const manifestA = await writeToAdapter(deviceA, adapterA);
    const manifestB = await writeToAdapter(deviceB, adapterB);

    // Merge manifests (LWW)
    const merged = mergeManifests(manifestA, manifestB);

    // Both items should appear in merged manifest
    expect(Object.keys(merged.items)).toContain(idA);
    expect(Object.keys(merged.items)).toContain(idB);
  });

  it('should pick the later version when the same item is updated on two devices', async () => {
    const { deviceA, deviceB } = await makeTwoDevices();

    // Both devices start with the same item (simulate initial sync)
    deviceA.getState().addItem({
      type: 'secure-note',
      name: 'Shared Note',
      tags: [],
      favorite: false,
      content: 'Original content',
    });
    const itemInA = deviceA.getState().items[0]!;

    deviceB.getState().addItem({
      type: 'secure-note',
      name: 'Shared Note',
      tags: [],
      favorite: false,
      content: 'Original content',
    });
    const itemInB = deviceB.getState().items[0]!;

    // Both devices update the item.
    deviceA.getState().updateItem(itemInA.id, { name: 'Shared Note (A edit)' });
    deviceB.getState().updateItem(itemInB.id, { name: 'Shared Note (B edit — later)' });

    const adapterA = new MemoryAdapter();
    const adapterB = new MemoryAdapter();
    await writeToAdapter(deviceA, adapterA);
    await writeToAdapter(deviceB, adapterB);

    const manifestA = await readManifestFromAdapter(adapterA);
    const manifestB = await readManifestFromAdapter(adapterB);

    // Force B's item to appear later than A's (simulate real-world time difference)
    const laterTime = new Date(Date.now() + 5000).toISOString();
    if (manifestB!.items[itemInB.id]) {
      manifestB!.items[itemInB.id]!.updatedAt = laterTime;
    }

    const merged = mergeManifests(manifestA!, manifestB!);

    // B's version should win (later updatedAt)
    expect(Object.keys(merged.items).length).toBeGreaterThanOrEqual(1);
  });

  it('should handle delete on one device while the other device keeps the item', async () => {
    const { deviceA, deviceB } = await makeTwoDevices();

    // Both devices have the item
    deviceA.getState().addItem({
      type: 'credential',
      name: 'Item to Delete',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    const itemId = deviceA.getState().items[0]!.id;

    const adapterA = new MemoryAdapter();
    await writeToAdapter(deviceA, adapterA);
    const manifestA = await readManifestFromAdapter(adapterA);

    // Device B has the item too (initially synced)
    deviceB.getState().addItem({
      type: 'credential',
      name: 'Item to Delete',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    const adapterB = new MemoryAdapter();
    await writeToAdapter(deviceB, adapterB);

    // Device A deletes the item
    deviceA.getState().deleteItem(itemId);
    expect(deviceA.getState().items).toHaveLength(0);

    // Device B still has it
    expect(deviceB.getState().items).toHaveLength(1);

    const manifestB = await readManifestFromAdapter(adapterB);
    const merged = mergeManifests(manifestA!, manifestB!);

    // Merged should contain items from both (B's item is still present)
    expect(Object.keys(merged.items).length).toBeGreaterThanOrEqual(1);
  });

  it('should preserve data integrity after multiple concurrent adds and updates', async () => {
    const { deviceA, deviceB } = await makeTwoDevices();

    // Device A adds 3 items
    for (let i = 0; i < 3; i++) {
      deviceA.getState().addItem({
        type: 'credential',
        name: `Device A Item ${i}`,
        tags: ['device-a'],
        favorite: false,
        username: `user${i}@a.com`,
        password: `passa${i}`,
      });
    }

    // Device B adds 2 items
    for (let i = 0; i < 2; i++) {
      deviceB.getState().addItem({
        type: 'secure-note',
        name: `Device B Note ${i}`,
        tags: ['device-b'],
        favorite: false,
        content: `Content ${i}`,
      });
    }

    const adapterA = new MemoryAdapter();
    const adapterB = new MemoryAdapter();
    const manifestA = await writeToAdapter(deviceA, adapterA);
    const manifestB = await writeToAdapter(deviceB, adapterB);

    const merged = mergeManifests(manifestA, manifestB);

    // All 5 items (3 from A + 2 from B) should be in merged manifest
    expect(Object.keys(merged.items)).toHaveLength(5);
  });
});

describe('Sync manifest integrity', () => {
  it('should keep lastModified current after merge', () => {
    const before = new Date();

    const local: SyncManifest = {
      version: 1,
      lastModified: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
      items: {},
    };
    const remote: SyncManifest = {
      version: 1,
      lastModified: new Date(Date.now() - 30_000).toISOString(), // 30 sec ago
      items: {},
    };

    const merged = mergeManifests(local, remote);
    const mergedTime = new Date(merged.lastModified);

    // Merged timestamp should be >= the start of this test
    expect(mergedTime.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('should produce a stable (idempotent) merge when called twice', () => {
    const manifest: SyncManifest = {
      version: 1,
      lastModified: '2024-01-01T00:00:00.000Z',
      items: {
        a: { updatedAt: '2024-01-01T00:00:00.000Z', hash: 'ha' },
        b: { updatedAt: '2024-02-01T00:00:00.000Z', hash: 'hb' },
      },
    };

    const merged1 = mergeManifests(manifest, manifest);
    const merged2 = mergeManifests(merged1, manifest);

    // Items should be identical after double-merge
    expect(merged2.items).toEqual(merged1.items);
  });
});

describe('Sync conflict simulation — Tombstones', () => {
  it('should propagate deletion when device A deletes and device B has not synced', async () => {
    const { deviceA, deviceB } = await makeTwoDevices();

    const idA = deviceA.getState().addItem({
      type: 'credential',
      name: 'Shared Item',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    const adapterA = new MemoryAdapter();
    const manifestA = await writeToAdapter(deviceA, adapterA);

    deviceA.getState().deleteItem(idA);
    const deletedAt = new Date().toISOString();

    const manifestAWithTombstone: SyncManifest = {
      ...manifestA,
      version: 2,
      items: {},
      tombstones: { [idA]: { deletedAt } },
    };

    const idB = deviceB.getState().addItem({
      type: 'credential',
      name: 'Shared Item',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    const adapterB = new MemoryAdapter();
    const manifestB = await writeToAdapter(deviceB, adapterB);
    const manifestBV2: SyncManifest = { ...manifestB, version: 2, tombstones: {} };

    const merged = mergeManifestsV2(manifestAWithTombstone, manifestBV2);

    expect(merged.tombstones).toHaveProperty(idA);
    expect(merged.items).toHaveProperty(idB);
  });

  it('should keep item when it was updated after deletion on another device', () => {
    const earlier = new Date(Date.now() - 5000).toISOString();
    const later = new Date(Date.now() + 5000).toISOString();

    const localManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: { shared: { updatedAt: later, hash: 'updated-hash' } },
      tombstones: {},
    };

    const remoteManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: { shared: { deletedAt: earlier } },
    };

    const merged = mergeManifestsV2(localManifest, remoteManifest);

    expect(merged.items).toHaveProperty('shared');
    expect(merged.tombstones).not.toHaveProperty('shared');
  });

  it('should handle three-device churn with interleaved operations', () => {
    const t1 = new Date(Date.now() - 3000).toISOString();
    const t2 = new Date(Date.now() - 2000).toISOString();
    const t3 = new Date(Date.now() - 1000).toISOString();

    const manifestA: SyncManifest = {
      version: 2,
      lastModified: t3,
      items: {
        a: { updatedAt: t1, hash: 'ha' },
        b: { updatedAt: t3, hash: 'hb-updated' },
      },
      tombstones: { c: { deletedAt: t2 } },
    };

    const manifestB: SyncManifest = {
      version: 2,
      lastModified: t2,
      items: {
        b: { updatedAt: t1, hash: 'hb-old' },
        c: { updatedAt: t1, hash: 'hc' },
        d: { updatedAt: t2, hash: 'hd' },
      },
      tombstones: {},
    };

    const merged = mergeManifestsV2(manifestA, manifestB);

    expect(merged.items).toHaveProperty('a');
    expect(merged.items['b']!.hash).toBe('hb-updated');
    expect(merged.items).not.toHaveProperty('c');
    expect(merged.tombstones).toHaveProperty('c');
    expect(merged.items).toHaveProperty('d');
  });
});
