import { useTheme } from '../lib/theme';

interface DisableAutoLockDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DisableAutoLockDialog({ open, onClose, onConfirm }: DisableAutoLockDialogProps) {
  const { theme } = useTheme();

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
            color: theme.colors.warning,
            marginBottom: 12,
          }}
        >
          Disable Auto-Lock?
        </h2>
        <p
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.text,
            marginBottom: 20,
          }}
        >
          Your vault will stay unlocked indefinitely. We recommend using biometrics or a PIN for
          quick unlock instead.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
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
            onClick={() => {
              onConfirm();
              onClose();
            }}
            style={{
              padding: '8px 16px',
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.semibold,
              color: '#fff',
              background: theme.colors.warning,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Disable Auto-Lock
          </button>
        </div>
      </div>
    </div>
  );
}
