import React from 'react';
import { SetupScreen } from '../screens/SetupScreen.js';
import { RecoveryKeyScreen } from '../screens/RecoveryKeyScreen.js';
import { UnlockScreen } from '../screens/UnlockScreen.js';
import { VaultListScreen } from '../screens/VaultListScreen.js';
import { CredentialDetailScreen } from '../screens/CredentialDetailScreen.js';
import { AddItemScreen } from '../screens/AddItemScreen.js';
import { EditItemScreen } from '../screens/EditItemScreen.js';
import { GeneratorScreen } from '../screens/GeneratorScreen.js';
import { AuthenticatorScreen } from '../screens/AuthenticatorScreen.js';
import { SettingsScreen } from '../screens/SettingsScreen/index.js';
import { SyncSettingsScreen } from '../screens/SyncSettingsScreen/index.js';
import { RestoreScreen } from '../screens/RestoreScreen/index.js';
import { ImportScreen } from '../screens/ImportScreen/index.js';
import { ExportScreen } from '../screens/ExportScreen.js';
import { ProgressSpinner, ErrorView } from '../components/ProgressView.js';
import { SYNC_OP_LABELS } from './routes.js';
import type { useTheme } from '../../lib/theme.js';
import type { VaultItem } from '@keykeykey/core';

type Theme = ReturnType<typeof useTheme>['theme'];

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

export function Router({
  status,
  hasPIN,
  operationCheckDone,
  activeOperation,
  restoreError,
  syncOpKind,
  syncOpError,
  clearRestoreError,
  clearSyncOpError,
  screen,
  setScreen,
  items,
  pendingRecoveryKey,
  refresh,
  loadItems,
  handleNavigate,
  handleBack,
  handleSetupComplete,
  handleRecoveryKeyConfirmed,
  theme,
}: {
  status: string;
  hasPIN: boolean;
  operationCheckDone: boolean;
  activeOperation: 'import' | 'restore' | 'restore-error' | 'sync-op' | 'sync-op-error' | null;
  restoreError: string | null;
  syncOpKind: 'replacing_remote' | 'replacing_local' | 'merging' | null;
  syncOpError: string | null;
  clearRestoreError: () => Promise<void>;
  clearSyncOpError: () => Promise<void>;
  screen: string;
  setScreen: React.Dispatch<React.SetStateAction<string>>;
  items: VaultItem[];
  pendingRecoveryKey: string | null;
  refresh: () => void;
  loadItems: () => Promise<void>;
  handleNavigate: (target: string) => Promise<void>;
  handleBack: () => void;
  handleSetupComplete: (recoveryKey: string) => void;
  handleRecoveryKeyConfirmed: () => void;
  theme: Theme;
}) {
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

    if (screen === 'authenticator') {
      return <AuthenticatorScreen onBack={handleBack} onNavigate={handleNavigate} />;
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
          onRefreshItems={loadItems}
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

  if (status === 'loading') return <LoadingScreen />;
  if (!operationCheckDone) return <LoadingScreen />;

  if (activeOperation === 'restore') {
    return (
      <ProgressSpinner
        title="Restoring Vault"
        message="Downloading and decrypting your vault\u2026"
        subtitle="You can close this window \u2014 the restore will continue in the background."
        theme={theme}
      />
    );
  }

  if (activeOperation === 'restore-error') {
    return (
      <ErrorView
        title="Restore Failed"
        error={restoreError ?? 'Restore failed'}
        buttonLabel="Try Again"
        onDismiss={clearRestoreError}
        theme={theme}
      />
    );
  }

  if (activeOperation === 'sync-op') {
    const label = SYNC_OP_LABELS[syncOpKind ?? 'replacing_remote'];
    return (
      <ProgressSpinner
        title="Resolving Vault Mismatch"
        message={`${label}\u2026`}
        subtitle="You can close this window \u2014 the operation will continue in the background."
        theme={theme}
      />
    );
  }

  if (activeOperation === 'sync-op-error') {
    return (
      <ErrorView
        title="Sync Operation Failed"
        error={syncOpError ?? 'Sync operation failed'}
        buttonLabel="Dismiss"
        onDismiss={clearSyncOpError}
        theme={theme}
      />
    );
  }

  if (pendingRecoveryKey) {
    return (
      <RecoveryKeyScreen recoveryKey={pendingRecoveryKey} onConfirm={handleRecoveryKeyConfirmed} />
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
}
