import React, { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import type { SyncConfig, SyncProvider, SyncStatus } from '../../lib/messages.js';
import { EyeIcon, EyeOffIcon } from '../components/icons/index.js';

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
        // Always apply the status — a sync error (e.g. "No sync engine" or
        // "Mismatch, resolve first") is informational and must not block the
        // popup from showing the configured provider. Otherwise the UI would
        // render the disconnected form even though the backend still holds a
        // valid provider config.
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

  // Poll the sync status while the backend reports isSyncing === true so the
  // "Syncing..." label updates the moment a background sync completes. This
  // fixes a race with the 60s periodic sync: if the user clicks "Sync Now"
  // while the periodic tick is already running, TRIGGER_SYNC returns zeros
  // immediately and the one-shot status fetch catches the periodic sync
  // mid-flight with isSyncing=true. Without polling the label would stay
  // stuck until the next user interaction. 30s cap keeps us from polling
  // forever if something is genuinely wedged.
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
            // The sync just finished — re-fetch mismatch info so a vault
            // mismatch detected during a backend-initiated sync (e.g. the
            // initial sync fired by an OAuth CONNECT handler after the
            // popup was closed by the OAuth tab taking focus) shows up
            // automatically without the user having to click "Sync Now".
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

  // If the backend kicked off an OAuth sign-in sync after the popup was
  // closed (e.g. the user signed in via the OAuth tab and the extension
  // popup closed when the tab took focus), the initial sync runs in the
  // handler itself. By the time the user reopens the popup and lands back
  // on this screen, isSyncing may already be false. The initial mount
  // fetch covers that case, but we also want to pick up any mismatch that
  // was detected during the brief polling-gap. We do that by listening for
  // sync_connect_state transitioning to 'idle' and re-fetching.
  useEffect(() => {
    const listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local') return;
      if (!changes.sync_connect_state) return;
      const newState = changes.sync_connect_state.newValue as { status?: string } | undefined;
      if (!newState || newState.status !== 'idle') return;
      // Sync-connect just finished — refresh status + mismatch info.
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
      // Check for mismatch after sync
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

  const handleGoogleConnect = async () => {
    if (!masterPassword) {
      setError('Master password is required.');
      return;
    }
    setConnecting(true);
    setError('');
    try {
      const result = await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'GOOGLE_OAUTH_CONNECT',
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
        // Surface any mismatch detected by the initial sync immediately.
        const mi = (await sendMessage<MismatchInfo | null>({
          type: 'GET_MISMATCH_INFO',
        })) as (MismatchInfo & { error?: string }) | null;
        if (mi && !mi.error && mi.canRestore !== undefined) {
          setMismatchInfo(mi);
        }
      }
    } catch {
      setError('Google sign-in failed.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDropboxConnect = async () => {
    if (!masterPassword) {
      setError('Master password is required.');
      return;
    }
    setConnecting(true);
    setError('');
    try {
      const result = await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'DROPBOX_OAUTH_CONNECT',
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
      setError('Dropbox sign-in failed.');
    } finally {
      setConnecting(false);
    }
  };

  const handleOneDriveConnect = async () => {
    if (!masterPassword) {
      setError('Master password is required.');
      return;
    }
    setConnecting(true);
    setError('');
    try {
      const result = await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'ONEDRIVE_OAUTH_CONNECT',
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
      setError('OneDrive sign-in failed.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setError('');
    try {
      // Use provider-specific disconnect for OAuth providers to revoke tokens
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
      // Check for mismatch after sync
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
        // Keep the dropdown in sync so the UI doesn't drift to the form view.
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

  const mismatchBusy = merging || replacingLocal || replacingRemote;

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

        {/* Provider select */}
        <div style={sectionStyle}>
          <div style={{ marginBottom: theme.spacing.sm }}>
            <label style={labelStyle}>Provider</label>
            <select
              data-testid="sync-provider"
              value={syncProvider}
              onChange={(e) => setSyncProvider(e.target.value as SyncProvider)}
              disabled={!!isConnected}
              style={{
                ...inputStyle,
                cursor: isConnected ? 'not-allowed' : 'pointer',
                opacity: isConnected ? 0.6 : 1,
              }}
            >
              <option value="none">None</option>
              <option value="webdav">WebDAV</option>
              <option value="google-drive">Google Drive</option>
              <option value="dropbox">Dropbox</option>
              <option value="onedrive">OneDrive</option>
            </select>
          </div>

          {/* WebDAV fields — only when not connected */}
          {syncProvider === 'webdav' && !isConnected && (
            <>
              <div style={{ marginBottom: theme.spacing.sm }}>
                <label style={labelStyle}>WebDAV URL</label>
                <input
                  type="url"
                  data-testid="sync-webdav-url"
                  value={webdavUrl}
                  onChange={(e) => setWebdavUrl(e.target.value)}
                  placeholder="https://dav.example.com"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: theme.spacing.sm }}>
                <label style={labelStyle}>Username</label>
                <input
                  type="text"
                  data-testid="sync-webdav-username"
                  value={webdavUsername}
                  onChange={(e) => setWebdavUsername(e.target.value)}
                  placeholder="Username"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: theme.spacing.sm }}>
                <label style={labelStyle}>Password</label>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    type={showWebdavPassword ? 'text' : 'password'}
                    data-testid="sync-webdav-password"
                    value={webdavPassword}
                    onChange={(e) => setWebdavPassword(e.target.value)}
                    placeholder="Password"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    onClick={() => setShowWebdavPassword(!showWebdavPassword)}
                    style={eyeButtonStyle}
                    aria-label={showWebdavPassword ? 'Hide password' : 'Show password'}
                    type="button"
                  >
                    {showWebdavPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                  </button>
                </div>
              </div>
              <div style={{ marginBottom: theme.spacing.sm }}>
                <label style={labelStyle}>Master Password</label>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    type={showMasterPassword ? 'text' : 'password'}
                    data-testid="sync-master-password"
                    value={masterPassword}
                    onChange={(e) => setMasterPassword(e.target.value)}
                    placeholder="Vault master password"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    onClick={() => setShowMasterPassword(!showMasterPassword)}
                    style={eyeButtonStyle}
                    aria-label={showMasterPassword ? 'Hide password' : 'Show password'}
                    type="button"
                  >
                    {showMasterPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* OAuth provider fields (Google Drive, Dropbox, OneDrive) — only when not connected */}
          {(syncProvider === 'google-drive' ||
            syncProvider === 'dropbox' ||
            syncProvider === 'onedrive') &&
            !isConnected && (
              <>
                <div style={{ marginBottom: theme.spacing.sm }}>
                  <label style={labelStyle}>Master Password</label>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type={showMasterPassword ? 'text' : 'password'}
                      data-testid="sync-master-password"
                      value={masterPassword}
                      onChange={(e) => setMasterPassword(e.target.value)}
                      placeholder="Required for sync encryption"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      onClick={() => setShowMasterPassword(!showMasterPassword)}
                      style={eyeButtonStyle}
                      aria-label={showMasterPassword ? 'Hide password' : 'Show password'}
                      type="button"
                    >
                      {showMasterPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                    </button>
                  </div>
                </div>
              </>
            )}

          {/* Sync status display */}
          {isConnected && syncStatus && (
            <div
              style={{
                fontSize: theme.typography.sizes.xs,
                color: theme.colors.textSecondary,
                marginBottom: theme.spacing.sm,
              }}
            >
              {syncStatus.isSyncing
                ? 'Syncing...'
                : syncStatus.lastSynced
                  ? `Last synced: ${new Date(syncStatus.lastSynced).toLocaleString()}`
                  : 'Never synced'}
              {syncStatus.error && (
                <div style={{ color: theme.colors.error, marginTop: 4 }}>{syncStatus.error}</div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: theme.spacing.sm }}>
            {isConnected ? (
              <>
                <button
                  onClick={handleSyncNow}
                  disabled={syncing}
                  style={buttonStyle('primary', syncing)}
                >
                  {syncing ? 'Syncing...' : 'Sync Now'}
                </button>
                <button onClick={handleDisconnect} style={buttonStyle('secondary')}>
                  Disconnect
                </button>
              </>
            ) : (
              <>
                {syncProvider === 'webdav' && (
                  <button
                    onClick={handleConnect}
                    disabled={!canConnect || connecting}
                    style={buttonStyle('primary', !canConnect || connecting)}
                  >
                    {connecting ? 'Connecting...' : 'Connect'}
                  </button>
                )}
                {syncProvider === 'google-drive' && (
                  <button
                    onClick={handleGoogleConnect}
                    disabled={connecting || !masterPassword}
                    style={buttonStyle('primary', connecting || !masterPassword)}
                  >
                    {connecting ? 'Signing in…' : 'Sign in with Google'}
                  </button>
                )}
                {syncProvider === 'dropbox' && (
                  <button
                    onClick={handleDropboxConnect}
                    disabled={connecting || !masterPassword}
                    style={buttonStyle('primary', connecting || !masterPassword)}
                  >
                    {connecting ? 'Signing in…' : 'Sign in with Dropbox'}
                  </button>
                )}
                {syncProvider === 'onedrive' && (
                  <button
                    onClick={handleOneDriveConnect}
                    disabled={connecting || !masterPassword}
                    style={buttonStyle('primary', connecting || !masterPassword)}
                  >
                    {connecting ? 'Signing in…' : 'Sign in with OneDrive'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Vault mismatch overlay */}
      {mismatchInfo != null && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.4)',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: theme.colors.background,
              borderRadius: theme.radii.lg,
              padding: theme.spacing.lg,
              margin: theme.spacing.md,
              maxWidth: 340,
              width: '100%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                fontSize: theme.typography.sizes.md,
                fontWeight: theme.typography.weights.semibold,
                color: theme.colors.text,
                marginBottom: theme.spacing.sm,
              }}
            >
              {mismatchInfo.canRestore ? 'Remote Vault Detected' : 'Incompatible Remote Vault'}
            </div>
            <div
              style={{
                fontSize: theme.typography.sizes.xs,
                color: theme.colors.textSecondary,
                marginBottom: theme.spacing.md,
              }}
            >
              {mismatchInfo.canRestore
                ? `The remote server has a vault with ${mismatchInfo.remoteItemCount} item${mismatchInfo.remoteItemCount === 1 ? '' : 's'} from a different device.`
                : 'The remote server has vault data encrypted with a different password.'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              {mismatchInfo.canRestore && (
                <>
                  <button
                    onClick={handleMerge}
                    disabled={mismatchBusy}
                    style={buttonStyle('primary', mismatchBusy)}
                  >
                    {merging ? 'Merging...' : 'Merge Vaults'}
                  </button>
                  <button
                    onClick={handleReplaceLocal}
                    disabled={mismatchBusy}
                    style={buttonStyle('secondary', mismatchBusy)}
                  >
                    {replacingLocal ? 'Replacing...' : 'Replace Local with Remote'}
                  </button>
                </>
              )}
              <button
                onClick={handleReplaceRemote}
                disabled={mismatchBusy}
                style={buttonStyle('danger', mismatchBusy)}
              >
                {replacingRemote ? 'Replacing...' : 'Replace Remote with Local'}
              </button>
              <button
                onClick={handleClearMismatch}
                disabled={mismatchBusy}
                style={buttonStyle('secondary', mismatchBusy)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
