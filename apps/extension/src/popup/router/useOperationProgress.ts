import { useState, useEffect } from 'react';
import browser from 'webextension-polyfill';
import { sendMessage } from '../hooks/useMessage.js';

type ActiveOperation = 'import' | 'restore' | 'restore-error' | 'sync-op' | 'sync-op-error' | null;

export function useOperationProgress(
  status: string,
  refresh: () => void,
  setScreen: React.Dispatch<React.SetStateAction<string>>,
): {
  operationCheckDone: boolean;
  activeOperation: ActiveOperation;
  restoreError: string | null;
  syncOpKind: 'replacing_remote' | 'replacing_local' | 'merging' | null;
  syncOpError: string | null;
  clearRestoreError: () => Promise<void>;
  clearSyncOpError: () => Promise<void>;
} {
  const [operationCheckDone, setOperationCheckDone] = useState(false);
  const [activeOperation, setActiveOperation] = useState<ActiveOperation>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [syncOpKind, setSyncOpKind] = useState<
    'replacing_remote' | 'replacing_local' | 'merging' | null
  >(null);
  const [syncOpError, setSyncOpError] = useState<string | null>(null);

  // Check for in-flight operations on mount / status change
  useEffect(() => {
    let cancelled = false;
    setOperationCheckDone(false);
    (async () => {
      try {
        const stored = await browser.storage.local.get([
          'import_state',
          'restore_state',
          'sync_op_state',
          'sync_connect_state',
        ]);
        if (cancelled) return;

        const importPrev = stored.import_state as { status: string } | undefined;
        if (importPrev && (importPrev.status === 'importing' || importPrev.status === 'syncing')) {
          setScreen('import');
          setActiveOperation('import');
          return;
        }

        const restorePrev = stored.restore_state as { status: string; error?: string } | undefined;
        if (restorePrev) {
          if (restorePrev.status === 'restoring') {
            setActiveOperation('restore');
            return;
          }
          if (restorePrev.status === 'error') {
            setActiveOperation('restore-error');
            setRestoreError(restorePrev.error ?? 'Restore failed');
            return;
          }
        }

        const syncOpPrev = stored.sync_op_state as { status: string; error?: string } | undefined;
        if (syncOpPrev) {
          if (
            syncOpPrev.status === 'replacing_remote' ||
            syncOpPrev.status === 'replacing_local' ||
            syncOpPrev.status === 'merging'
          ) {
            setActiveOperation('sync-op');
            setSyncOpKind(syncOpPrev.status as 'replacing_remote' | 'replacing_local' | 'merging');
            return;
          }
          if (syncOpPrev.status === 'error') {
            setActiveOperation('sync-op-error');
            setSyncOpError(syncOpPrev.error ?? 'Sync operation failed');
            return;
          }
        }

        // If the user kicked off an OAuth sign-in from the sync settings
        // screen and the popup was closed by the OAuth tab taking focus,
        // route them back to sync-settings so they land where they started.
        // The backend OAuth CONNECT handler also fires the initial sync
        // inline, so any mismatch dialog will be waiting for them via
        // SyncSettingsScreen's normal GET_MISMATCH_INFO fetch.
        const syncConnectPrev = stored.sync_connect_state as
          | { status: string; provider?: string; error?: string }
          | undefined;
        if (syncConnectPrev && syncConnectPrev.status !== 'idle') {
          setScreen('sync-settings');
          // If the previous attempt errored out, clear the state so the
          // user doesn't land on sync-settings forever on every reopen.
          if (syncConnectPrev.status === 'error') {
            sendMessage({ type: 'CLEAR_SYNC_CONNECT_STATUS' }).catch(() => {});
          }
        }

        setActiveOperation(null);
      } catch {
        if (!cancelled) setActiveOperation(null);
      } finally {
        if (!cancelled) setOperationCheckDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, setScreen]);

  // Listen for background state changes while the popup is open so the view
  // updates in real time (e.g. restore finishes -> route to unlocked vault).
  useEffect(() => {
    const listener = (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;

      if (changes.restore_state) {
        const newState = changes.restore_state.newValue as
          | { status: string; error?: string }
          | undefined;
        if (!newState || newState.status === 'idle') {
          setActiveOperation((prev) =>
            prev === 'restore' || prev === 'restore-error' ? null : prev,
          );
          setRestoreError(null);
          refresh();
        } else if (newState.status === 'error') {
          setActiveOperation('restore-error');
          setRestoreError(newState.error ?? 'Restore failed');
        } else if (newState.status === 'restoring') {
          setActiveOperation('restore');
        }
      }

      if (changes.import_state) {
        const newState = changes.import_state.newValue as { status: string } | undefined;
        if (!newState || newState.status === 'idle' || newState.status === 'done') {
          setActiveOperation((prev) => (prev === 'import' ? null : prev));
        }
      }

      if (changes.sync_op_state) {
        const newState = changes.sync_op_state.newValue as
          | { status: string; error?: string }
          | undefined;
        if (!newState || newState.status === 'idle') {
          setActiveOperation((prev) =>
            prev === 'sync-op' || prev === 'sync-op-error' ? null : prev,
          );
          setSyncOpKind(null);
          setSyncOpError(null);
          // Route back to sync settings so the user sees the now-healthy state.
          setScreen('sync-settings');
        } else if (newState.status === 'error') {
          setActiveOperation('sync-op-error');
          setSyncOpError(newState.error ?? 'Sync operation failed');
        } else if (
          newState.status === 'replacing_remote' ||
          newState.status === 'replacing_local' ||
          newState.status === 'merging'
        ) {
          setActiveOperation('sync-op');
          setSyncOpKind(newState.status as 'replacing_remote' | 'replacing_local' | 'merging');
        }
      }

      if (changes.sync_connect_state) {
        const newState = changes.sync_connect_state.newValue as { status: string } | undefined;
        // Any non-idle transition (starting, finishing, or erroring) is a
        // signal that the user is in the middle of / just finished a
        // sign-in, so we route them to sync-settings where
        // SyncSettingsScreen's mount fetch + poll-while-syncing loop will
        // surface the mismatch dialog automatically.
        if (newState && newState.status !== 'idle') {
          setScreen('sync-settings');
        }
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [refresh, setScreen]);

  const clearRestoreError = async () => {
    try {
      await sendMessage({ type: 'CLEAR_RESTORE_STATUS' });
    } catch {
      // ignore
    }
    setActiveOperation(null);
    setRestoreError(null);
  };

  const clearSyncOpError = async () => {
    try {
      await sendMessage({ type: 'CLEAR_SYNC_OP_STATUS' });
    } catch {
      // ignore
    }
    setActiveOperation(null);
    setSyncOpKind(null);
    setSyncOpError(null);
    // Return the user to the sync settings screen where they started.
    setScreen('sync-settings');
  };

  return {
    operationCheckDone,
    activeOperation,
    restoreError,
    syncOpKind,
    syncOpError,
    clearRestoreError,
    clearSyncOpError,
  };
}
