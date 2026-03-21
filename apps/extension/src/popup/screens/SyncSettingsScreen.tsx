import React, { useEffect, useState } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import type { SyncConfig, SyncProvider, SyncStatus } from '../../lib/messages.js';

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
        const status = statusResult as SyncStatus & { error?: string };
        if (!status.error) {
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
      if (validResult.error || validResult.valid === false) {
        setError('Incorrect master password');
        setConnecting(false);
        return;
      }
      const config: SyncConfig = {
        provider: syncProvider,
        masterPassword,
        webdav: { url: webdavUrl, username: webdavUsername, password: webdavPassword },
      };
      await sendMessage({ type: 'CONFIGURE_SYNC', config });
      await sendMessage({ type: 'TRIGGER_SYNC' });
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

  const handleDisconnect = async () => {
    setError('');
    try {
      await sendMessage({ type: 'DISCONNECT_SYNC' });
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
              <option value="google-drive" disabled>
                Google Drive (Coming Soon)
              </option>
              <option value="icloud" disabled>
                iCloud (Coming Soon)
              </option>
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
                <input
                  type="password"
                  data-testid="sync-webdav-password"
                  value={webdavPassword}
                  onChange={(e) => setWebdavPassword(e.target.value)}
                  placeholder="Password"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: theme.spacing.sm }}>
                <label style={labelStyle}>Master Password</label>
                <input
                  type="password"
                  data-testid="sync-master-password"
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                  placeholder="Vault master password"
                  style={inputStyle}
                />
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
              syncProvider === 'webdav' && (
                <button
                  onClick={handleConnect}
                  disabled={!canConnect || connecting}
                  style={buttonStyle('primary', !canConnect || connecting)}
                >
                  {connecting ? 'Connecting...' : 'Connect'}
                </button>
              )
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
