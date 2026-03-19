import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Cloud, AlertTriangle, CheckCircle } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useVault } from '../lib/vault-context';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';
import type { SyncConfig, SyncProvider } from '@keykeykey/core/sync';

function formatLastSynced(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function SyncSettingsScreen() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { syncConfig, saveSyncConfig, triggerSync, vaultMismatchInfo, clearVaultMismatch } =
    useVault();

  const isConnected = syncConfig != null && syncConfig.provider !== 'none';

  const [syncProvider, setSyncProvider] = useState<SyncProvider>(syncConfig?.provider ?? 'none');
  const [webdavUrl, setWebdavUrl] = useState(syncConfig?.webdav?.url ?? '');
  const [webdavUsername, setWebdavUsername] = useState(syncConfig?.webdav?.username ?? '');
  // Never load the password from stored config into UI state — avoid holding plaintext in memory.
  const [webdavPassword, setWebdavPassword] = useState('');

  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [replacingRemote, setReplacingRemote] = useState(false);

  const canConnect =
    syncProvider === 'webdav' &&
    webdavUrl.trim().length > 0 &&
    webdavUsername.trim().length > 0 &&
    webdavPassword.trim().length > 0;

  const handleConnect = async () => {
    if (!canConnect) return;
    setConnecting(true);
    setSyncError(null);
    try {
      const config: SyncConfig = {
        provider: 'webdav',
        webdav: {
          url: webdavUrl.trim(),
          username: webdavUsername.trim(),
          password: webdavPassword,
        },
      };
      await saveSyncConfig(config);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const handleDisconnect = async () => {
    try {
      await saveSyncConfig({ provider: 'none' });
      setSyncProvider('none');
      setWebdavUrl('');
      setWebdavUsername('');
      setWebdavPassword('');
      setLastSynced(null);
      setSyncError(null);
      setShowDisconnectConfirm(false);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await triggerSync();
      if (result.error) {
        setSyncError(result.error);
      } else {
        setLastSynced(result.lastSynced);
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleMismatchRestore = () => {
    navigate('/restore');
  };

  const handleMismatchReplace = async () => {
    if (!syncConfig || syncConfig.provider === 'none') return;
    setReplacingRemote(true);
    setSyncError(null);
    try {
      // Save a copy of current config before disconnecting
      const currentConfig = { ...syncConfig };
      // Disconnect (clears remote engine)
      await saveSyncConfig({ provider: 'none' });
      // Re-save the same config — creates a fresh engine that will push everything
      await saveSyncConfig(currentConfig);
      // Trigger immediate sync to push local vault to remote
      const result = await triggerSync();
      if (result.error) {
        setSyncError(result.error);
      } else {
        setLastSynced(result.lastSynced);
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setReplacingRemote(false);
    }
  };

  const handleMismatchCancel = async () => {
    await clearVaultMismatch();
    setSyncProvider('none');
    setWebdavUrl('');
    setWebdavUsername('');
    setWebdavPassword('');
    setLastSynced(null);
    setSyncError(null);
  };

  const isSyncing = syncing;

  return (
    <div style={{ maxWidth: 520 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: theme.colors.textSecondary,
            display: 'flex',
            alignItems: 'center',
            padding: 4,
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <h1
          style={{
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
            margin: 0,
          }}
        >
          Sync Settings
        </h1>
      </div>

      {/* Provider Picker */}
      <div style={{ marginBottom: 20 }}>
        <label
          style={{
            display: 'block',
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.medium,
            color: theme.colors.textSecondary,
            marginBottom: 6,
          }}
        >
          Sync Provider
        </label>
        <select
          value={syncProvider}
          disabled={isConnected}
          onChange={(e) => setSyncProvider(e.target.value as SyncProvider)}
          style={{
            width: '100%',
            padding: '12px 16px',
            backgroundColor: theme.colors.inputBackground,
            color: theme.colors.text,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radii.md,
            fontSize: theme.typography.sizes.md,
            outline: 'none',
            cursor: isConnected ? 'not-allowed' : 'pointer',
            opacity: isConnected ? 0.6 : 1,
          }}
        >
          <option value="none">None (Local Only)</option>
          <option value="webdav">WebDAV</option>
          <option value="google-drive" disabled>
            Google Drive (Coming Soon)
          </option>
          <option value="icloud" disabled>
            iCloud (Coming Soon)
          </option>
        </select>
      </div>

      {/* Vault mismatch modal dialog */}
      {vaultMismatchInfo != null && (
        <div
          style={{
            position: 'fixed',
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
              padding: 24,
              maxWidth: 420,
              width: '90%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <AlertTriangle size={20} style={{ color: theme.colors.warning, flexShrink: 0 }} />
              <h3
                style={{
                  fontSize: theme.typography.sizes.lg,
                  fontWeight: theme.typography.weights.semibold,
                  color: theme.colors.text,
                  margin: 0,
                }}
              >
                {vaultMismatchInfo.canRestore
                  ? 'Remote Vault Detected'
                  : 'Incompatible Remote Vault'}
              </h3>
            </div>
            <p
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
                margin: '0 0 20px',
              }}
            >
              {vaultMismatchInfo.canRestore
                ? `The remote server has a vault with ${vaultMismatchInfo.remoteItemCount} item${vaultMismatchInfo.remoteItemCount === 1 ? '' : 's'} from a different device.`
                : 'The remote server has vault data encrypted with a different password.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {vaultMismatchInfo.canRestore && (
                <Button
                  title="Restore Remote Vault"
                  onPress={handleMismatchRestore}
                  variant="primary"
                  disabled={replacingRemote}
                />
              )}
              <Button
                title={replacingRemote ? 'Replacing...' : 'Replace Remote'}
                onPress={handleMismatchReplace}
                variant="danger"
                loading={replacingRemote}
                disabled={replacingRemote}
              />
              <Button
                title="Cancel"
                onPress={handleMismatchCancel}
                variant="secondary"
                disabled={replacingRemote}
              />
            </div>
          </div>
        </div>
      )}

      {/* Not-yet-available banner for Google Drive / iCloud */}
      {(syncProvider === 'google-drive' || syncProvider === 'icloud') && !isConnected && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            background: theme.colors.warningLight,
            border: `1px solid ${theme.colors.warning}`,
            borderRadius: theme.radii.md,
            marginBottom: 20,
          }}
        >
          <AlertTriangle size={18} style={{ color: theme.colors.warning, flexShrink: 0 }} />
          <span
            style={{
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.text,
            }}
          >
            {syncProvider === 'google-drive' ? 'Google Drive' : 'iCloud'} sync is not yet available.
            Please check back in a future update.
          </span>
        </div>
      )}

      {/* WebDAV credential fields — shown when webdav selected and not connected */}
      {syncProvider === 'webdav' && !isConnected && (
        <div style={{ marginBottom: 8 }}>
          <TextInput
            label="WebDAV URL"
            value={webdavUrl}
            onChangeText={setWebdavUrl}
            placeholder="https://dav.example.com/keykeykey/"
          />
          <TextInput
            label="Username"
            value={webdavUsername}
            onChangeText={setWebdavUsername}
            placeholder="your-username"
          />
          <TextInput
            label="Password"
            value={webdavPassword}
            onChangeText={setWebdavPassword}
            placeholder="your-password"
            secureTextEntry
          />
        </div>
      )}

      {/* Error when not connected */}
      {!isConnected && syncError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '10px 12px',
            background: theme.colors.errorLight,
            border: `1px solid ${theme.colors.error}`,
            borderRadius: theme.radii.sm,
            marginBottom: 16,
          }}
        >
          <AlertTriangle
            size={15}
            style={{ color: theme.colors.error, flexShrink: 0, marginTop: 1 }}
          />
          <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.error }}>
            {syncError}
          </span>
        </div>
      )}

      {/* Connected state */}
      {isConnected && (
        <div
          style={{
            padding: '16px',
            background: theme.colors.surface,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radii.md,
            marginBottom: 20,
          }}
        >
          {/* Sync status row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: syncError ? 12 : 0,
            }}
          >
            {isSyncing ? (
              <span
                style={{
                  fontSize: theme.typography.sizes.sm,
                  color: theme.colors.textSecondary,
                }}
              >
                Syncing...
              </span>
            ) : lastSynced ? (
              <>
                <CheckCircle size={16} style={{ color: theme.colors.success, flexShrink: 0 }} />
                <span
                  style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary }}
                >
                  Last synced: {formatLastSynced(lastSynced)}
                </span>
              </>
            ) : (
              <>
                <Cloud size={16} style={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
                <span
                  style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary }}
                >
                  Never synced
                </span>
              </>
            )}
          </div>

          {/* Error message */}
          {syncError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                background: theme.colors.errorLight,
                border: `1px solid ${theme.colors.error}`,
                borderRadius: theme.radii.sm,
              }}
            >
              <AlertTriangle
                size={15}
                style={{ color: theme.colors.error, flexShrink: 0, marginTop: 1 }}
              />
              <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.error }}>
                {syncError}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {isConnected ? (
          <>
            <Button
              title={isSyncing ? 'Syncing...' : 'Sync Now'}
              onPress={handleSyncNow}
              variant="primary"
              loading={isSyncing}
              disabled={isSyncing}
            />
            <Button
              title="Disconnect"
              onPress={() => setShowDisconnectConfirm(true)}
              variant="danger"
              disabled={isSyncing}
            />
          </>
        ) : (
          syncProvider === 'webdav' && (
            <Button
              title="Connect"
              onPress={handleConnect}
              variant="primary"
              loading={connecting}
              disabled={!canConnect || connecting}
            />
          )
        )}
      </div>

      {/* Disconnect confirmation dialog */}
      {showDisconnectConfirm && (
        <div
          style={{
            position: 'fixed',
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
              padding: 24,
              maxWidth: 380,
              width: '90%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <h3
              style={{
                fontSize: theme.typography.sizes.lg,
                fontWeight: theme.typography.weights.semibold,
                color: theme.colors.text,
                margin: '0 0 8px',
              }}
            >
              Disconnect Sync
            </h3>
            <p
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
                margin: '0 0 20px',
              }}
            >
              Are you sure? You will need to re-enter your credentials to reconnect.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <Button
                title="Cancel"
                onPress={() => setShowDisconnectConfirm(false)}
                variant="secondary"
              />
              <Button title="Disconnect" onPress={handleDisconnect} variant="danger" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
