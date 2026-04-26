import React, { useState } from 'react';
import { useVaultStatus } from './hooks/useVaultStatus.js';
import { useTheme } from '../lib/theme.js';
import { sendMessage } from './hooks/useMessage.js';
import { useOperationProgress } from './router/useOperationProgress.js';
import { Router } from './router/Router.js';
import type { VaultItem } from '@keykeykey/core';

export function Popup() {
  const { status, hasPIN, refresh } = useVaultStatus();
  const { theme } = useTheme();

  // Post-setup: show recovery key before going to vault
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState<string | null>(null);

  // Unlocked navigation state
  const [screen, setScreen] = useState<string>('list');

  // Cached items for detail/edit lookups
  const [items, setItems] = useState<VaultItem[]>([]);

  const {
    operationCheckDone,
    activeOperation,
    restoreError,
    syncOpKind,
    syncOpError,
    clearRestoreError,
    clearSyncOpError,
  } = useOperationProgress(status, refresh, setScreen);

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
      screen === 'authenticator' ||
      screen === 'settings'
    ) {
      setScreen('list');
    } else {
      setScreen('list');
    }
  };

  return (
    <div style={containerStyle}>
      <Router
        status={status}
        hasPIN={hasPIN}
        operationCheckDone={operationCheckDone}
        activeOperation={activeOperation}
        restoreError={restoreError}
        syncOpKind={syncOpKind}
        syncOpError={syncOpError}
        clearRestoreError={clearRestoreError}
        clearSyncOpError={clearSyncOpError}
        screen={screen}
        setScreen={setScreen}
        items={items}
        pendingRecoveryKey={pendingRecoveryKey}
        refresh={refresh}
        loadItems={loadItems}
        handleNavigate={handleNavigate}
        handleBack={handleBack}
        handleSetupComplete={handleSetupComplete}
        handleRecoveryKeyConfirmed={handleRecoveryKeyConfirmed}
        theme={theme}
      />
    </div>
  );
}
