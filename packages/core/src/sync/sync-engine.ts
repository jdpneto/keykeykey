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
import { VaultItemSchema } from '../models/vault-item.js';
import type { VaultItem } from '../models/vault-item.js';
import { mergeManifestsV2 } from './merge.js';
import type { ISyncAdapter, SyncManifest } from './types.js';

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
}

export interface SyncEngineOptions {
  adapter: ISyncAdapter;
  store: SyncableStore;
  /** Called when a conflict is resolved (remote wins). */
  onConflictResolved?: (id: string) => void;
  /** Max age in days before tombstones are GC'd. Default: 30 */
  tombstoneMaxAgeDays?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_ZEROS: SyncResult = { pushed: 0, pulled: 0, deleted: 0, conflicts: 0 };

function emptyManifest(): SyncManifest {
  return {
    version: 2,
    lastModified: new Date().toISOString(),
    items: {},
    tombstones: {},
  };
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
  private readonly onConflictResolved?: (id: string) => void;
  private readonly tombstoneMaxAgeDays: number;

  /** Tombstones recorded since last sync (id → deletedAt ISO string). */
  private localTombstones: Record<string, string> = {};

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

  constructor(options: SyncEngineOptions) {
    this.adapter = options.adapter;
    this.store = options.store;
    this.onConflictResolved = options.onConflictResolved;
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
    // 1. Fetch remote manifest (default to empty v2 if null)
    // -----------------------------------------------------------------------
    const remote = (await this.adapter.readManifest()) ?? emptyManifest();

    // -----------------------------------------------------------------------
    // 2. Build local manifest from store items + recorded tombstones
    // -----------------------------------------------------------------------
    const localItems = state.items;
    const localManifestItems: SyncManifest['items'] = {};

    for (const item of localItems) {
      const encrypted = state.encryptItem(item);
      localManifestItems[item.id] = {
        updatedAt: item.updatedAt,
        hash: hashBytes(encrypted),
      };
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

    for (const [id, mergedMeta] of Object.entries(merged.items)) {
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

      void mergedMeta; // used in manifest commit below
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
    let pushed = 0;
    const finalItems = this.store.getState().items;

    for (const item of finalItems) {
      // Skip items that were just pulled (remote already has them)
      const pulledSet = new Set(itemsToPull.map((i) => i.id));
      if (pulledSet.has(item.id)) {
        continue;
      }

      const remoteMeta = remote.items[item.id];
      const shouldPush = !remoteMeta || item.updatedAt > remoteMeta.updatedAt;

      if (shouldPush) {
        const encrypted = state.encryptItem(item);
        await this.adapter.writeItem(item.id, encrypted);

        // Update merged manifest entry with fresh hash
        merged.items[item.id] = {
          updatedAt: item.updatedAt,
          hash: hashBytes(encrypted),
        };

        pushed++;
      }
    }

    // -----------------------------------------------------------------------
    // 7. Commit merged manifest
    // -----------------------------------------------------------------------
    merged.lastModified = new Date().toISOString();
    await this.adapter.writeManifest(merged);

    return { pushed, pulled, deleted, conflicts };
  }
}
