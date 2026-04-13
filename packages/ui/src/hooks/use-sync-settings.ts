import { useState, useEffect, useCallback, useRef } from 'react';
import type { SyncProvider } from '@keykeykey/core/sync';
import type {
  SyncSettingsDriver,
  SyncSettingsState,
  SyncStatus,
  MismatchInfo,
  OAuthProvider,
} from './sync-settings-types.js';

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
        setMismatchInfo(state.mismatchInfo);
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
      if (result.error) {
        setError(result.error);
      }
      setMasterPassword('');
      setWebdavPassword('');
      driver.onConnected?.();
      await refreshStatus();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to connect');
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
      if (result.error) {
        setError(result.error);
      }
      await refreshStatus();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Sync failed');
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
      // Reset to disconnected state
      setSyncStatus(null);
      setSyncProvider('none');
      driver.onDisconnected?.();
    } catch {
      // Cancel failures are non-fatal
    }
  }, [driver]);

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
    mismatchInfo,
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
