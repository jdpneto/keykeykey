import React, { useState } from 'react';
import { useTheme } from '../../lib/theme.js';

interface RecoveryKeyScreenProps {
  recoveryKey: string;
  onConfirm: () => void;
}

export function RecoveryKeyScreen({ recoveryKey, onConfirm }: RecoveryKeyScreenProps) {
  const { theme } = useTheme();
  const [confirmed, setConfirmed] = useState(false);

  const handleConfirm = () => {
    if (confirmed) {
      onConfirm();
    }
  };

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
        minHeight: '100%',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: theme.spacing.sm }}>&#128220;</div>
        <h1
          style={{
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
            margin: 0,
          }}
        >
          Save Your Recovery Key
        </h1>
        <p
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            marginTop: theme.spacing.xs,
          }}
        >
          Store this key somewhere safe. It&apos;s the only way to recover your vault if you forget
          your master password.
        </p>
      </div>

      {/* Recovery key display */}
      <div
        style={{
          background: theme.colors.surface,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radii.md,
          padding: theme.spacing.md,
        }}
      >
        <div
          style={{
            fontSize: theme.typography.sizes.xs,
            fontWeight: theme.typography.weights.medium,
            color: theme.colors.textSecondary,
            marginBottom: theme.spacing.sm,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Recovery Key
        </div>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.text,
            wordBreak: 'break-all',
            lineHeight: 1.6,
            userSelect: 'all',
          }}
        >
          {recoveryKey}
        </div>
      </div>

      {/* Warning */}
      <div
        style={{
          background: theme.colors.inputBackground,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radii.sm,
          padding: theme.spacing.sm,
          fontSize: theme.typography.sizes.xs,
          color: theme.colors.textSecondary,
        }}
      >
        &#9888; This key will not be shown again. Write it down or save it in a secure location.
      </div>

      {/* Confirmation checkbox */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          cursor: 'pointer',
          fontSize: theme.typography.sizes.sm,
          color: theme.colors.text,
        }}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          style={{ width: 16, height: 16, cursor: 'pointer' }}
        />
        I&apos;ve saved my recovery key
      </label>

      {/* Confirm button */}
      <button
        onClick={handleConfirm}
        disabled={!confirmed}
        style={{
          background: confirmed ? theme.colors.primary : theme.colors.border,
          color: confirmed ? '#000' : theme.colors.textSecondary,
          border: 'none',
          borderRadius: theme.radii.md,
          padding: `${theme.spacing.sm}px`,
          fontSize: theme.typography.sizes.sm,
          fontWeight: theme.typography.weights.semibold,
          cursor: confirmed ? 'pointer' : 'not-allowed',
          transition: 'background 0.15s, color 0.15s',
          marginTop: 'auto',
        }}
      >
        Continue to Vault
      </button>
    </div>
  );
}
