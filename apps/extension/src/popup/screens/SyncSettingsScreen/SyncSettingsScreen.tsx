import React, { useEffect, useMemo } from 'react';
import browser from 'webextension-polyfill';
import { useTheme } from '../../../lib/theme.js';
import { sendMessage } from '../../hooks/useMessage.js';
import type { SyncStatus as ExtSyncStatus } from '../../../lib/messages.js';
import { useSyncSettings } from '@keykeykey/ui';
import type { SyncSettingsDriver, SyncStatus, MismatchInfo } from '@keykeykey/ui';
import {
  ProviderSelector,
  MismatchDialog,
  SyncStatusCard,
  ConnectingOverlay,
} from '@keykeykey/ui/sync-settings';

interface SyncSettingsScreenProps {
  onBack: () => void;
}

/** Parse GET_SYNC_STATUS response into the shared SyncStatus shape. */
function parseSyncStatus(raw: unknown): SyncStatus | null {
  const s = raw as ExtSyncStatus | null;
  if (!s || s.provider === undefined) return null;
  return {
    provider: s.provider,
    lastSynced: s.lastSynced ?? null,
    isSyncing: s.isSyncing ?? false,
    error: s.error ?? null,
  };
}

/** Parse GET_MISMATCH_INFO response. */
function parseMismatchInfo(raw: unknown): MismatchInfo | null {
  const mi = raw as (MismatchInfo & { error?: string }) | null;
  if (!mi || mi.error || mi.canRestore === undefined) return null;
  return mi;
}

export function SyncSettingsScreen({ onBack }: SyncSettingsScreenProps) {
  const { theme } = useTheme();

  const driver = useMemo<SyncSettingsDriver>(() => {
    async function fetchState() {
      const [statusResult, mismatchResult] = await Promise.all([
        sendMessage<ExtSyncStatus>({ type: 'GET_SYNC_STATUS' }),
        sendMessage<MismatchInfo | null>({ type: 'GET_MISMATCH_INFO' }),
      ]);
      return {
        syncStatus: parseSyncStatus(statusResult),
        mismatchInfo: parseMismatchInfo(mismatchResult),
      };
    }

    return {
      getInitialState: fetchState,
      refreshStatus: fetchState,

      validateMasterPassword: async (password: string) => {
        const r = await sendMessage<{ valid?: boolean; error?: string }>({
          type: 'VALIDATE_MASTER_PASSWORD',
          password,
        });
        if (r.error) throw new Error(r.error);
        return r.valid !== false;
      },

      saveConfig: async (config) => {
        const r = await sendMessage<{ ok?: boolean; error?: string }>({
          type: 'CONFIGURE_SYNC',
          config,
        });
        if (r?.error) throw new Error(r.error);
      },

      triggerSync: async () => {
        const r = await sendMessage<{ ok?: boolean; error?: string }>({ type: 'TRIGGER_SYNC' });
        if (r?.error) return { error: r.error };
        return {};
      },

      disconnect: async (provider) => {
        if (provider === 'google-drive') {
          await sendMessage({ type: 'GOOGLE_OAUTH_DISCONNECT' });
        } else if (provider === 'dropbox') {
          await sendMessage({ type: 'DROPBOX_OAUTH_DISCONNECT' });
        } else if (provider === 'onedrive') {
          await sendMessage({ type: 'ONEDRIVE_OAUTH_DISCONNECT' });
        } else {
          await sendMessage({ type: 'DISCONNECT_SYNC' });
        }
      },

      startOAuth: async (provider, masterPassword) => {
        const typeMap = {
          'google-drive': 'GOOGLE_OAUTH_CONNECT',
          dropbox: 'DROPBOX_OAUTH_CONNECT',
          onedrive: 'ONEDRIVE_OAUTH_CONNECT',
        } as const;
        const r = await sendMessage<{ ok?: boolean; error?: string }>({
          type: typeMap[provider],
          masterPassword,
        });
        if (r?.error) throw new Error(r.error);
        await sendMessage({ type: 'TRIGGER_SYNC' });
      },

      mergeVaults: async () => {
        const r = await sendMessage<{ success?: boolean; error?: string }>({
          type: 'MERGE_VAULTS',
        });
        if (r?.error) throw new Error(r.error);
      },

      replaceLocal: async () => {
        const r = await sendMessage<{ success?: boolean; error?: string }>({
          type: 'REPLACE_LOCAL',
        });
        if (r?.error) throw new Error(r.error);
      },

      replaceRemote: async () => {
        const r = await sendMessage<{ success?: boolean; error?: string }>({
          type: 'REPLACE_REMOTE',
        });
        if (r?.error) throw new Error(r.error);
      },

      clearMismatch: async () => {
        await sendMessage({ type: 'CLEAR_MISMATCH' });
      },
    };
  }, []);

  const state = useSyncSettings(driver);

  // Extension-specific: listen for sync_connect_state → 'idle' in browser.storage
  useEffect(() => {
    const listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local') return;
      if (!changes.sync_connect_state) return;
      const newState = changes.sync_connect_state.newValue as { status?: string } | undefined;
      if (!newState || newState.status !== 'idle') return;
      void state.refreshStatus();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [state.refreshStatus]);

  // Extension-specific: poll GET_SYNC_STATUS while isSyncing
  useEffect(() => {
    if (!state.syncStatus?.isSyncing) return;
    let cancelled = false;
    const start = Date.now();
    const interval = setInterval(async () => {
      if (cancelled || Date.now() - start > 30_000) {
        clearInterval(interval);
        return;
      }
      try {
        const next = parseSyncStatus(await sendMessage<ExtSyncStatus>({ type: 'GET_SYNC_STATUS' }));
        if (cancelled) return;
        if (next && !next.isSyncing) {
          clearInterval(interval);
          void state.refreshStatus();
        }
      } catch {
        // transient failure — next tick will retry
      }
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state.syncStatus?.isSyncing, state.refreshStatus]);

  if (state.loading) {
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
        {/* Error banner (not connected) */}
        {!state.isConnected && state.error && (
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
            {state.error}
          </div>
        )}

        {/* Provider selector with credential fields and connect/sign-in buttons */}
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

        {/* Connected state: status card with sync/disconnect */}
        {state.isConnected && (
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
        )}
      </div>

      {/* Connecting overlay */}
      <ConnectingOverlay connecting={state.connecting} onCancel={() => {}} theme={theme} />

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
