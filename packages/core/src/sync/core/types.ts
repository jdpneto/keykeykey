/**
 * Sync adapter interface and manifest types.
 *
 * All sync adapters (WebDAV, Google Drive, Dropbox, OneDrive)
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
  /** Unique identifier for the vault this manifest belongs to. */
  vaultId?: string;
};

/**
 * Interface for sync storage adapters.
 *
 * Each platform implements this for its storage backend.
 * All data passed through these methods is already encrypted (ciphertext only).
 */
export interface ISyncAdapter {
  /** Read the encrypted vault blob (vault.enc). Returns null if not found. */
  readVaultBlob(): Promise<Uint8Array | null>;
  /** Write the encrypted vault blob (vault.enc). */
  writeVaultBlob(data: Uint8Array): Promise<void>;
  /** Read legacy plaintext manifest (migration only). */
  readLegacyManifest?(): Promise<SyncManifest | null>;
  /** Delete legacy plaintext manifest after migration. */
  deleteLegacyManifest?(): Promise<void>;
  /** Read an encrypted item by ID, or null if not found. */
  readItem(id: string): Promise<Uint8Array | null>;
  /** Write an encrypted item by ID. */
  writeItem(id: string, data: Uint8Array): Promise<void>;
  /** Delete an encrypted item by ID. */
  deleteItem(id: string): Promise<void>;
  /** List all item IDs in storage. */
  listItems(): Promise<string[]>;
}
