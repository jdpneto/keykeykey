import React, { useState } from 'react';
import { useVaultStatus } from './hooks/useVaultStatus.js';
import { useTheme } from '../lib/theme.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { RecoveryKeyScreen } from './screens/RecoveryKeyScreen.js';
import { UnlockScreen } from './screens/UnlockScreen.js';
import { VaultListScreen } from './screens/VaultListScreen.js';

function LoadingScreen() {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}
    >
      <p>Loading...</p>
    </div>
  );
}

// Stub screens for navigation targets not yet implemented
function StubScreen({ title }: { title: string }) {
  return (
    <div style={{ padding: 24 }}>
      <h2>{title}</h2>
      <p>Coming soon.</p>
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

  const renderUnlockedScreen = () => {
    if (screen === 'list') return <VaultListScreen onNavigate={setScreen} />;
    if (screen === 'add') return <StubScreen title="Add Item" />;
    if (screen === 'generator') return <StubScreen title="Password Generator" />;
    if (screen === 'settings') return <StubScreen title="Settings" />;
    if (screen.startsWith('detail:')) return <StubScreen title="Item Detail" />;
    if (screen.startsWith('edit:')) return <StubScreen title="Edit Item" />;
    return <VaultListScreen onNavigate={setScreen} />;
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
