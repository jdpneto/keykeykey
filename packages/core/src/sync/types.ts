/**
 * Sync adapter interface and manifest types.
 *
 * All sync adapters (local filesystem, iCloud, Google Drive, OneDrive, S3)
 * implement ISyncAdapter. Data written through adapters is already encrypted.
 *
 * Conflict resolution: Last-Write-Wins (LWW) per item using updatedAt timestamps.
 */

/** Metadata for a single synced item. */
export type SyncItemMeta = {
  /** ISO 8601 timestamp of last modification. */
  updatedAt: string;
  /** SHA-256 hash of the encrypted item data (hex string). */
  hash: string;
};

/** Metadata for a deleted item (tombstone). */
export type TombstoneEntry = {
  /** ISO 8601 timestamp when the item was deleted. */
  deletedAt: string;
};

/** Sync manifest — tracks all items and their metadata. */
export type SyncManifest = {
  /** Manifest schema version. */
  version: number;
  /** ISO 8601 timestamp of last manifest update. */
  lastModified: string;
  /** Map of item ID → metadata. */
  items: Record<string, SyncItemMeta>;
  /** Map of item ID → deletion record. Only present in version >= 2. */
  tombstones?: Record<string, TombstoneEntry>;
};

/**
 * Interface for sync storage adapters.
 *
 * Each platform implements this for its storage backend.
 * All data passed through these methods is already encrypted (ciphertext only).
 */
export interface ISyncAdapter {
  /** Read the sync manifest, or null if none exists. */
  readManifest(): Promise<SyncManifest | null>;

  /** Write the sync manifest. */
  writeManifest(manifest: SyncManifest): Promise<void>;

  /** Read an encrypted item by ID, or null if not found. */
  readItem(id: string): Promise<Uint8Array | null>;

  /** Write an encrypted item by ID. */
  writeItem(id: string, data: Uint8Array): Promise<void>;

  /** Delete an encrypted item by ID. */
  deleteItem(id: string): Promise<void>;

  /** List all item IDs in storage. */
  listItems(): Promise<string[]>;
}

/**
 * Merge two sync manifests using Last-Write-Wins per item.
 *
 * For each item present in either manifest:
 * - If only in one, keep it
 * - If in both, keep the one with the later updatedAt
 *
 * @param local - The local manifest
 * @param remote - The remote manifest
 * @returns Merged manifest
 *
 * @deprecated Use `mergeManifestsV2` from `./merge.js` instead. This function
 * does not handle tombstones and will incorrectly resurrect deleted items.
 */
export function mergeManifests(local: SyncManifest, remote: SyncManifest): SyncManifest {
  const merged: Record<string, SyncItemMeta> = {};

  // Start with all local items
  for (const [id, meta] of Object.entries(local.items)) {
    merged[id] = meta;
  }

  // Merge in remote items (LWW)
  for (const [id, remoteMeta] of Object.entries(remote.items)) {
    const localMeta = merged[id];
    if (!localMeta || remoteMeta.updatedAt > localMeta.updatedAt) {
      merged[id] = remoteMeta;
    }
  }

  return {
    version: Math.max(local.version, remote.version),
    lastModified: new Date().toISOString(),
    items: merged,
  };
}
