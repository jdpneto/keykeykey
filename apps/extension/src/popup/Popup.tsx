import React, { useState } from 'react';
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

  const containerStyle: React.CSSProperties = {
    minHeight: '480px',
    width: '360px',
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
    if (
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
      return <VaultListScreen onNavigate={handleNavigate} />;
    }

    if (screen === 'add') {
      return <AddItemScreen onBack={handleBack} onNavigate={handleNavigate} onRefresh={refresh} />;
    }

    if (screen === 'generator') {
      return <GeneratorScreen onBack={handleBack} />;
    }

    if (screen === 'settings') {
      return <SettingsScreen onBack={handleBack} onRefresh={refresh} />;
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
      return (
        <EditItemScreen
          item={item}
          onBack={handleBack}
          onNavigate={handleNavigate}
          onRefresh={refresh}
        />
      );
    }

    return <VaultListScreen onNavigate={handleNavigate} />;
  };

  return (
    <div style={containerStyle}>
      {status === 'loading' && <LoadingScreen />}
      {status === 'needs_setup' && !pendingRecoveryKey && (
        <SetupScreen onComplete={handleSetupComplete} />
      )}
      {pendingRecoveryKey && (
        <RecoveryKeyScreen
          recoveryKey={pendingRecoveryKey}
          onConfirm={handleRecoveryKeyConfirmed}
        />
      )}
      {status === 'locked' && !pendingRecoveryKey && (
        <UnlockScreen hasPIN={hasPIN} onUnlock={refresh} />
      )}
      {status === 'unlocked' && !pendingRecoveryKey && renderUnlockedScreen()}
    </div>
  );
}
