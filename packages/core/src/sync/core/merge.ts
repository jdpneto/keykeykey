import type { VaultItem } from '../../models/vault-item.js';
import type { SyncManifest, SyncItemMeta, TombstoneEntry } from './types.js';
import { garbageCollectTombstones } from './tombstone.js';

/**
 * Merge two sync manifests using tombstone-aware Last-Write-Wins (LWW) resolution.
 *
 * Resolution rules per item ID:
 * - Both sides have item only → keep the one with the later `updatedAt`
 * - Item on one side, tombstone on the other → winner is determined by comparing
 *   `updatedAt` vs `deletedAt`; if tombstone wins, item is removed
 * - Both sides have a tombstone → keep the one with the later `deletedAt`
 * - Item or tombstone only on one side (no opposing entry) → keep it
 *
 * After merging tombstones, old entries are removed via `garbageCollectTombstones`.
 *
 * @param local - The local manifest (v1 manifests without `tombstones` are supported)
 * @param remote - The remote manifest
 * @param maxAgeDays - Tombstones older than this are GC'd (default: 30)
 * @returns A new merged manifest
 */
export function mergeManifestsV2(
  local: SyncManifest,
  remote: SyncManifest,
  maxAgeDays = 30,
): SyncManifest {
  const localTombstones: Record<string, TombstoneEntry> = local.tombstones ?? {};
  const remoteTombstones: Record<string, TombstoneEntry> = remote.tombstones ?? {};

  const mergedItems: Record<string, SyncItemMeta> = {};
  const mergedTombstones: Record<string, TombstoneEntry> = {};

  // Collect all unique item IDs across both sides
  const allIds = new Set([
    ...Object.keys(local.items),
    ...Object.keys(remote.items),
    ...Object.keys(localTombstones),
    ...Object.keys(remoteTombstones),
  ]);

  for (const id of allIds) {
    const localItem = local.items[id];
    const remoteItem = remote.items[id];
    const localTombstone = localTombstones[id];
    const remoteTombstone = remoteTombstones[id];

    // Case 3: Both sides have tombstones — keep the later one
    if (localTombstone && remoteTombstone) {
      mergedTombstones[id] =
        localTombstone.deletedAt >= remoteTombstone.deletedAt ? localTombstone : remoteTombstone;
      continue;
    }

    // Case 2a: Local item vs remote tombstone
    if (localItem && remoteTombstone) {
      if (localItem.updatedAt > remoteTombstone.deletedAt) {
        // Item is newer — resurrect it, discard tombstone
        mergedItems[id] = localItem;
      } else {
        // Tombstone wins — item is deleted
        mergedTombstones[id] = remoteTombstone;
      }
      continue;
    }

    // Case 2b: Remote item vs local tombstone
    if (remoteItem && localTombstone) {
      if (remoteItem.updatedAt > localTombstone.deletedAt) {
        // Remote item is newer — keep it, discard tombstone
        mergedItems[id] = remoteItem;
      } else {
        // Tombstone wins — item is deleted
        mergedTombstones[id] = localTombstone;
      }
      continue;
    }

    // Case 1: Both sides have the item — LWW on updatedAt
    if (localItem && remoteItem) {
      mergedItems[id] = localItem.updatedAt >= remoteItem.updatedAt ? localItem : remoteItem;
      continue;
    }

    // Case 4: Item only on one side, no opposing tombstone — keep it
    if (localItem) {
      mergedItems[id] = localItem;
      continue;
    }
    if (remoteItem) {
      mergedItems[id] = remoteItem;
      continue;
    }

    // Case 5: Tombstone only on one side — keep it
    if (localTombstone) {
      mergedTombstones[id] = localTombstone;
      continue;
    }
    if (remoteTombstone) {
      mergedTombstones[id] = remoteTombstone;
      continue;
    }
  }

  return {
    version: Math.max(local.version, remote.version),
    lastModified: new Date().toISOString(),
    items: mergedItems,
    tombstones: garbageCollectTombstones(mergedTombstones, maxAgeDays),
  };
}

export interface MergeResult {
  /** The merged set of items (union of local + remote, LWW per-item). */
  merged: VaultItem[];
  /** Number of remote-only items added. */
  added: number;
  /** Number of items where remote was newer and replaced local. */
  updated: number;
}

/**
 * Merge two sets of vault items using Last-Write-Wins per-item.
 *
 * For items present on both sides (matched by ID), the one with the most
 * recent `updatedAt` wins. Ties go to the local item.
 * Items unique to either side are included in the result.
 */
export function mergeItemSets(localItems: VaultItem[], remoteItems: VaultItem[]): MergeResult {
  const merged = new Map<string, VaultItem>();
  let added = 0;
  let updated = 0;

  for (const item of localItems) {
    merged.set(item.id, item);
  }

  for (const remoteItem of remoteItems) {
    const localItem = merged.get(remoteItem.id);
    if (!localItem) {
      merged.set(remoteItem.id, remoteItem);
      added++;
    } else if (new Date(remoteItem.updatedAt) > new Date(localItem.updatedAt)) {
      merged.set(remoteItem.id, remoteItem);
      updated++;
    }
  }

  return { merged: Array.from(merged.values()), added, updated };
}
