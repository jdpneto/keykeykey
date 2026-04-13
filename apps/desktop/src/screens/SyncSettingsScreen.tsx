import React, { useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useVault } from '../lib/vault-context';
import { useSyncSettings } from '@keykeykey/ui';
import type { SyncSettingsDriver, SyncStatus } from '@keykeykey/ui';
import type { SyncProvider } from '@keykeykey/core/sync';
import {
  ProviderSelector,
  MismatchDialog,
  SyncStatusCard,
  ConnectingOverlay,
} from '@keykeykey/ui/sync-settings';
import {
  startGoogleOAuth,
  revokeToken,
  GOOGLE_DRIVE_CLIENT_ID,
  GOOGLE_DRIVE_CLIENT_SECRET,
} from '../lib/google-oauth.js';
import { startDropboxOAuth, DROPBOX_CLIENT_ID, revokeDropboxToken } from '../lib/dropbox-oauth';
import { startOneDriveOAuth, ONEDRIVE_CLIENT_ID } from '../lib/onedrive-oauth';
import { wasSchemeDowngradeDetected, clearSchemeDowngradeFlag } from '../lib/sync';

function buildSyncStatus(
  syncConfig: { provider: SyncProvider } | null,
  lastSynced: string | null,
): SyncStatus | null {
  if (!syncConfig || syncConfig.provider === 'none') return null;
  return {
    provider: syncConfig.provider,
    lastSynced,
    isSyncing: false,
    error: null,
  };
}

export function SyncSettingsScreen() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const vault = useVault();

  const driver = useMemo<SyncSettingsDriver>(() => {
    return {
      validateMasterPassword: (password) => vault.validateMasterPassword(password),

      saveConfig: (config) => vault.saveSyncConfig(config),

      getInitialState: async () => ({
        syncStatus: buildSyncStatus(vault.syncConfig, vault.lastSynced),
        mismatchInfo: vault.vaultMismatchInfo,
      }),

      refreshStatus: async () => ({
        syncStatus: buildSyncStatus(vault.syncConfig, vault.lastSynced),
        mismatchInfo: vault.vaultMismatchInfo,
      }),

      triggerSync: async () => {
        const r = await vault.triggerSync();
        return { lastSynced: r.lastSynced ?? undefined, error: r.error ?? undefined };
      },

      disconnect: async (provider: SyncProvider) => {
        if (provider === 'google-drive' && vault.syncConfig?.googleDrive?.refreshToken) {
          try {
            await revokeToken(vault.syncConfig.googleDrive.refreshToken);
          } catch {
            // Best-effort
          }
        }
        if (provider === 'dropbox' && vault.syncConfig?.dropbox?.refreshToken) {
          try {
            await revokeDropboxToken(vault.syncConfig.dropbox.refreshToken);
          } catch {
            // Best-effort
          }
        }
        await vault.saveSyncConfig({ provider: 'none' });
      },

      startOAuth: async (provider, masterPassword) => {
        if (provider === 'google-drive') {
          const { refreshToken } = await startGoogleOAuth();
          await vault.saveSyncConfig({
            provider: 'google-drive',
            masterPassword,
            googleDrive: {
              refreshToken,
              clientId: GOOGLE_DRIVE_CLIENT_ID,
              clientSecret: GOOGLE_DRIVE_CLIENT_SECRET,
            },
          });
        } else if (provider === 'dropbox') {
          const { refreshToken } = await startDropboxOAuth();
          await vault.saveSyncConfig({
            provider: 'dropbox',
            masterPassword,
            dropbox: { refreshToken, clientId: DROPBOX_CLIENT_ID },
          });
        } else if (provider === 'onedrive') {
          const { refreshToken } = await startOneDriveOAuth();
          await vault.saveSyncConfig({
            provider: 'onedrive',
            masterPassword,
            onedrive: { refreshToken, clientId: ONEDRIVE_CLIENT_ID },
          });
        }
        await vault.triggerSync();
      },

      mergeVaults: async () => {
        const result = await vault.mergeRemoteVault();
        if (!result.success) throw new Error(result.error ?? 'Merge failed');
      },

      replaceLocal: async () => {
        const result = await vault.replaceLocalVault();
        if (!result.success) throw new Error(result.error ?? 'Replace failed');
      },

      replaceRemote: async () => {
        const result = await vault.replaceRemoteVault();
        if (!result.success) throw new Error(result.error ?? 'Replace failed');
      },

      clearMismatch: () => vault.clearVaultMismatch(),

      onDisconnected: () => clearSchemeDowngradeFlag(),
    };
    // vault context identity is stable across renders
  }, [vault]);

  const state = useSyncSettings(driver);

  // Support test-set-value custom event on the provider select for automated testing
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const el = selectRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const value = (e as CustomEvent).detail;
      if (typeof value === 'string') state.setSyncProvider(value as SyncProvider);
    };
    el.addEventListener('test-set-value', handler);
    return () => el.removeEventListener('test-set-value', handler);
    // Only attach once on mount
  }, []);

  // Attach ref to the provider select rendered by ProviderSelector via MutationObserver
  useEffect(() => {
    const attach = () => {
      const el = document.querySelector<HTMLSelectElement>('[data-testid="sync-provider"]');
      if (el) (selectRef as React.MutableRefObject<HTMLSelectElement | null>).current = el;
    };
    attach();
    // Re-attach if the DOM changes (e.g. component re-renders)
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

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

      {/* Provider selector with credential fields and connect buttons */}
      <ProviderSelector
        syncProvider={state.syncProvider}
        setSyncProvider={state.setSyncProvider}
        webdavUrl={state.webdavUrl}
        setWebdavUrl={state.setWebdavUrl}
        webdavUsername={state.webdavUsername}
        setWebdavUsername={state.setWebdavUsername}
        webdavPassword={state.webdavPassword}
        setWebdavPassword={state.setWebdavPassword}
        masterPassword={state.masterPassword}
        setMasterPassword={state.setMasterPassword}
        isConnected={state.isConnected}
        canConnect={state.canConnect}
        connecting={state.connecting}
        onConnect={state.handleWebdavConnect}
        onOAuthConnect={state.handleOAuthConnect}
        theme={theme}
      />

      {/* Error when not connected */}
      {!state.isConnected && state.error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '10px 12px',
            background: theme.colors.errorLight,
            border: `1px solid ${theme.colors.error}`,
            borderRadius: theme.radii.sm,
            marginTop: 12,
            marginBottom: 16,
          }}
        >
          <AlertTriangle
            size={15}
            style={{ color: theme.colors.error, flexShrink: 0, marginTop: 1 }}
          />
          <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.error }}>
            {state.error}
          </span>
        </div>
      )}

      {/* Connected state: status card, HTTPS downgrade warning, sync/disconnect */}
      {state.isConnected && (
        <>
          {/* HTTPS to HTTP downgrade warning -- desktop-only, WebDAV only */}
          {state.syncStatus?.provider === 'webdav' && wasSchemeDowngradeDetected() && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                background: theme.colors.warningLight ?? '#fff8e1',
                border: `1px solid ${theme.colors.warning ?? '#f9a825'}`,
                borderRadius: theme.radii.sm,
                marginBottom: 12,
              }}
            >
              <AlertTriangle
                size={15}
                style={{ color: theme.colors.warning ?? '#f9a825', flexShrink: 0, marginTop: 1 }}
              />
              <span
                style={{
                  fontSize: theme.typography.sizes.xs,
                  color: theme.colors.textSecondary,
                }}
              >
                Your WebDAV server redirects HTTPS to HTTP. Check your reverse proxy configuration
                to ensure HTTPS is used end-to-end.
              </span>
            </div>
          )}

          <SyncStatusCard
            lastSynced={state.syncStatus?.lastSynced ?? null}
            syncing={state.syncing}
            error={state.error}
            showDisconnectConfirm={state.showDisconnectConfirm}
            setShowDisconnectConfirm={state.setShowDisconnectConfirm}
            onSyncNow={state.handleSyncNow}
            onDisconnect={state.handleDisconnect}
            theme={theme}
          />
        </>
      )}

      {/* Connecting overlay */}
      <ConnectingOverlay
        connecting={state.connecting}
        onCancel={async () => {
          await vault.saveSyncConfig({ provider: 'none' });
          state.setSyncProvider('none');
          state.setMasterPassword('');
        }}
        theme={theme}
      />

      {/* Vault mismatch dialog */}
      {state.mismatchInfo != null && (
        <MismatchDialog
          mismatchInfo={state.mismatchInfo}
          merging={state.merging}
          replacingLocal={state.replacingLocal}
          replacingRemote={state.replacingRemote}
          onMerge={state.handleMismatchMerge}
          onReplaceLocal={state.handleMismatchReplaceLocal}
          onReplaceRemote={state.handleMismatchReplaceRemote}
          onCancel={state.handleMismatchCancel}
          theme={theme}
        />
      )}
    </div>
  );
}
