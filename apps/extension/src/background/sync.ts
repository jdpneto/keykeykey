/**
 * Extension sync module — manages SyncEngine lifecycle, config migration,
 * and provides a clean API for the message handler.
 */

import {
  SyncEngine,
  connectSyncEngine,
  createAdapterFromConfig,
} from '@keykeykey/core/sync';
import type { SyncConfig, SyncableStore, AdapterPlatformCallbacks } from '@keykeykey/core/sync';
import type { SyncProvider } from '@keykeykey/core/sync';
import { saveSyncConfigEncrypted, migrateSyncConfig } from './storage.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let engine: SyncEngine | null = null;
let disconnect: (() => void) | null = null;
let lastSynced: string | null = null;
let syncError: string | null = null;
let currentProvider: SyncProvider = 'none';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The store type needed by both SyncEngine (SyncableStore) and
 * connectSyncEngine (MinimalStore with subscribe).
 */
export interface SyncCompatibleStore extends SyncableStore {
  subscribe: (
    listener: (
      state: { status: string; items: unknown[] },
      prevState: { status: string; items: unknown[] },
    ) => void,
  ) => () => void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getSyncStatus() {
  return {
    provider: currentProvider,
    isSyncing: engine?.isSyncing() ?? false,
    lastSynced,
    error: syncError,
  };
}

export async function initSync(
  store: SyncCompatibleStore,
  dek: Uint8Array,
  platformCallbacks: AdapterPlatformCallbacks,
  onVaultReplaced: (info: { localVaultId: string; remoteVaultId: string }) => void,
): Promise<SyncConfig> {
  const config = await migrateSyncConfig(dek);
  currentProvider = config.provider;

  if (config.provider !== 'none') {
    const adapter = createAdapterFromConfig(config, platformCallbacks);
    if (adapter) {
      engine = new SyncEngine({ adapter, store, onVaultReplaced });

      engine
        .sync()
        .then(() => {
          lastSynced = new Date().toISOString();
          syncError = null;
        })
        .catch((err) => {
          syncError = err instanceof Error ? err.message : String(err);
        });

      disconnect = connectSyncEngine(store, engine);
    }
  }

  return config;
}

export async function triggerSync(): Promise<{ ok: boolean; error?: string }> {
  if (!engine) return { ok: false, error: 'Sync not configured' };
  try {
    await engine.sync();
    lastSynced = new Date().toISOString();
    syncError = null;
    return { ok: true };
  } catch (err) {
    syncError = err instanceof Error ? err.message : String(err);
    return { ok: false, error: syncError };
  }
}

export async function configureSync(
  config: SyncConfig,
  store: SyncCompatibleStore,
  dek: Uint8Array,
  platformCallbacks: AdapterPlatformCallbacks,
  onVaultReplaced: (info: { localVaultId: string; remoteVaultId: string }) => void,
): Promise<void> {
  teardownSync();
  await saveSyncConfigEncrypted(config, dek);
  currentProvider = config.provider;

  if (config.provider !== 'none') {
    const adapter = createAdapterFromConfig(config, platformCallbacks);
    if (adapter) {
      engine = new SyncEngine({ adapter, store, onVaultReplaced });
      engine
        .sync()
        .then(() => {
          lastSynced = new Date().toISOString();
          syncError = null;
        })
        .catch((err) => {
          syncError = err instanceof Error ? err.message : String(err);
        });
      disconnect = connectSyncEngine(store, engine);
    }
  }
}

export function teardownSync(): void {
  disconnect?.();
  disconnect = null;
  engine = null;
  lastSynced = null;
  syncError = null;
  currentProvider = 'none';
}

export function recordTombstone(id: string): void {
  engine?.recordTombstone(id);
}
