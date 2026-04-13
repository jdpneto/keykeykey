import React, { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import { useTheme } from '../../../lib/theme.js';
import { sendMessage } from '../../hooks/useMessage.js';
import type { SyncConfig, SyncProvider, SyncStatus } from '../../../lib/messages.js';
import { ProviderSelector } from './ProviderSelector.js';
import { OAuthPanel } from './OAuthPanel.js';
import { MismatchResolver } from './MismatchResolver.js';

interface SyncSettingsScreenProps {
  onBack: () => void;
}

interface MismatchInfo {
  canRestore: boolean;
  remoteItemCount: number;
}

export function SyncSettingsScreen({ onBack }: SyncSettingsScreenProps) {
  const { theme } = useTheme();

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [mismatchInfo, setMismatchInfo] = useState<MismatchInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [syncProvider, setSyncProvider] = useState<SyncProvider>('none');
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');

  // Show/hide password state
  const [showWebdavPassword, setShowWebdavPassword] = useState(false);
  const [showMasterPassword, setShowMasterPassword] = useState(false);

  // Action state
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  // Mismatch action state
  const [merging, setMerging] = useState(false);
  const [replacingLocal, setReplacingLocal] = useState(false);
  const [replacingRemote, setReplacingRemote] = useState(false);

  const isConnected = syncStatus != null && syncStatus.provider !== 'none' && syncStatus.provider;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [statusResult, mismatchResult] = await Promise.all([
          sendMessage<SyncStatus>({ type: 'GET_SYNC_STATUS' }),
          sendMessage<MismatchInfo | null>({ type: 'GET_MISMATCH_INFO' }),
        ]);
        const status = statusResult as SyncStatus;
        if (status && status.provider !== undefined) {
          setSyncStatus(status);
          setSyncProvider(status.provider ?? 'none');
        }
        const mi = mismatchResult as (MismatchInfo & { error?: string }) | null;
        if (mi && !mi.error && mi.canRestore !== undefined) {
          setMismatchInfo(mi);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Poll the sync status while the backend reports isSyncing === true
  useEffect(() => {
    if (!syncStatus?.isSyncing) return;
    let cancelled = false;
    const start = Date.now();
    const interval = setInterval(async () => {
      if (cancelled) return;
      if (Date.now() - start > 30_000) {
        clearInterval(interval);
        return;
      }
      try {
        const next = (await sendMessage<SyncStatus>({
          type: 'GET_SYNC_STATUS',
        })) as SyncStatus;
        if (cancelled) return;
        if (next && next.provider !== undefined) {
          setSyncStatus(next);
          if (!next.isSyncing) {
            clearInterval(interval);
            try {
              const mi = (await sendMessage<MismatchInfo | null>({
                type: 'GET_MISMATCH_INFO',
              })) as (MismatchInfo & { error?: string }) | null;
              if (!cancelled && mi && !mi.error && mi.canRestore !== undefined) {
                setMismatchInfo(mi);
              }
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore a transient message failure; next tick will retry
      }
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [syncStatus?.isSyncing]);

  // Listen for sync_connect_state transitioning to 'idle'
  useEffect(() => {
    const listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local') return;
      if (!changes.sync_connect_state) return;
      const newState = changes.sync_connect_state.newValue as { status?: string } | undefined;
      if (!newState || newState.status !== 'idle') return;
      void (async () => {
        try {
          const [statusResult, mismatchResult] = await Promise.all([
            sendMessage<SyncStatus>({ type: 'GET_SYNC_STATUS' }),
            sendMessage<MismatchInfo | null>({ type: 'GET_MISMATCH_INFO' }),
          ]);
          const status = statusResult as SyncStatus;
          if (status && status.provider !== undefined) {
            setSyncStatus(status);
            setSyncProvider(status.provider ?? 'none');
          }
          const mi = mismatchResult as (MismatchInfo & { error?: string }) | null;
          if (mi && !mi.error && mi.canRestore !== undefined) {
            setMismatchInfo(mi);
          }
        } catch {
          // ignore
        }
      })();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  const canConnect =
    syncProvider === 'webdav' &&
    webdavUrl.trim().length > 0 &&
    webdavUsername.trim().length > 0 &&
    webdavPassword.trim().length > 0 &&
    masterPassword.trim().length > 0;

  const handleConnect = async () => {
    if (!canConnect) return;
    setConnecting(true);
    setError('');
    try {
      const validResult = (await sendMessage<{ valid?: boolean; error?: string }>({
        type: 'VALIDATE_MASTER_PASSWORD',
        password: masterPassword,
      })) as { valid?: boolean; error?: string };
      if (validResult.error) {
        setError(validResult.error);
        setConnecting(false);
        return;
      }
      if (validResult.valid === false) {
        setError('Incorrect master password');
        setConnecting(false);
        return;
      }
      const config: SyncConfig = {
        provider: syncProvider,
        masterPassword,
        webdav: { url: webdavUrl, username: webdavUsername, password: webdavPassword },
      };
      const configResult = (await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'CONFIGURE_SYNC',
        config,
      })) as { ok?: boolean; error?: string };
      if (configResult?.error) {
        setError(configResult.error);
        setConnecting(false);
        return;
      }
      const syncResult = (await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'TRIGGER_SYNC',
      })) as { ok?: boolean; error?: string };
      if (syncResult?.error) {
        setError(syncResult.error);
        setConnecting(false);
        return;
      }
      const result = (await sendMessage<SyncStatus>({ type: 'GET_SYNC_STATUS' })) as SyncStatus;
      setSyncStatus(result);
      setMasterPassword('');
      const mi = (await sendMessage<MismatchInfo | null>({
        type: 'GET_MISMATCH_INFO',
      })) as (MismatchInfo & { error?: string }) | null;
      if (mi && !mi.error && mi.canRestore !== undefined) {
        setMismatchInfo(mi);
      }
    } catch {
      setError('Failed to connect sync.');
    } finally {
      setConnecting(false);
    }
  };

  const handleOAuthConnect = async (
    type: 'GOOGLE_OAUTH_CONNECT' | 'DROPBOX_OAUTH_CONNECT' | 'ONEDRIVE_OAUTH_CONNECT',
    failMsg: string,
  ) => {
    if (!masterPassword) {
      setError('Master password is required.');
      return;
    }
    setConnecting(true);
    setError('');
    try {
      const result = await sendMessage<{ ok?: boolean; error?: string }>({
        type,
        masterPassword,
      });
      if (result?.error) {
        setError(result.error);
      } else {
        await sendMessage({ type: 'TRIGGER_SYNC' });
        const status = (await sendMessage<SyncStatus>({ type: 'GET_SYNC_STATUS' })) as SyncStatus;
        setSyncStatus(status);
        if (status?.provider) setSyncProvider(status.provider);
        setMasterPassword('');
        const mi = (await sendMessage<MismatchInfo | null>({
          type: 'GET_MISMATCH_INFO',
        })) as (MismatchInfo & { error?: string }) | null;
        if (mi && !mi.error && mi.canRestore !== undefined) {
          setMismatchInfo(mi);
        }
      }
    } catch {
      setError(failMsg);
    } finally {
      setConnecting(false);
    }
  };

  const handleGoogleConnect = () =>
    handleOAuthConnect('GOOGLE_OAUTH_CONNECT', 'Google sign-in failed.');
  const handleDropboxConnect = () =>
    handleOAuthConnect('DROPBOX_OAUTH_CONNECT', 'Dropbox sign-in failed.');
  const handleOneDriveConnect = () =>
    handleOAuthConnect('ONEDRIVE_OAUTH_CONNECT', 'OneDrive sign-in failed.');

  const handleDisconnect = async () => {
    setError('');
    try {
      const provider = syncStatus?.provider;
      if (provider === 'google-drive') {
        await sendMessage({ type: 'GOOGLE_OAUTH_DISCONNECT' });
      } else if (provider === 'dropbox') {
        await sendMessage({ type: 'DROPBOX_OAUTH_DISCONNECT' });
      } else if (provider === 'onedrive') {
        await sendMessage({ type: 'ONEDRIVE_OAUTH_DISCONNECT' });
      } else {
        await sendMessage({ type: 'DISCONNECT_SYNC' });
      }
      setSyncProvider('none');
      setSyncStatus(null);
      setWebdavUrl('');
      setWebdavUsername('');
      setWebdavPassword('');
      setMasterPassword('');
    } catch {
      setError('Failed to disconnect sync.');
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setError('');
    try {
      await sendMessage({ type: 'TRIGGER_SYNC' });
      const result = (await sendMessage<SyncStatus>({ type: 'GET_SYNC_STATUS' })) as SyncStatus;
      setSyncStatus(result);
      const mi = (await sendMessage<MismatchInfo | null>({
        type: 'GET_MISMATCH_INFO',
      })) as (MismatchInfo & { error?: string }) | null;
      if (mi && !mi.error && mi.canRestore !== undefined) {
        setMismatchInfo(mi);
      } else {
        setMismatchInfo(null);
      }
    } catch {
      setError('Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleMerge = async () => {
    setMerging(true);
    setError('');
    try {
      const result = (await sendMessage<{ success?: boolean; error?: string }>({
        type: 'MERGE_VAULTS',
      })) as { success?: boolean; error?: string };
      if (result.error) {
        setError(result.error);
      } else {
        setMismatchInfo(null);
        const status = (await sendMessage<SyncStatus>({
          type: 'GET_SYNC_STATUS',
        })) as SyncStatus;
        setSyncStatus(status);
      }
    } catch {
      setError('Merge failed.');
    } finally {
      setMerging(false);
    }
  };

  const handleReplaceLocal = async () => {
    setReplacingLocal(true);
    setError('');
    try {
      const result = (await sendMessage<{ success?: boolean; error?: string }>({
        type: 'REPLACE_LOCAL',
      })) as { success?: boolean; error?: string };
      if (result.error) {
        setError(result.error);
      } else {
        setMismatchInfo(null);
        const status = (await sendMessage<SyncStatus>({
          type: 'GET_SYNC_STATUS',
        })) as SyncStatus;
        setSyncStatus(status);
      }
    } catch {
      setError('Replace failed.');
    } finally {
      setReplacingLocal(false);
    }
  };

  const handleReplaceRemote = async () => {
    setReplacingRemote(true);
    setError('');
    try {
      const result = (await sendMessage<{ success?: boolean; error?: string }>({
        type: 'REPLACE_REMOTE',
      })) as { success?: boolean; error?: string };
      if (result.error) {
        setError(result.error);
      } else {
        setMismatchInfo(null);
        const status = (await sendMessage<SyncStatus>({
          type: 'GET_SYNC_STATUS',
        })) as SyncStatus;
        setSyncStatus(status);
        if (status?.provider) {
          setSyncProvider(status.provider);
        }
      }
    } catch {
      setError('Replace failed.');
    } finally {
      setReplacingRemote(false);
    }
  };

  const handleClearMismatch = async () => {
    await sendMessage({ type: 'CLEAR_MISMATCH' });
    setMismatchInfo(null);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    background: theme.colors.inputBackground,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    color: theme.colors.text,
    fontSize: theme.typography.sizes.sm,
    outline: 'none',
    boxSizing: 'border-box' as const,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textSecondary,
    fontWeight: theme.typography.weights.medium,
    marginBottom: 4,
    display: 'block',
  };

  const eyeButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: theme.colors.textSecondary,
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  };

  const sectionStyle: React.CSSProperties = {
    background: theme.colors.surface,
    borderRadius: theme.radii.md,
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    marginBottom: theme.spacing.sm,
  };

  const buttonStyle = (
    variant: 'primary' | 'secondary' | 'danger',
    disabled?: boolean,
  ): React.CSSProperties => ({
    flex: 1,
    padding: `${theme.spacing.xs}px`,
    background:
      variant === 'primary'
        ? theme.colors.primary
        : variant === 'danger'
          ? theme.colors.danger
          : 'none',
    border: variant === 'secondary' ? `1px solid ${theme.colors.border}` : 'none',
    borderRadius: theme.radii.md,
    color: variant === 'primary' ? '#000' : variant === 'danger' ? '#fff' : theme.colors.text,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    opacity: disabled ? 0.7 : 1,
  });

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '600px',
          color: theme.colors.textSecondary,
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: theme.colors.textSecondary,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.md,
            padding: theme.spacing.xs,
            borderRadius: theme.radii.sm,
          }}
          aria-label="Back"
        >
          &#8592;
        </button>
        <div
          style={{
            flex: 1,
            fontWeight: theme.typography.weights.bold,
            fontSize: theme.typography.sizes.md,
            color: theme.colors.text,
          }}
        >
          Cloud Sync
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        }}
      >
        {error && (
          <div
            style={{
              padding: theme.spacing.sm,
              background: theme.colors.errorLight,
              border: `1px solid ${theme.colors.error}`,
              borderRadius: theme.radii.md,
              color: theme.colors.error,
              fontSize: theme.typography.sizes.sm,
              marginBottom: theme.spacing.sm,
            }}
          >
            {error}
          </div>
        )}

        <ProviderSelector
          syncProvider={syncProvider}
          onProviderChange={setSyncProvider}
          isConnected={!!isConnected}
          syncStatus={syncStatus}
          webdavUrl={webdavUrl}
          onWebdavUrlChange={setWebdavUrl}
          webdavUsername={webdavUsername}
          onWebdavUsernameChange={setWebdavUsername}
          webdavPassword={webdavPassword}
          onWebdavPasswordChange={setWebdavPassword}
          showWebdavPassword={showWebdavPassword}
          onToggleWebdavPassword={() => setShowWebdavPassword(!showWebdavPassword)}
          masterPassword={masterPassword}
          onMasterPasswordChange={setMasterPassword}
          showMasterPassword={showMasterPassword}
          onToggleMasterPassword={() => setShowMasterPassword(!showMasterPassword)}
          inputStyle={inputStyle}
          labelStyle={labelStyle}
          eyeButtonStyle={eyeButtonStyle}
          sectionStyle={sectionStyle}
        />

        <OAuthPanel
          syncProvider={syncProvider}
          isConnected={!!isConnected}
          connecting={connecting}
          syncing={syncing}
          canConnect={canConnect}
          masterPassword={masterPassword}
          onConnect={handleConnect}
          onGoogleConnect={handleGoogleConnect}
          onDropboxConnect={handleDropboxConnect}
          onOneDriveConnect={handleOneDriveConnect}
          onDisconnect={handleDisconnect}
          onSyncNow={handleSyncNow}
          buttonStyle={buttonStyle}
        />
      </div>

      {/* Vault mismatch overlay */}
      {mismatchInfo != null && (
        <MismatchResolver
          mismatchInfo={mismatchInfo}
          merging={merging}
          replacingLocal={replacingLocal}
          replacingRemote={replacingRemote}
          onMerge={handleMerge}
          onReplaceLocal={handleReplaceLocal}
          onReplaceRemote={handleReplaceRemote}
          onClearMismatch={handleClearMismatch}
          buttonStyle={buttonStyle}
        />
      )}
    </div>
  );
}
