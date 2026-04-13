/**
 * HandlerContext — shared mutable state consumed by all domain handlers.
 *
 * Created once in the background service worker entry point. Every handler
 * function receives `(msg, ctx: HandlerContext) => Promise<unknown>`.
 *
 * The context owns:
 *   - The vault store (zustand vanilla)
 *   - Persisted header, auto-lock, and per-tab allowlists
 *   - Import / restore / sync-op / sync-connect progress state
 *   - A syncable store adapter (passed to SyncLifecycle)
 *   - Lifecycle init / teardown / status helpers (re-exported from sync-lifecycle)
 *   - broadcastToContentScripts for push notifications
 */

import browser from 'webextension-polyfill';
import { createVaultStore, deserializeVaultHeader, serializeVaultHeader } from '@keykeykey/core';
import { toBase64, fromBase64 } from '@keykeykey/core/utils';
import { loadVaultHeader, saveVaultHeader, loadSettings } from './storage.js';
import { AutoLockManager } from './auto-lock.js';
import { scheduleClipboardClear } from './clipboard.js';
import type { SyncCompatibleStore } from './sync-lifecycle.js';
import {
  initLifecycle,
  getLifecycle,
  getCurrentConfig,
  teardownLifecycle,
  getSyncStatus,
  getMismatchInfo,
  setLastSynced,
  setSyncError,
  recordTombstone,
} from './sync-lifecycle.js';

// ---------------------------------------------------------------------------
// Operation state types
// ---------------------------------------------------------------------------

export type ImportState = {
  status: 'idle' | 'importing' | 'syncing' | 'done' | 'error';
  imported: number;
  total: number;
  error?: string;
};

export type RestoreState = {
  status: 'idle' | 'restoring' | 'error';
  error?: string;
};

export type SyncOpState = {
  status: 'idle' | 'replacing_remote' | 'replacing_local' | 'merging' | 'error';
  error?: string;
};

export type SyncConnectState = {
  status: 'idle' | 'connecting' | 'error';
  provider?: 'google-drive' | 'dropbox' | 'onedrive';
  error?: string;
};

// ---------------------------------------------------------------------------
// HandlerContext type
// ---------------------------------------------------------------------------

export interface HandlerContext {
  // Core state
  readonly store: ReturnType<typeof createVaultStore>;
  headerBase64: string | null;
  autoLock: AutoLockManager | null;

  // Syncable store adapter
  readonly syncableStore: SyncCompatibleStore;

  // Operation state (mutable — handlers write these directly)
  importState: ImportState;
  restoreState: RestoreState;
  syncOpState: SyncOpState;
  syncConnectState: SyncConnectState;

  // Per-tab fillable credential allowlist
  readonly tabAllowlists: Map<number, Set<string>>;

  // State setters (persist to browser.storage.local AND update context)
  setImportState(next: ImportState): void;
  setRestoreState(next: RestoreState): Promise<void>;
  setSyncOpState(next: SyncOpState): Promise<void>;
  setSyncConnectState(next: SyncConnectState): Promise<void>;

  // Lifecycle
  init(): Promise<void>;
  startAutoLock(): void;

  // Sync module re-exports
  initLifecycle: typeof initLifecycle;
  getLifecycle: typeof getLifecycle;
  getCurrentConfig: typeof getCurrentConfig;
  teardownLifecycle: typeof teardownLifecycle;
  getSyncStatus: typeof getSyncStatus;
  getMismatchInfo: typeof getMismatchInfo;
  setLastSynced: typeof setLastSynced;
  setSyncError: typeof setSyncError;
  recordTombstone: typeof recordTombstone;

  // Utility re-exports
  scheduleClipboardClear: typeof scheduleClipboardClear;

  // Push messages to all content script tabs
  broadcastToContentScripts(message: Record<string, unknown>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHandlerContext(): HandlerContext {
  const store = createVaultStore();
  const tabAllowlists = new Map<number, Set<string>>();

  // --- Mutable state ---
  let headerBase64: string | null = null;
  let autoLock: AutoLockManager | null = null;
  let importState: ImportState = { status: 'idle', imported: 0, total: 0 };
  let restoreState: RestoreState = { status: 'idle' };
  let syncOpState: SyncOpState = { status: 'idle' };
  let syncConnectState: SyncConnectState = { status: 'idle' };

  // --- Syncable store adapter ---
  const syncableStore: SyncCompatibleStore = {
    getState: () => store.getState(),
    setState: (partial) => store.setState(partial),
    getVaultId: () => store.getState().header?.vaultId ?? '',
    subscribe: (listener) => store.subscribe(listener),
  };

  // --- Persist helpers ---
  async function persistImportState(): Promise<void> {
    try {
      await browser.storage.local.set({ import_state: importState });
    } catch {
      // ignore — storage failure shouldn't crash the handler
    }
  }

  function setImportState(next: ImportState): void {
    importState = next;
    ctx.importState = next;
    void persistImportState();
  }

  async function persistRestoreState(): Promise<void> {
    try {
      await browser.storage.local.set({ restore_state: restoreState });
    } catch {
      // ignore
    }
  }

  async function setRestoreState(next: RestoreState): Promise<void> {
    restoreState = next;
    ctx.restoreState = next;
    await persistRestoreState();
  }

  async function persistSyncOpState(): Promise<void> {
    try {
      await browser.storage.local.set({ sync_op_state: syncOpState });
    } catch {
      // ignore
    }
  }

  async function setSyncOpState(next: SyncOpState): Promise<void> {
    syncOpState = next;
    ctx.syncOpState = next;
    await persistSyncOpState();
  }

  async function persistSyncConnectState(): Promise<void> {
    try {
      await browser.storage.local.set({ sync_connect_state: syncConnectState });
    } catch {
      // ignore
    }
  }

  async function setSyncConnectState(next: SyncConnectState): Promise<void> {
    syncConnectState = next;
    ctx.syncConnectState = next;
    await persistSyncConnectState();
  }

  // --- Lifecycle: load initial state from storage ---
  async function init(): Promise<void> {
    headerBase64 = await loadVaultHeader();

    // Migrate v1 headers to v2 (assigns stable vaultId)
    if (headerBase64) {
      const headerBytes = fromBase64(headerBase64);
      const header = deserializeVaultHeader(headerBytes);
      if (header.version === 1) {
        header.version = 2;
        const v2Bytes = serializeVaultHeader(header);
        headerBase64 = toBase64(v2Bytes);
        await saveVaultHeader(headerBase64);
      }
    }

    // Restore import state from storage. If a previous import was in progress
    // when the service worker was terminated, mark it as error so the popup
    // can surface the interruption instead of showing a stale "importing".
    try {
      const stored = await browser.storage.local.get('import_state');
      const prev = stored.import_state as ImportState | undefined;
      if (prev) {
        if (prev.status === 'importing' || prev.status === 'syncing') {
          importState = {
            status: 'error',
            imported: prev.imported,
            total: prev.total,
            error: 'Import was interrupted. Please try again.',
          };
          await persistImportState();
        } else {
          importState = prev;
        }
      }
    } catch {
      // ignore
    }

    // Same recovery logic for the restore flow.
    try {
      const stored = await browser.storage.local.get('restore_state');
      const prev = stored.restore_state as RestoreState | undefined;
      if (prev) {
        if (prev.status === 'restoring') {
          restoreState = {
            status: 'error',
            error: 'Restore was interrupted. Please try again.',
          };
          await persistRestoreState();
        } else {
          restoreState = prev;
        }
      }
    } catch {
      // ignore
    }

    // Same for mismatch resolution operations.
    try {
      const stored = await browser.storage.local.get('sync_op_state');
      const prev = stored.sync_op_state as SyncOpState | undefined;
      if (prev) {
        if (
          prev.status === 'replacing_remote' ||
          prev.status === 'replacing_local' ||
          prev.status === 'merging'
        ) {
          syncOpState = {
            status: 'error',
            error: 'Sync operation was interrupted. Please try again.',
          };
          await persistSyncOpState();
        } else {
          syncOpState = prev;
        }
      }
    } catch {
      // ignore
    }

    // Sync-connect (OAuth) state. If a previous CONNECT was in flight when
    // the service worker was terminated, fall through to idle — the user
    // will just need to retry the sign-in, there is no residual state to
    // recover.
    try {
      const stored = await browser.storage.local.get('sync_connect_state');
      const prev = stored.sync_connect_state as SyncConnectState | undefined;
      if (prev) {
        if (prev.status === 'connecting') {
          syncConnectState = { status: 'idle' };
          await persistSyncConnectState();
        } else {
          syncConnectState = prev;
        }
      }
    } catch {
      // ignore
    }

    // Sync closure state back to the context object
    ctx.headerBase64 = headerBase64;
    ctx.importState = importState;
    ctx.restoreState = restoreState;
    ctx.syncOpState = syncOpState;
    ctx.syncConnectState = syncConnectState;
  }

  // --- Auto-lock lifecycle ---
  function startAutoLock(): void {
    if (autoLock) {
      autoLock.stop();
    }
    autoLock = new AutoLockManager(() => {
      teardownLifecycle();
      store.getState().lock();
    });
    ctx.autoLock = autoLock;
    // Load settings to configure auto-lock
    loadSettings().then((settings) => {
      autoLock?.start(settings.autoLockMode, settings.autoLockMinutes);
    });
  }

  // --- Broadcast to content scripts ---
  async function broadcastToContentScripts(message: Record<string, unknown>): Promise<void> {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) browser.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  }

  // --- Build the context object ---
  // We use a mutable object so handlers can write `ctx.headerBase64 = b64` directly.
  // The property descriptors for closure-backed state use getters/setters to keep
  // the closure variables and the context object in sync.
  const ctx: HandlerContext = {
    store,
    headerBase64: null,
    autoLock: null,
    syncableStore,
    importState,
    restoreState,
    syncOpState,
    syncConnectState,
    tabAllowlists,

    // State setters
    setImportState,
    setRestoreState,
    setSyncOpState,
    setSyncConnectState,

    // Lifecycle
    init,
    startAutoLock,

    // Sync module re-exports
    initLifecycle,
    getLifecycle,
    getCurrentConfig,
    teardownLifecycle,
    getSyncStatus,
    getMismatchInfo,
    setLastSynced,
    setSyncError,
    recordTombstone,

    // Utilities
    scheduleClipboardClear,
    broadcastToContentScripts,
  };

  return ctx;
}

// Re-export types that handlers need from sync-lifecycle
export type { SyncCompatibleStore } from './sync-lifecycle.js';
