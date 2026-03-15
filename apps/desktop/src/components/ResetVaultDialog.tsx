import { useState } from 'react';
import { useTheme } from '../lib/theme';

interface ResetVaultDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function ResetVaultDialog({ open, onClose, onConfirm }: ResetVaultDialogProps) {
  const { theme } = useTheme();
  const [resetting, setResetting] = useState(false);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: theme.colors.surface,
          borderRadius: 12,
          padding: 24,
          maxWidth: 420,
          width: '90%',
          border: `1px solid ${theme.colors.border}`,
        }}
      >
        <h2
          style={{
            fontSize: theme.typography.sizes.lg,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.error,
            marginBottom: 12,
          }}
        >
          Reset Vault?
        </h2>
        <p
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.text,
            marginBottom: 12,
          }}
        >
          This will permanently delete your vault from this device. All stored passwords, cards, and
          notes will be lost.
        </p>
        <p
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            marginBottom: 20,
          }}
        >
          If you have a cloud backup, you can restore your vault by setting up cloud sync again
          after resetting.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={resetting}
            style={{
              padding: '8px 16px',
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.medium,
              color: theme.colors.text,
              background: theme.colors.surfaceAlt,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              setResetting(true);
              try {
                await onConfirm();
              } catch {
                /* status change will navigate */
              } finally {
                setResetting(false);
                onClose();
              }
            }}
            disabled={resetting}
            style={{
              padding: '8px 16px',
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.semibold,
              color: '#fff',
              background: theme.colors.error,
              border: 'none',
              borderRadius: 6,
              cursor: resetting ? 'not-allowed' : 'pointer',
              opacity: resetting ? 0.6 : 1,
            }}
          >
            {resetting ? 'Resetting...' : 'Reset Vault'}
          </button>
        </div>
      </div>
    </div>
  );
}
