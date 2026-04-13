import React, { useState } from 'react';
import { useTheme } from '../../../lib/theme.js';
import { sendMessage } from '../../hooks/useMessage.js';

interface DangerZoneProps {
  onRefresh: () => void;
  onError: (error: string) => void;
  sectionStyle: React.CSSProperties;
  sectionHeaderStyle: React.CSSProperties;
}

export function DangerZone({
  onRefresh,
  onError,
  sectionStyle,
  sectionHeaderStyle,
}: DangerZoneProps) {
  const { theme } = useTheme();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  return (
    <>
      <div style={sectionHeaderStyle}>Danger Zone</div>
      <div
        style={{
          ...sectionStyle,
          border: `1px solid ${theme.colors.danger}`,
        }}
      >
        <div
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            marginBottom: theme.spacing.sm,
          }}
        >
          Permanently delete all vault data including credentials, cards, and notes. This action
          cannot be undone.
        </div>
        {showResetConfirm ? (
          <div>
            <p
              style={{
                fontSize: theme.typography.sizes.xs,
                color: theme.colors.danger,
                margin: `0 0 ${theme.spacing.sm}px 0`,
                fontWeight: theme.typography.weights.semibold,
              }}
            >
              Are you sure? All data will be permanently lost.
            </p>
            <div style={{ display: 'flex', gap: theme.spacing.sm }}>
              <button
                onClick={() => setShowResetConfirm(false)}
                style={{
                  flex: 1,
                  padding: `${theme.spacing.xs}px`,
                  background: 'none',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radii.md,
                  color: theme.colors.text,
                  cursor: 'pointer',
                  fontSize: theme.typography.sizes.sm,
                }}
              >
                Cancel
              </button>
              <button
                disabled={resetting}
                onClick={async () => {
                  setResetting(true);
                  try {
                    await sendMessage({ type: 'RESET_VAULT' });
                    onRefresh();
                  } catch {
                    onError('Failed to reset vault.');
                  } finally {
                    setResetting(false);
                    setShowResetConfirm(false);
                  }
                }}
                style={{
                  flex: 1,
                  padding: `${theme.spacing.xs}px`,
                  background: theme.colors.danger,
                  border: 'none',
                  borderRadius: theme.radii.md,
                  color: '#fff',
                  cursor: resetting ? 'not-allowed' : 'pointer',
                  fontSize: theme.typography.sizes.sm,
                  fontWeight: theme.typography.weights.semibold,
                  opacity: resetting ? 0.7 : 1,
                }}
              >
                {resetting ? 'Resetting\u2026' : 'Yes, Reset Vault'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowResetConfirm(true)}
            style={{
              width: '100%',
              padding: `${theme.spacing.xs}px`,
              background: 'none',
              border: `1px solid ${theme.colors.danger}`,
              borderRadius: theme.radii.md,
              color: theme.colors.danger,
              cursor: 'pointer',
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.semibold,
            }}
          >
            Reset Vault
          </button>
        )}
      </div>
    </>
  );
}
