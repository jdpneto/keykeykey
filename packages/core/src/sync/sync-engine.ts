/**
 * SyncEngine — orchestrates bidirectional vault sync between a local store
 * and a remote ISyncAdapter.
 *
 * Features:
 * - Tombstone-aware merge via mergeManifestsV2
 * - Mutex: concurrent sync() calls yield zeros; a pending sync is scheduled
 * - Debounced scheduleSync (2s) with per-call reset on user actions
 * - Exponential backoff on consecutive failures (2s base, 5min cap)
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { decrypt } from '../crypto/encryption.js';
import type { Argon2Params } from '../crypto/constants.js';
import { UUID_V4_REGEX } from '../models/base.js';
import { VaultItemSchema } from '../models/vault-item.js';
import type { VaultItem } from '../models/vault-item.js';
import { mergeManifestsV2 } from './merge.js';
import type { ISyncAdapter, SyncManifest } from './types.js';
import { encryptVaultBlob, decryptVaultBlob } from './vault-blob.js';
import { pMap } from '../utils/concurrency.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  pushed: number;
  pulled: number;
  deleted: number;
  conflicts: number;
}

export interface SyncableStore {
  getState: () => {
    status: string;
    items: VaultItem[];
    encryptItem: (item: VaultItem) => Uint8Array;
    getDEK: () => Uint8Array;
  };
  setState: (partial: Partial<{ items: VaultItem[] }>) => void;
  getVaultId: () => string;
}

export interface VaultMismatchInfo {
  localVaultId: string;
  remoteVaultId: string;
  canRestore: boolean;
  remoteItemCount: number;
  remoteVaultHeader: Uint8Array | null;
}

export interface SyncEngineOptions {
  adapter: ISyncAdapter;
  store: SyncableStore;
  mek: Uint8Array;
  syncSalt: Uint8Array;
  vaultHeaderBytes: Uint8Array;
  argon2Params: Argon2Params;
  /** Called when a conflict is resolved (remote wins). */
  onConflictResolved?: (id: string) => void;
  /** Called when the remote vault ID differs from the local vault ID. */
  onVaultMismatch?: (info: VaultMismatchInfo) => void;
  /** Max age in days before tombstones are GC'd. Default: 30 */
  tombstoneMaxAgeDays?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_ZEROS: SyncResult = { pushed: 0, pulled: 0, deleted: 0, conflicts: 0 };

/**
 * Validate that an item ID from a remote manifest is a valid UUID v4.
 * Prevents path traversal attacks via crafted IDs (e.g. "../../config").
 */
function isValidItemId(id: string): boolean {
  return UUID_V4_REGEX.test(id);
}

function hashBytes(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

// ---------------------------------------------------------------------------
// SyncEngine
// ---------------------------------------------------------------------------

export class SyncEngine {
  private readonly adapter: ISyncAdapter;
  private readonly store: SyncableStore;
  private readonly mek: Uint8Array;
  private readonly syncSalt: Uint8Array;
  private readonly vaultHeaderBytes: Uint8Array;
  private readonly argon2Params: Argon2Params;
  private readonly onConflictResolved?: (id: string) => void;
  private readonly onVaultMismatch?: (info: VaultMismatchInfo) => void;
  private readonly tombstoneMaxAgeDays: number;

  /** Tombstones recorded since last sync (id → deletedAt ISO string). */
  private localTombstones: Record<string, string> = {};

  /** Cached hashes from last successful sync (id → { updatedAt, hash }). */
  private hashCache: Record<string, { updatedAt: string; hash: string }> = {};

  /** True while sync() is executing. */
  private _isSyncing = false;
  /** A second sync was requested while one was in progress. */
  private pendingSync = false;

  /** Debounce timer handle. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Consecutive failure count for backoff. */
  private consecutiveFailures = 0;
  /** Current backoff delay in ms. */
  private backoffMs = 0;

  /** Periodic sync interval handle. */
  private periodicTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SyncEngineOptions) {
    this.adapter = options.adapter;
    this.store = options.store;
    this.mek = options.mek;
    this.syncSalt = options.syncSalt;
    this.vaultHeaderBytes = options.vaultHeaderBytes;
    this.argon2Params = options.argon2Params;
    this.onConflictResolved = options.onConflictResolved;
    this.onVaultMismatch = options.onVaultMismatch;
    this.tombstoneMaxAgeDays = options.tombstoneMaxAgeDays ?? 30;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  isSyncing(): boolean {
    return this._isSyncing;
  }

  recordTombstone(id: string): void {
    this.localTombstones[id] = new Date().toISOString();
  }

  /**
   * Start periodic background sync at the given interval.
   * Skips if a sync is already running.
   */
  startPeriodicSync(intervalMs: number = 60_000): void {
    this.stopPeriodicSync();
    this.periodicTimer = setInterval(() => {
      if (!this.isSyncing()) {
        void this.sync();
      }
    }, intervalMs);
  }

  /**
   * Stop the periodic sync timer.
   */
  stopPeriodicSync(): void {
    if (this.periodicTimer !== null) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /**
   * Debounced sync scheduler (2s delay).
   * Resets backoff when triggered by a user action.
   */
  scheduleSync(isUserAction = true): void {
    if (isUserAction) {
      this.consecutiveFailures = 0;
      this.backoffMs = 0;
    }

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    const delay = isUserAction ? 2000 : this.backoffMs;

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.sync();
    }, delay);
  }

  /**
   * Run a full sync cycle.
   *
   * If a sync is already in progress, marks pendingSync = true and returns
   * zeros immediately. After the active sync finishes, scheduleSync(false)
   * is called to respect backoff.
   */
  async sync(): Promise<SyncResult> {
    if (this._isSyncing) {
      this.pendingSync = true;
      return { ...EMPTY_ZEROS };
    }

    this._isSyncing = true;
    this.pendingSync = false;

    try {
      const result = await this._runSync();
      // Success — reset backoff
      this.consecutiveFailures = 0;
      this.backoffMs = 0;
      return result;
    } catch (err) {
      this.consecutiveFailures++;
      this.backoffMs = Math.min(2000 * Math.pow(2, this.consecutiveFailures), 300_000);
      throw err;
    } finally {
      this._isSyncing = false;
      if (this.pendingSync) {
        this.pendingSync = false;
        this.scheduleSync(false);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal sync logic
  // -------------------------------------------------------------------------

  private async _runSync(): Promise<SyncResult> {
    const state = this.store.getState();

    if (state.status !== 'unlocked') {
      return { ...EMPTY_ZEROS };
    }

    const dek = state.getDEK();

    // -----------------------------------------------------------------------
    // 1. Fetch remote vault blob (default to empty v2 manifest if null)
    // -----------------------------------------------------------------------
    let remoteRaw: SyncManifest = { version: 2, lastModified: '', items: {} };
    const remoteBlob = await this.adapter.readVaultBlob();
    if (remoteBlob) {
      try {
        const decoded = decryptVaultBlob(remoteBlob, this.mek);
        remoteRaw = decoded.manifest;
      } catch {
        this.onVaultMismatch?.({
          localVaultId: this.store.getVaultId(),
          remoteVaultId: '',
          canRestore: false,
          remoteItemCount: 0,
          remoteVaultHeader: null,
        });
        return { ...EMPTY_ZEROS };
      }
    } else if (this.adapter.readLegacyManifest) {
      const legacy = await this.adapter.readLegacyManifest();
      if (legacy) remoteRaw = legacy;
    }
    const remote = remoteRaw;

    // -----------------------------------------------------------------------
    // 1a. Vault ID mismatch detection
    // -----------------------------------------------------------------------
    if (remote.vaultId) {
      const localVaultId = this.store.getVaultId();
      if (remote.vaultId !== localVaultId) {
        this.onVaultMismatch?.({
          localVaultId,
          remoteVaultId: remote.vaultId,
          canRestore: true,
          remoteItemCount: Object.keys(remote.items).length,
          remoteVaultHeader: null,
        });
        return { ...EMPTY_ZEROS };
      }
    }

    // -----------------------------------------------------------------------
    // 2. Build local manifest from store items + recorded tombstones
    //    Use cached hashes when updatedAt hasn't changed to avoid re-encrypting
    //    every item (XChaCha20-Poly1305 uses random nonces, so re-encryption
    //    produces different ciphertext and a different hash each time).
    // -----------------------------------------------------------------------
    const localItems = state.items;
    const localManifestItems: SyncManifest['items'] = {};

    for (const item of localItems) {
      const cached = this.hashCache[item.id];
      if (cached && cached.updatedAt === item.updatedAt) {
        localManifestItems[item.id] = cached;
      } else {
        // Item is new or updated — compute fresh hash
        const encrypted = state.encryptItem(item);
        const entry = { updatedAt: item.updatedAt, hash: hashBytes(encrypted) };
        localManifestItems[item.id] = entry;
        this.hashCache[item.id] = entry;
      }
    }

    const localTombstoneEntries: Record<string, { deletedAt: string }> = {};
    for (const [id, deletedAt] of Object.entries(this.localTombstones)) {
      localTombstoneEntries[id] = { deletedAt };
    }

    const local: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: localManifestItems,
      tombstones: localTombstoneEntries,
    };

    // -----------------------------------------------------------------------
    // 3. Merge
    // -----------------------------------------------------------------------
    const merged = mergeManifestsV2(local, remote, this.tombstoneMaxAgeDays);

    // -----------------------------------------------------------------------
    // 4. Apply tombstones: delete local items + remote blobs
    // -----------------------------------------------------------------------
    let deleted = 0;
    const tombstoneIds = Object.keys(merged.tombstones ?? {});

    if (tombstoneIds.length > 0) {
      const currentItems = this.store.getState().items;
      const survivingItems = currentItems.filter((item) => !merged.tombstones![item.id]);

      if (survivingItems.length !== currentItems.length) {
        this.store.setState({ items: survivingItems });
      }

      for (const id of tombstoneIds) {
        if (!isValidItemId(id)) continue; // Skip malformed IDs from remote
        // Delete remote blob (ignore errors — may not exist)
        try {
          await this.adapter.deleteItem(id);
          deleted++;
        } catch {
          // If item doesn't exist remotely, that's fine — tombstone still counts
          deleted++;
        }
        // Clear from local tombstones map (now committed to merged manifest)
        delete this.localTombstones[id];
      }
    }

    // -----------------------------------------------------------------------
    // 5. Pull: items in merged manifest that are newer than local version
    // -----------------------------------------------------------------------
    let pulled = 0;
    let conflicts = 0;
    const localItemMap = new Map(this.store.getState().items.map((i) => [i.id, i]));

    const itemsToPull: VaultItem[] = [];

    for (const id of Object.keys(merged.items)) {
      if (!isValidItemId(id)) continue; // Skip malformed IDs from remote
      const localItem = localItemMap.get(id);
      const remoteMeta = remote.items[id];

      if (!remoteMeta) {
        // Item only exists locally — nothing to pull
        continue;
      }

      const isRemoteWinner = !localItem || remoteMeta.updatedAt > (localItem.updatedAt ?? '');

      if (isRemoteWinner) {
        // Check for conflict: both sides modified (different hashes, both present)
        if (localItem && localItem.updatedAt !== remoteMeta.updatedAt) {
          conflicts++;
          this.onConflictResolved?.(id);
        }

        const blob = await this.adapter.readItem(id);
        if (blob) {
          try {
            const plainBytes = decrypt(blob, dek);
            const json = new TextDecoder().decode(plainBytes);
            const parsed = JSON.parse(json) as unknown;
            const validated = VaultItemSchema.parse(parsed);
            itemsToPull.push(validated);
            pulled++;
          } catch {
            // Skip corrupted remote items
          }
        }
      }
    }

    if (itemsToPull.length > 0) {
      const currentItems = this.store.getState().items;
      const pulledIds = new Set(itemsToPull.map((i) => i.id));
      const remaining = currentItems.filter((i) => !pulledIds.has(i.id));
      this.store.setState({ items: [...remaining, ...itemsToPull] });
    }

    // -----------------------------------------------------------------------
    // 6. Push: local items newer than remote (or missing from remote)
    // -----------------------------------------------------------------------
    const finalItems = this.store.getState().items;
    const pulledIds = new Set(itemsToPull.map((i) => i.id));

    const itemsToPush = finalItems.filter((item) => {
      if (pulledIds.has(item.id)) return false;
      const remoteMeta = remote.items[item.id];
      return !remoteMeta || item.updatedAt > remoteMeta.updatedAt;
    });

    await pMap(
      itemsToPush,
      async (item) => {
        // NOTE: `state` was captured at the start of _runSync, but encryptItem
        // reads the DEK from a closure (not from state.items), so it remains
        // valid even after the store has been mutated during pull.
        const encrypted = state.encryptItem(item);
        await this.adapter.writeItem(item.id, encrypted);

        // Update merged manifest entry with fresh hash
        merged.items[item.id] = {
          updatedAt: item.updatedAt,
          hash: hashBytes(encrypted),
        };
      },
      5,
    );

    const pushed = itemsToPush.length;

    // -----------------------------------------------------------------------
    // 7. Commit merged manifest (encrypted vault blob) and update hash cache
    // -----------------------------------------------------------------------
    merged.vaultId = this.store.getVaultId();
    merged.lastModified = new Date().toISOString();
    const encryptedBlob = encryptVaultBlob(
      merged,
      this.vaultHeaderBytes,
      this.mek,
      this.syncSalt,
      this.argon2Params,
    );
    await this.adapter.writeVaultBlob(encryptedBlob);
    if (this.adapter.deleteLegacyManifest) {
      await this.adapter.deleteLegacyManifest().catch(() => {});
    }

    // Rebuild hash cache from the committed manifest so next sync can skip
    // unchanged items. Also prune deleted items from the cache.
    this.hashCache = {};
    for (const [id, meta] of Object.entries(merged.items)) {
      this.hashCache[id] = { updatedAt: meta.updatedAt, hash: meta.hash };
    }

    return { pushed, pulled, deleted, conflicts };
  }
}
