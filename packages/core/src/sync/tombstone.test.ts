import { describe, it, expect } from 'vitest';
import { garbageCollectTombstones } from './tombstone.js';
import type { TombstoneEntry } from './types.js';

describe('garbageCollectTombstones', () => {
  it('should remove tombstones older than maxAgeDays', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const tombstones: Record<string, TombstoneEntry> = {
      'old-item': { deletedAt: old },
      'recent-item': { deletedAt: recent },
    };

    const result = garbageCollectTombstones(tombstones, 30);
    expect(result).not.toHaveProperty('old-item');
    expect(result).toHaveProperty('recent-item');
  });

  it('should keep all tombstones when none are expired', () => {
    const recent = new Date().toISOString();
    const tombstones: Record<string, TombstoneEntry> = {
      a: { deletedAt: recent },
      b: { deletedAt: recent },
    };

    const result = garbageCollectTombstones(tombstones, 30);
    expect(Object.keys(result)).toHaveLength(2);
  });

  it('should return empty object when all tombstones are expired', () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const tombstones: Record<string, TombstoneEntry> = {
      a: { deletedAt: old },
      b: { deletedAt: old },
    };

    const result = garbageCollectTombstones(tombstones, 30);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should return empty object for empty input', () => {
    const result = garbageCollectTombstones({}, 30);
    expect(result).toEqual({});
  });
});
