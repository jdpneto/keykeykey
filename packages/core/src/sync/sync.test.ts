import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryAdapter } from './adapters/memory-adapter.js';
import { mergeManifestsV2 as mergeManifests } from './core/merge.js';
import type { SyncManifest } from './core/types.js';

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter;

  beforeEach(() => {
    adapter = new MemoryAdapter();
  });

  describe('vault blob', () => {
    it('should return null when no vault blob exists', async () => {
      const blob = await adapter.readVaultBlob();
      expect(blob).toBeNull();
    });

    it('should round-trip a vault blob', async () => {
      const data = new Uint8Array([10, 20, 30, 40, 50]);
      await adapter.writeVaultBlob(data);
      const read = await adapter.readVaultBlob();
      expect(read).toEqual(data);
    });

    it('should return a copy (not a reference)', async () => {
      const data = new Uint8Array([1, 2, 3]);
      await adapter.writeVaultBlob(data);
      const read = await adapter.readVaultBlob();
      read![0] = 99;
      const readAgain = await adapter.readVaultBlob();
      expect(readAgain![0]).toBe(1);
    });
  });

  describe('items', () => {
    it('should return null for non-existent item', async () => {
      const item = await adapter.readItem('nonexistent');
      expect(item).toBeNull();
    });

    it('should round-trip an item', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      await adapter.writeItem('item-1', data);
      const read = await adapter.readItem('item-1');
      expect(read).toEqual(data);
    });

    it('should return a copy (not a reference)', async () => {
      const data = new Uint8Array([1, 2, 3]);
      await adapter.writeItem('item-1', data);

      const read = await adapter.readItem('item-1');
      read![0] = 99;

      const readAgain = await adapter.readItem('item-1');
      expect(readAgain![0]).toBe(1);
    });

    it('should overwrite existing item', async () => {
      await adapter.writeItem('item-1', new Uint8Array([1]));
      await adapter.writeItem('item-1', new Uint8Array([2]));

      const read = await adapter.readItem('item-1');
      expect(read).toEqual(new Uint8Array([2]));
    });

    it('should delete an item', async () => {
      await adapter.writeItem('item-1', new Uint8Array([1]));
      await adapter.deleteItem('item-1');

      const read = await adapter.readItem('item-1');
      expect(read).toBeNull();
    });

    it('should not throw on deleting non-existent item', async () => {
      await expect(adapter.deleteItem('nonexistent')).resolves.not.toThrow();
    });

    it('should list all item IDs', async () => {
      await adapter.writeItem('a', new Uint8Array([1]));
      await adapter.writeItem('b', new Uint8Array([2]));
      await adapter.writeItem('c', new Uint8Array([3]));

      const ids = await adapter.listItems();
      expect(ids.sort()).toEqual(['a', 'b', 'c']);
    });

    it('should return empty list when no items', async () => {
      const ids = await adapter.listItems();
      expect(ids).toEqual([]);
    });

    it('should not list deleted items', async () => {
      await adapter.writeItem('a', new Uint8Array([1]));
      await adapter.writeItem('b', new Uint8Array([2]));
      await adapter.deleteItem('a');

      const ids = await adapter.listItems();
      expect(ids).toEqual(['b']);
    });
  });
});

describe('mergeManifests', () => {
  const baseTime = '2024-01-01T00:00:00.000Z';
  const laterTime = '2024-06-01T00:00:00.000Z';

  it('should merge when local has items remote does not', () => {
    const local: SyncManifest = {
      version: 1,
      lastModified: baseTime,
      items: {
        'local-only': { updatedAt: baseTime, hash: 'hash1' },
      },
    };
    const remote: SyncManifest = {
      version: 1,
      lastModified: baseTime,
      items: {},
    };

    const merged = mergeManifests(local, remote);
    expect(merged.items['local-only']).toBeDefined();
  });

  it('should merge when remote has items local does not', () => {
    const local: SyncManifest = {
      version: 1,
      lastModified: baseTime,
      items: {},
    };
    const remote: SyncManifest = {
      version: 1,
      lastModified: baseTime,
      items: {
        'remote-only': { updatedAt: baseTime, hash: 'hash2' },
      },
    };

    const merged = mergeManifests(local, remote);
    expect(merged.items['remote-only']).toBeDefined();
  });

  it('should keep the later version when both have the same item', () => {
    const local: SyncManifest = {
      version: 1,
      lastModified: baseTime,
      items: {
        shared: { updatedAt: baseTime, hash: 'old-hash' },
      },
    };
    const remote: SyncManifest = {
      version: 1,
      lastModified: laterTime,
      items: {
        shared: { updatedAt: laterTime, hash: 'new-hash' },
      },
    };

    const merged = mergeManifests(local, remote);
    expect(merged.items['shared']!.hash).toBe('new-hash');
    expect(merged.items['shared']!.updatedAt).toBe(laterTime);
  });

  it('should keep local when local is later', () => {
    const local: SyncManifest = {
      version: 1,
      lastModified: laterTime,
      items: {
        shared: { updatedAt: laterTime, hash: 'local-hash' },
      },
    };
    const remote: SyncManifest = {
      version: 1,
      lastModified: baseTime,
      items: {
        shared: { updatedAt: baseTime, hash: 'remote-hash' },
      },
    };

    const merged = mergeManifests(local, remote);
    expect(merged.items['shared']!.hash).toBe('local-hash');
  });

  it('should use highest version number', () => {
    const local: SyncManifest = {
      version: 2,
      lastModified: baseTime,
      items: {},
    };
    const remote: SyncManifest = {
      version: 3,
      lastModified: baseTime,
      items: {},
    };

    const merged = mergeManifests(local, remote);
    expect(merged.version).toBe(3);
  });

  it('should combine items from both manifests', () => {
    const local: SyncManifest = {
      version: 1,
      lastModified: baseTime,
      items: {
        a: { updatedAt: baseTime, hash: 'ha' },
        b: { updatedAt: baseTime, hash: 'hb' },
      },
    };
    const remote: SyncManifest = {
      version: 1,
      lastModified: baseTime,
      items: {
        c: { updatedAt: baseTime, hash: 'hc' },
        d: { updatedAt: baseTime, hash: 'hd' },
      },
    };

    const merged = mergeManifests(local, remote);
    expect(Object.keys(merged.items).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
