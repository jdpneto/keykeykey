/**
 * Extension sync module — manages SyncLifecycle lifecycle and provides
 * a clean API for the message handler.
 */

import { SyncLifecycle } from '@keykeykey/core/sync';
import type { SyncConfig, SyncableStore, VaultMismatchInfo } from '@keykeykey/core/sync';
import { createExtensionPlatformStorage } from './storage.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let lifecycle: SyncLifecycle | null = null;
let currentConfig: SyncConfig | null = null;
let mismatchInfo: VaultMismatchInfo | null = null;
let lastSynced: string | null = null;
let syncError: string | null = null;

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

export function getLifecycle(): SyncLifecycle | null {
  return lifecycle;
}

export function getCurrentConfig(): SyncConfig | null {
  return currentConfig;
}

export function initLifecycle(
  store: SyncCompatibleStore,
  getHeader: () => import('@keykeykey/core').VaultHeader | null,
): SyncLifecycle {
  lifecycle = new SyncLifecycle({
    store,
    storage: createExtensionPlatformStorage(),
    platformCallbacks: {},
    callbacks: {
      onConfigChanged: (config) => {
        currentConfig = config;
      },
      onMismatch: (info) => {
        mismatchInfo = info;
      },
      onMismatchCleared: () => {
        mismatchInfo = null;
      },
      onItemsChanged: () => {},
    },
    getHeader,
  });
  return lifecycle;
}

export function getSyncStatus() {
  return {
    provider: currentConfig?.provider ?? 'none',
    isSyncing: lifecycle?.getStatus().isSyncing ?? false,
    lastSynced,
    error: syncError,
    hasMismatch: mismatchInfo !== null,
  };
}

export function getMismatchInfo(): VaultMismatchInfo | null {
  return mismatchInfo;
}

export function setLastSynced(value: string | null): void {
  lastSynced = value;
}

export function setSyncError(value: string | null): void {
  syncError = value;
}

export function teardownLifecycle(): void {
  lifecycle?.teardown();
  lifecycle = null;
  currentConfig = null;
  mismatchInfo = null;
  lastSynced = null;
  syncError = null;
}

export function recordTombstone(id: string): void {
  lifecycle?.recordTombstone(id);
}
