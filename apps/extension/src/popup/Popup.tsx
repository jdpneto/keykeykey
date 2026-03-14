import React from 'react';
import { useVaultStatus } from './hooks/useVaultStatus.js';
import { useTheme } from '../lib/theme.js';

// Stub screens (will be replaced in Chunks 8-9)
function LoadingScreen() {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}
    >
      <p>Loading...</p>
    </div>
  );
}

function SetupScreen({ onComplete }: { onComplete: () => void }) {
  return (
    <div>
      <h1>Setup</h1>
      <p>Setup screen placeholder</p>
    </div>
  );
}

function UnlockScreen({ hasPIN, onUnlock }: { hasPIN: boolean; onUnlock: () => void }) {
  return (
    <div>
      <h1>Unlock</h1>
      <p>Unlock screen placeholder</p>
    </div>
  );
}

function MainScreen() {
  return (
    <div>
      <h1>Vault</h1>
      <p>Main screen placeholder</p>
    </div>
  );
}

export function Popup() {
  const { status, hasPIN, refresh } = useVaultStatus();
  const { theme } = useTheme();

  const containerStyle: React.CSSProperties = {
    minHeight: '480px',
    width: '360px',
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };

  return (
    <div style={containerStyle}>
      {status === 'loading' && <LoadingScreen />}
      {status === 'needs_setup' && <SetupScreen onComplete={refresh} />}
      {status === 'locked' && <UnlockScreen hasPIN={hasPIN} onUnlock={refresh} />}
      {status === 'unlocked' && <MainScreen />}
    </div>
  );
}
