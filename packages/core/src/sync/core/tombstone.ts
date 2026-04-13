import type { TombstoneEntry } from './types.js';

/**
 * Remove tombstones older than maxAgeDays.
 */
export function garbageCollectTombstones(
  tombstones: Record<string, TombstoneEntry>,
  maxAgeDays: number,
): Record<string, TombstoneEntry> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const result: Record<string, TombstoneEntry> = {};

  for (const [id, entry] of Object.entries(tombstones)) {
    if (new Date(entry.deletedAt).getTime() > cutoff) {
      result[id] = entry;
    }
  }

  return result;
}
