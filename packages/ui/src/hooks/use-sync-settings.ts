import { useState, useEffect, useCallback, useRef } from 'react';
import type { SyncProvider } from '@keykeykey/core/sync';
import type {
  SyncSettingsDriver,
  SyncSettingsState,
  SyncStatus,
  MismatchInfo,
  OAuthProvider,
} from './sync-settings-types.js';

const REMOTE_VAULT_MISMATCH_ERROR = 'Remote vault mismatch — resolve it before syncing';

function mismatchInfoFromError(error: string | null | undefined): MismatchInfo | null {
  if (!error?.includes(REMOTE_VAULT_MISMATCH_ERROR)) return null;
  return { canRestore: true };
}

export function useSyncSettings(driver: SyncSettingsDriver): SyncSettingsState {
  // Form fields
  const [syncProvider, setSyncProvider] = useState<SyncProvider>('none');
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');

  // Status
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [mismatchInfo, setMismatchInfo] = useState<MismatchInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Operation flags
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [replacingLocal, setReplacingLocal] = useState(false);
  const [replacingRemote, setReplacingRemote] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // Ref to track mount state for async operations
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Derived
  const isConnected = syncStatus != null && syncStatus.provider !== 'none';
  const canConnect =
    syncProvider === 'webdav' &&
    webdavUrl.trim().length > 0 &&
    webdavUsername.trim().length > 0 &&
    webdavPassword.trim().length > 0 &&
    masterPassword.trim() !== '';

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await driver.getInitialState();
        if (cancelled) return;
        setSyncStatus(state.syncStatus);
        // A config save can replace the driver while a connect attempt is
        // still in flight. If that stale initial load resolves after
        // triggerSync has detected a mismatch, don't clear the newer dialog
        // state with its older null snapshot.
        setMismatchInfo((prev) => state.mismatchInfo ?? prev);
        if (state.syncStatus?.provider && state.syncStatus.provider !== 'none') {
          setSyncProvider(state.syncStatus.provider);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driver]);

  // Refresh status (callable by platform for external state changes)
  const refreshStatus = useCallback(async () => {
    try {
      const state = await driver.refreshStatus();
      if (!mountedRef.current) return;
      setSyncStatus(state.syncStatus);
      setMismatchInfo(state.mismatchInfo);
      if (state.syncStatus?.provider && state.syncStatus.provider !== 'none') {
        setSyncProvider(state.syncStatus.provider);
      }
    } catch {
      // Refresh failures are non-fatal
    }
  }, [driver]);

  // --- Actions ---

  const handleWebdavConnect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const valid = await driver.validateMasterPassword(masterPassword);
      if (!valid) {
        setError('Incorrect master password');
        return;
      }
      await driver.saveConfig({
        provider: 'webdav',
        masterPassword,
        webdav: { url: webdavUrl, username: webdavUsername, password: webdavPassword },
      });
      const result = await driver.triggerSync();
      if (!mountedRef.current) return;
      const fallbackMismatchInfo = mismatchInfoFromError(result.error);
      const resultMismatchInfo = result.mismatchInfo ?? fallbackMismatchInfo;
      if (resultMismatchInfo) {
        setMismatchInfo(resultMismatchInfo);
      }
      const failed = result.error != null;
      if (failed) {
        setError(result.error ?? null);
        // Keep the filled fields so the user can fix and retry
        // instead of retyping the whole form. Config has already
        // been saved via saveConfig above — that's load-bearing
        // for retry, don't roll it back here.
      } else {
        // Only clear secrets once the connection is genuinely
        // established — success is proven by a clean triggerSync.
        setMasterPassword('');
        setWebdavPassword('');
        driver.onConnected?.();
      }
      // refreshStatus picks up post-sync state from the host —
      // critically, `mismatchInfo` (for the merge/replace dialog
      // that appears when a "Remote vault mismatch" error is
      // returned). Always run it, even on failure, because
      // mismatches surface as an error AND a mismatchInfo record.
      await refreshStatus();
      if (resultMismatchInfo) {
        // Mobile can read mismatchInfo synchronously from the lifecycle in
        // triggerSync, while refreshStatus may still see a stale null from a
        // React context closure. Preserve the fresher sync result, but don't
        // let the generic error-derived fallback clobber richer refreshed data.
        setMismatchInfo((prev) => result.mismatchInfo ?? prev ?? fallbackMismatchInfo);
      }
      if (failed) return;
      // Fallback: on some hosts (the mobile React Context pattern)
      // `driver.refreshStatus` reads `vault.syncConfig` through a
      // stale closure captured at the time the driver was memoized,
      // and returns `syncStatus: null` even though sync just
      // succeeded — leaving the UI stuck on the disconnected form.
      // If refreshStatus didn't populate syncStatus, overlay it
      // from the confirmed triggerSync result so the UI flips to
      // the connected card. Uses the updater form so we only apply
      // the fallback when the refresh genuinely didn't.
      setSyncStatus(
        (prev) =>
          prev ?? {
            provider: syncProvider,
            lastSynced: result.lastSynced ?? null,
            isSyncing: false,
            error: null,
          },
      );
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : 'Failed to connect';
        setError(message);
        const fallbackMismatchInfo = mismatchInfoFromError(message);
        if (fallbackMismatchInfo) {
          setMismatchInfo(fallbackMismatchInfo);
          await refreshStatus();
          setMismatchInfo((prev) => prev ?? fallbackMismatchInfo);
        }
      }
    } finally {
      if (mountedRef.current) setConnecting(false);
    }
  }, [driver, masterPassword, webdavUrl, webdavUsername, webdavPassword, refreshStatus]);

  const handleOAuthConnect = useCallback(
    async (provider: OAuthProvider) => {
      setError(null);
      setConnecting(true);
      try {
        const valid = await driver.validateMasterPassword(masterPassword);
        if (!valid) {
          setError('Incorrect master password');
          return;
        }
        await driver.startOAuth(provider, masterPassword);
        if (!mountedRef.current) return;
        setMasterPassword('');
        driver.onConnected?.();
        await refreshStatus();
      } catch (err) {
        if (mountedRef.current) {
          const providerName =
            provider === 'google-drive'
              ? 'Google'
              : provider === 'dropbox'
                ? 'Dropbox'
                : 'Microsoft';
          setError(err instanceof Error ? err.message : `${providerName} sign-in failed`);
        }
      } finally {
        if (mountedRef.current) setConnecting(false);
      }
    },
    [driver, masterPassword, refreshStatus],
  );

  const handleSyncNow = useCallback(async () => {
    setError(null);
    setSyncing(true);
    try {
      const result = await driver.triggerSync();
      if (!mountedRef.current) return;
      const fallbackMismatchInfo = mismatchInfoFromError(result.error);
      const resultMismatchInfo = result.mismatchInfo ?? fallbackMismatchInfo;
      if (resultMismatchInfo) {
        setMismatchInfo(resultMismatchInfo);
      }
      if (result.error) {
        setError(result.error);
      }
      await refreshStatus();
      if (resultMismatchInfo) {
        setMismatchInfo((prev) => result.mismatchInfo ?? prev ?? fallbackMismatchInfo);
      }
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : 'Sync failed';
        setError(message);
        const fallbackMismatchInfo = mismatchInfoFromError(message);
        if (fallbackMismatchInfo) {
          setMismatchInfo(fallbackMismatchInfo);
          await refreshStatus();
          setMismatchInfo((prev) => prev ?? fallbackMismatchInfo);
        }
      }
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  }, [driver, refreshStatus]);

  const handleDisconnect = useCallback(async () => {
    try {
      await driver.disconnect(syncProvider);
      if (!mountedRef.current) return;
      setSyncStatus(null);
      setSyncProvider('none');
      setWebdavUrl('');
      setWebdavUsername('');
      setWebdavPassword('');
      setMasterPassword('');
      setError(null);
      setShowDisconnectConfirm(false);
      driver.onDisconnected?.();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Disconnect failed');
      }
    }
  }, [driver, syncProvider]);

  const handleMismatchMerge = useCallback(async () => {
    setMerging(true);
    try {
      await driver.mergeVaults();
      if (!mountedRef.current) return;
      setMismatchInfo(null);
      // Clear the stale "Remote vault mismatch" banner set by the sync that
      // first detected the conflict — the merge we just completed resolved it.
      setError(null);
      await refreshStatus();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Merge failed');
      }
    } finally {
      if (mountedRef.current) setMerging(false);
    }
  }, [driver, refreshStatus]);

  const handleMismatchReplaceLocal = useCallback(async () => {
    setReplacingLocal(true);
    try {
      await driver.replaceLocal();
      if (!mountedRef.current) return;
      setMismatchInfo(null);
      setError(null);
      await refreshStatus();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Replace failed');
      }
    } finally {
      if (mountedRef.current) setReplacingLocal(false);
    }
  }, [driver, refreshStatus]);

  const handleMismatchReplaceRemote = useCallback(async () => {
    setReplacingRemote(true);
    try {
      await driver.replaceRemote();
      if (!mountedRef.current) return;
      setMismatchInfo(null);
      setError(null);
      await refreshStatus();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Replace failed');
      }
    } finally {
      if (mountedRef.current) setReplacingRemote(false);
    }
  }, [driver, refreshStatus]);

  const handleMismatchCancel = useCallback(async () => {
    try {
      await driver.clearMismatch();
      if (!mountedRef.current) return;
      setMismatchInfo(null);
      setError(null);
      // Reset to disconnected state
      setSyncStatus(null);
      setSyncProvider('none');
      driver.onDisconnected?.();
    } catch {
      // Cancel failures are non-fatal
    }
  }, [driver]);

  const actionableMismatchInfo = mismatchInfo ?? mismatchInfoFromError(error);

  return {
    syncProvider,
    setSyncProvider,
    webdavUrl,
    setWebdavUrl,
    webdavUsername,
    setWebdavUsername,
    webdavPassword,
    setWebdavPassword,
    masterPassword,
    setMasterPassword,
    isConnected,
    canConnect,
    syncStatus,
    mismatchInfo: actionableMismatchInfo,
    error,
    loading,
    connecting,
    syncing,
    merging,
    replacingLocal,
    replacingRemote,
    showDisconnectConfirm,
    setShowDisconnectConfirm,
    handleWebdavConnect,
    handleOAuthConnect,
    handleSyncNow,
    handleDisconnect,
    handleMismatchMerge,
    handleMismatchReplaceLocal,
    handleMismatchReplaceRemote,
    handleMismatchCancel,
    refreshStatus,
  };
}
