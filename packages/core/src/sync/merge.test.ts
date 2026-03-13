import { describe, it, expect } from 'vitest';
import { mergeManifestsV2 } from './merge.js';
import type { SyncManifest } from './types.js';

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
