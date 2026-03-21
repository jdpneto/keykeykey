import { describe, it, expect } from 'vitest';
import { mergeManifestsV2, mergeItemSets } from './merge.js';
import type { SyncManifest } from './types.js';
import type { VaultItem } from '../models/vault-item.js';

const t = (offset: number) => new Date(Date.now() + offset * 1000).toISOString();
const base = t(0);
const earlier = t(-3600);
const later = t(3600);

function manifest(overrides: Partial<SyncManifest> = {}): SyncManifest {
  return { version: 2, lastModified: base, items: {}, tombstones: {}, ...overrides };
}

describe('mergeManifestsV2', () => {
  describe('item + item (no tombstones)', () => {
    it('should keep local-only items', () => {
      const local = manifest({ items: { a: { updatedAt: base, hash: 'ha' } } });
      const remote = manifest();
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).toHaveProperty('a');
    });

    it('should keep remote-only items', () => {
      const local = manifest();
      const remote = manifest({ items: { a: { updatedAt: base, hash: 'ha' } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).toHaveProperty('a');
    });

    it('should pick item with later updatedAt when both have it', () => {
      const local = manifest({ items: { a: { updatedAt: earlier, hash: 'old' } } });
      const remote = manifest({ items: { a: { updatedAt: later, hash: 'new' } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items['a']!.hash).toBe('new');
    });
  });

  describe('item + tombstone', () => {
    it('should delete item when tombstone is newer', () => {
      const local = manifest({ items: { a: { updatedAt: earlier, hash: 'ha' } } });
      const remote = manifest({ tombstones: { a: { deletedAt: later } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).not.toHaveProperty('a');
      expect(merged.tombstones).toHaveProperty('a');
    });

    it('should keep item when item is newer than tombstone', () => {
      const local = manifest({ items: { a: { updatedAt: later, hash: 'ha' } } });
      const remote = manifest({ tombstones: { a: { deletedAt: earlier } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).toHaveProperty('a');
      expect(merged.tombstones).not.toHaveProperty('a');
    });

    it('should handle remote item vs local tombstone', () => {
      const local = manifest({ tombstones: { a: { deletedAt: later } } });
      const remote = manifest({ items: { a: { updatedAt: earlier, hash: 'ha' } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).not.toHaveProperty('a');
      expect(merged.tombstones).toHaveProperty('a');
    });

    it('should keep remote item when it is newer than local tombstone', () => {
      const local = manifest({ tombstones: { a: { deletedAt: earlier } } });
      const remote = manifest({ items: { a: { updatedAt: later, hash: 'ha' } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).toHaveProperty('a');
      expect(merged.tombstones).not.toHaveProperty('a');
    });
  });

  describe('tombstone + tombstone', () => {
    it('should keep tombstone with later deletedAt', () => {
      const local = manifest({ tombstones: { a: { deletedAt: earlier } } });
      const remote = manifest({ tombstones: { a: { deletedAt: later } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.tombstones!['a']!.deletedAt).toBe(later);
    });
  });

  describe('tombstone GC', () => {
    it('should garbage-collect tombstones older than maxAgeDays', () => {
      const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const local = manifest({ tombstones: { a: { deletedAt: old } } });
      const remote = manifest();
      const merged = mergeManifestsV2(local, remote, 30);
      expect(merged.tombstones).not.toHaveProperty('a');
    });
  });

  describe('version handling', () => {
    it('should use highest version', () => {
      const local = manifest({ version: 1 });
      const remote = manifest({ version: 2 });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.version).toBe(2);
    });

    it('should treat missing tombstones as empty (v1 compat)', () => {
      const local: SyncManifest = {
        version: 1,
        lastModified: base,
        items: { a: { updatedAt: base, hash: 'ha' } },
      };
      const remote = manifest({ tombstones: { a: { deletedAt: later } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).not.toHaveProperty('a');
      expect(merged.tombstones).toHaveProperty('a');
    });
  });

  describe('combined scenarios', () => {
    it('should handle mix of items and tombstones from both sides', () => {
      const local = manifest({
        items: {
          a: { updatedAt: later, hash: 'ha' },
          b: { updatedAt: earlier, hash: 'hb' },
        },
        tombstones: { c: { deletedAt: later } },
      });
      const remote = manifest({
        items: {
          b: { updatedAt: later, hash: 'hb-new' },
          d: { updatedAt: base, hash: 'hd' },
        },
        tombstones: { a: { deletedAt: earlier } },
      });

      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).toHaveProperty('a');
      expect(merged.items['b']!.hash).toBe('hb-new');
      expect(merged.tombstones).toHaveProperty('c');
      expect(merged.items).toHaveProperty('d');
    });
  });
});

function makeItem(overrides: Partial<VaultItem> & { id: string }): VaultItem {
  return {
    type: 'credential',
    name: 'Test',
    username: '',
    password: '',
    url: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as VaultItem;
}

describe('mergeItemSets', () => {
  it('should return empty when both sides are empty', () => {
    const result = mergeItemSets([], []);
    expect(result.merged).toHaveLength(0);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
  });

  it('should include items only in local', () => {
    const local = [makeItem({ id: 'local-1', name: 'Local Only' })];
    const remote: VaultItem[] = [];
    const result = mergeItemSets(local, remote);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].id).toBe('local-1');
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
  });

  it('should include items only in remote', () => {
    const local: VaultItem[] = [];
    const remote = [makeItem({ id: 'remote-1', name: 'Remote Only' })];
    const result = mergeItemSets(local, remote);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].id).toBe('remote-1');
    expect(result.added).toBe(1);
  });

  it('should take remote item when it has newer updatedAt', () => {
    const local = [makeItem({ id: 'shared-1', name: 'Old', updatedAt: '2026-01-01T00:00:00Z' })];
    const remote = [makeItem({ id: 'shared-1', name: 'New', updatedAt: '2026-02-01T00:00:00Z' })];
    const result = mergeItemSets(local, remote);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].name).toBe('New');
    expect(result.updated).toBe(1);
  });

  it('should keep local item when it has newer updatedAt', () => {
    const local = [
      makeItem({ id: 'shared-1', name: 'Newer Local', updatedAt: '2026-03-01T00:00:00Z' }),
    ];
    const remote = [
      makeItem({ id: 'shared-1', name: 'Older Remote', updatedAt: '2026-01-01T00:00:00Z' }),
    ];
    const result = mergeItemSets(local, remote);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].name).toBe('Newer Local');
    expect(result.updated).toBe(0);
  });

  it('should keep local item when updatedAt is equal', () => {
    const ts = '2026-01-01T00:00:00Z';
    const local = [makeItem({ id: 'shared-1', name: 'Local', updatedAt: ts })];
    const remote = [makeItem({ id: 'shared-1', name: 'Remote', updatedAt: ts })];
    const result = mergeItemSets(local, remote);
    expect(result.merged[0].name).toBe('Local');
  });

  it('should handle mixed case: some local-only, some remote-only, some shared', () => {
    const local = [
      makeItem({ id: 'a', name: 'Local A', updatedAt: '2026-01-01T00:00:00Z' }),
      makeItem({ id: 'b', name: 'Shared B old', updatedAt: '2026-01-01T00:00:00Z' }),
    ];
    const remote = [
      makeItem({ id: 'b', name: 'Shared B new', updatedAt: '2026-02-01T00:00:00Z' }),
      makeItem({ id: 'c', name: 'Remote C', updatedAt: '2026-01-01T00:00:00Z' }),
    ];
    const result = mergeItemSets(local, remote);
    expect(result.merged).toHaveLength(3);
    expect(result.merged.find((i) => i.id === 'a')!.name).toBe('Local A');
    expect(result.merged.find((i) => i.id === 'b')!.name).toBe('Shared B new');
    expect(result.merged.find((i) => i.id === 'c')!.name).toBe('Remote C');
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
  });
});
