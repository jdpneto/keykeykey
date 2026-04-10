import React, { useState, useEffect } from 'react';
import browser from 'webextension-polyfill';
import { useVaultStatus } from './hooks/useVaultStatus.js';
import { useTheme } from '../lib/theme.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { RecoveryKeyScreen } from './screens/RecoveryKeyScreen.js';
import { UnlockScreen } from './screens/UnlockScreen.js';
import { VaultListScreen } from './screens/VaultListScreen.js';
import { CredentialDetailScreen } from './screens/CredentialDetailScreen.js';
import { AddItemScreen } from './screens/AddItemScreen.js';
import { EditItemScreen } from './screens/EditItemScreen.js';
import { GeneratorScreen } from './screens/GeneratorScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { SyncSettingsScreen } from './screens/SyncSettingsScreen.js';
import { RestoreScreen } from './screens/RestoreScreen.js';
import { ImportScreen } from './screens/ImportScreen.js';
import { ExportScreen } from './screens/ExportScreen.js';
import { sendMessage } from './hooks/useMessage.js';
import type { VaultItem } from '@keykeykey/core';

function LoadingScreen() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
      }}
    >
      <p>Loading...</p>
    </div>
  );
}

export function Popup() {
  const { status, hasPIN, refresh } = useVaultStatus();
  const { theme } = useTheme();

  // Post-setup: show recovery key before going to vault
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState<string | null>(null);

  // Unlocked navigation state
  const [screen, setScreen] = useState<string>('list');

  // Cached items for detail/edit lookups
  const [items, setItems] = useState<VaultItem[]>([]);

  // Block rendering of any screen until we've checked whether an import or
  // restore is already running in the background. This prevents a flash of
  // SetupScreen / VaultList where the user could trigger conflicting actions
  // before we route to the correct progress view.
  const [operationCheckDone, setOperationCheckDone] = useState(false);
  const [activeOperation, setActiveOperation] = useState<
    'import' | 'restore' | 'restore-error' | 'sync-op' | 'sync-op-error' | null
  >(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [syncOpKind, setSyncOpKind] = useState<
    'replacing_remote' | 'replacing_local' | 'merging' | null
  >(null);
  const [syncOpError, setSyncOpError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOperationCheckDone(false);
    (async () => {
      try {
        const stored = await browser.storage.local.get([
          'import_state',
          'restore_state',
          'sync_op_state',
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
  }, [status]);

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
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [refresh]);

  const handleClearRestoreError = async () => {
    try {
      await sendMessage({ type: 'CLEAR_RESTORE_STATUS' });
    } catch {
      // ignore
    }
    setActiveOperation(null);
    setRestoreError(null);
  };

  const handleClearSyncOpError = async () => {
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

  const containerStyle: React.CSSProperties = {
    minHeight: '600px',
    width: '380px',
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    position: 'relative',
    overflow: 'hidden',
  };

  const handleSetupComplete = (recoveryKey: string) => {
    setPendingRecoveryKey(recoveryKey);
  };

  const handleRecoveryKeyConfirmed = () => {
    setPendingRecoveryKey(null);
    refresh();
  };

  // Load items for detail/edit screens
  const loadItems = async () => {
    try {
      const result = (await sendMessage<{ items?: VaultItem[] }>({
        type: 'GET_ITEMS',
      })) as { items?: VaultItem[] };
      setItems(result.items ?? []);
    } catch {
      // ignore
    }
  };

  const handleNavigate = async (target: string) => {
    if (target.startsWith('detail:') || target.startsWith('edit:')) {
      await loadItems();
    }
    setScreen(target);
  };

  const handleBack = () => {
    // Pop to previous logical screen
    if (screen === 'import' || screen === 'export') {
      setScreen('settings');
    } else if (screen === 'sync-settings') {
      setScreen('settings');
    } else if (
      screen.startsWith('edit:') ||
      screen.startsWith('detail:') ||
      screen === 'add' ||
      screen === 'generator' ||
      screen === 'settings'
    ) {
      setScreen('list');
    } else {
      setScreen('list');
    }
  };

  const renderUnlockedScreen = () => {
    if (screen === 'list') {
      return <VaultListScreen onNavigate={handleNavigate} onLock={refresh} />;
    }

    if (screen === 'add') {
      return <AddItemScreen onBack={handleBack} onRefresh={refresh} />;
    }

    if (screen === 'generator') {
      return <GeneratorScreen onBack={handleBack} />;
    }

    if (screen === 'settings') {
      return <SettingsScreen onBack={handleBack} onRefresh={refresh} onNavigate={handleNavigate} />;
    }

    if (screen === 'sync-settings') {
      return <SyncSettingsScreen onBack={() => setScreen('settings')} />;
    }

    if (screen === 'import') {
      return <ImportScreen onBack={handleBack} onRefresh={refresh} />;
    }

    if (screen === 'export') {
      return <ExportScreen onBack={handleBack} onRefresh={refresh} />;
    }

    if (screen.startsWith('detail:')) {
      const id = screen.slice('detail:'.length);
      const item = items.find((i) => i.id === id);
      if (!item) {
        return (
          <div style={{ padding: 24 }}>
            <button
              onClick={handleBack}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: theme.colors.textSecondary,
              }}
            >
              &#8592; Back
            </button>
            <p style={{ color: theme.colors.textSecondary }}>Item not found.</p>
          </div>
        );
      }
      return (
        <CredentialDetailScreen
          item={item}
          onNavigate={handleNavigate}
          onBack={handleBack}
          onRefresh={refresh}
        />
      );
    }

    if (screen.startsWith('edit:')) {
      const id = screen.slice('edit:'.length);
      const item = items.find((i) => i.id === id);
      if (!item) {
        return (
          <div style={{ padding: 24 }}>
            <button
              onClick={handleBack}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: theme.colors.textSecondary,
              }}
            >
              &#8592; Back
            </button>
            <p style={{ color: theme.colors.textSecondary }}>Item not found.</p>
          </div>
        );
      }
      return <EditItemScreen item={item} onBack={handleBack} onRefresh={refresh} />;
    }

    return <VaultListScreen onNavigate={handleNavigate} onLock={refresh} />;
  };

  const renderMain = () => {
    if (status === 'loading') return <LoadingScreen />;
    if (!operationCheckDone) return <LoadingScreen />;

    if (activeOperation === 'restore') {
      return <RestoreProgressView theme={theme} />;
    }

    if (activeOperation === 'restore-error') {
      return (
        <RestoreErrorView
          theme={theme}
          error={restoreError ?? 'Restore failed'}
          onDismiss={handleClearRestoreError}
        />
      );
    }

    if (activeOperation === 'sync-op') {
      return <SyncOpProgressView theme={theme} kind={syncOpKind ?? 'replacing_remote'} />;
    }

    if (activeOperation === 'sync-op-error') {
      return (
        <SyncOpErrorView
          theme={theme}
          error={syncOpError ?? 'Sync operation failed'}
          onDismiss={handleClearSyncOpError}
        />
      );
    }

    if (pendingRecoveryKey) {
      return (
        <RecoveryKeyScreen
          recoveryKey={pendingRecoveryKey}
          onConfirm={handleRecoveryKeyConfirmed}
        />
      );
    }

    if (status === 'needs_setup' && !screen.startsWith('restore')) {
      return <SetupScreen onComplete={handleSetupComplete} onNavigate={handleNavigate} />;
    }

    if (status === 'needs_setup' && screen.startsWith('restore')) {
      const initialProvider =
        screen === 'restore:google-drive'
          ? 'google-drive'
          : screen === 'restore:dropbox'
            ? 'dropbox'
            : screen === 'restore:onedrive'
              ? 'onedrive'
              : undefined;
      return (
        <RestoreScreen
          onBack={() => setScreen('list')}
          onComplete={() => {
            setScreen('list');
            refresh();
          }}
          initialProvider={initialProvider}
        />
      );
    }

    if (status === 'locked') {
      return <UnlockScreen hasPIN={hasPIN} onUnlock={refresh} />;
    }

    if (status === 'unlocked') {
      return renderUnlockedScreen();
    }

    return null;
  };

  return <div style={containerStyle}>{renderMain()}</div>;
}

// ---------------------------------------------------------------------------
// Full-screen progress and error views for the RESTORE_FROM_CLOUD flow.
// These are shown when the background worker is mid-restore (or the previous
// restore was interrupted) so the popup doesn't flash SetupScreen or let the
// user start another restore concurrently.
// ---------------------------------------------------------------------------

type Theme = ReturnType<typeof useTheme>['theme'];

function RestoreProgressView({ theme }: { theme: Theme }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      <div
        style={{
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          fontWeight: theme.typography.weights.bold,
          fontSize: theme.typography.sizes.md,
          color: theme.colors.text,
        }}
      >
        Restoring Vault
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            border: `4px solid ${theme.colors.border}`,
            borderTopColor: theme.colors.primary,
            borderRadius: '50%',
            animation: 'keykey-spin 1s linear infinite',
          }}
        />
        <style>{`@keyframes keykey-spin { to { transform: rotate(360deg); } }`}</style>
        <div
          style={{
            fontSize: theme.typography.sizes.md,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.text,
            textAlign: 'center',
          }}
        >
          Downloading and decrypting your vault…
        </div>
        <div
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            marginTop: theme.spacing.sm,
          }}
        >
          You can close this window — the restore will continue in the background.
        </div>
      </div>
    </div>
  );
}

function RestoreErrorView({
  theme,
  error,
  onDismiss,
}: {
  theme: Theme;
  error: string;
  onDismiss: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      <div
        style={{
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          fontWeight: theme.typography.weights.bold,
          fontSize: theme.typography.sizes.md,
          color: theme.colors.text,
        }}
      >
        Restore Failed
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <div style={{ fontSize: 40 }}>&#9888;&#65039;</div>
        <div
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.text,
            textAlign: 'center',
          }}
        >
          {error}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            marginTop: theme.spacing.md,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            background: theme.colors.primary,
            color: '#000',
            border: 'none',
            borderRadius: theme.radii.md,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.semibold,
          }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full-screen progress and error views for mismatch resolution operations
// (replace remote, replace local, merge vaults). Same pattern as restore —
// persist state to storage so the popup can resume on reopen.
// ---------------------------------------------------------------------------

const SYNC_OP_LABELS: Record<'replacing_remote' | 'replacing_local' | 'merging', string> = {
  replacing_remote: 'Replacing cloud vault with local',
  replacing_local: 'Replacing local vault with cloud',
  merging: 'Merging local and cloud vaults',
};

function SyncOpProgressView({
  theme,
  kind,
}: {
  theme: Theme;
  kind: 'replacing_remote' | 'replacing_local' | 'merging';
}) {
  const label = SYNC_OP_LABELS[kind];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      <div
        style={{
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          fontWeight: theme.typography.weights.bold,
          fontSize: theme.typography.sizes.md,
          color: theme.colors.text,
        }}
      >
        Resolving Vault Mismatch
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            border: `4px solid ${theme.colors.border}`,
            borderTopColor: theme.colors.primary,
            borderRadius: '50%',
            animation: 'keykey-spin 1s linear infinite',
          }}
        />
        <style>{`@keyframes keykey-spin { to { transform: rotate(360deg); } }`}</style>
        <div
          style={{
            fontSize: theme.typography.sizes.md,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.text,
            textAlign: 'center',
          }}
        >
          {label}…
        </div>
        <div
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            marginTop: theme.spacing.sm,
          }}
        >
          You can close this window — the operation will continue in the background.
        </div>
      </div>
    </div>
  );
}

function SyncOpErrorView({
  theme,
  error,
  onDismiss,
}: {
  theme: Theme;
  error: string;
  onDismiss: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      <div
        style={{
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          fontWeight: theme.typography.weights.bold,
          fontSize: theme.typography.sizes.md,
          color: theme.colors.text,
        }}
      >
        Sync Operation Failed
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <div style={{ fontSize: 40 }}>&#9888;&#65039;</div>
        <div
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.text,
            textAlign: 'center',
          }}
        >
          {error}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            marginTop: theme.spacing.md,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            background: theme.colors.primary,
            color: '#000',
            border: 'none',
            borderRadius: theme.radii.md,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.semibold,
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
