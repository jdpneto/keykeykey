import React from 'react';
import { useTheme } from '../../../lib/theme.js';

type ProgressStep = 'restoring' | 'success' | 'created';

interface RestoreProgressProps {
  step: ProgressStep;
  itemCount: number;
  recoveryKey: string;
  onComplete: () => void;
}

export function RestoreProgress({
  step,
  itemCount,
  recoveryKey,
  onComplete,
}: RestoreProgressProps) {
  const { theme } = useTheme();

  if (step === 'restoring') {
    return (
      <div
        style={{
          textAlign: 'center',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <h1
          style={{
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
            margin: `0 0 ${theme.spacing.sm}px 0`,
          }}
        >
          Restoring Vault
        </h1>
        <p
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.textSecondary,
            margin: `0 0 ${theme.spacing.lg}px 0`,
          }}
        >
          Downloading and decrypting your vault...
        </p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div
            style={{
              width: 28,
              height: 28,
              border: `3px solid ${theme.colors.border}`,
              borderTopColor: theme.colors.primary,
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div
        style={{
          textAlign: 'center',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <h1
          style={{
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
            margin: `0 0 ${theme.spacing.sm}px 0`,
          }}
        >
          Vault Restored
        </h1>
        <p
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.textSecondary,
            margin: `0 0 ${theme.spacing.lg}px 0`,
          }}
        >
          Successfully restored {itemCount} {itemCount === 1 ? 'item' : 'items'} from the cloud.
        </p>
        <button
          onClick={onComplete}
          style={{
            width: '100%',
            padding: `${theme.spacing.sm}px`,
            background: theme.colors.primary,
            border: 'none',
            borderRadius: theme.radii.md,
            color: '#000',
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.semibold,
          }}
        >
          Go to Vault
        </button>
      </div>
    );
  }

  // step === 'created'
  return (
    <div
      style={{
        textAlign: 'center',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <div style={{ fontSize: 32, marginBottom: theme.spacing.sm }}>&#9989;</div>
      <h1
        style={{
          fontSize: theme.typography.sizes.xl,
          fontWeight: theme.typography.weights.bold,
          color: theme.colors.text,
          margin: `0 0 ${theme.spacing.sm}px 0`,
        }}
      >
        Vault Created
      </h1>
      <p
        style={{
          fontSize: theme.typography.sizes.sm,
          color: theme.colors.textSecondary,
          margin: `0 0 ${theme.spacing.md}px 0`,
        }}
      >
        No existing vault was found on Google Drive, so a new one was created and sync configured.
      </p>
      {recoveryKey && (
        <div
          style={{
            background: theme.colors.warningLight,
            border: `1px solid ${theme.colors.warning}`,
            borderRadius: theme.radii.md,
            padding: theme.spacing.md,
            marginBottom: theme.spacing.md,
            textAlign: 'left',
          }}
        >
          <div
            style={{
              fontSize: theme.typography.sizes.xs,
              fontWeight: theme.typography.weights.semibold,
              color: theme.colors.warning,
              marginBottom: theme.spacing.xs,
            }}
          >
            Save your recovery key
          </div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: theme.typography.sizes.xs,
              color: theme.colors.text,
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {recoveryKey}
          </div>
        </div>
      )}
      <button
        onClick={onComplete}
        style={{
          width: '100%',
          padding: `${theme.spacing.sm}px`,
          background: theme.colors.primary,
          border: 'none',
          borderRadius: theme.radii.md,
          color: '#000',
          cursor: 'pointer',
          fontSize: theme.typography.sizes.sm,
          fontWeight: theme.typography.weights.semibold,
        }}
      >
        Go to Vault
      </button>
    </div>
  );
}
