import React from 'react';
import { useTheme } from '../../../lib/theme.js';

interface ImportProgressViewProps {
  status: 'importing' | 'syncing';
  imported: number;
  total: number;
}

export function ImportProgressView({ status, imported, total }: ImportProgressViewProps) {
  const { theme } = useTheme();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      {/* Header without back button -- can't leave during import */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        <div
          style={{
            flex: 1,
            fontWeight: theme.typography.weights.bold,
            fontSize: theme.typography.sizes.md,
            color: theme.colors.text,
          }}
        >
          {status === 'syncing' ? 'Syncing to Cloud' : 'Importing Passwords'}
        </div>
      </div>

      {/* Progress body */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        {/* Spinner */}
        <div
          style={{
            width: 48,
            height: 48,
            border: `4px solid ${theme.colors.border}`,
            borderTopColor: theme.colors.primary,
            borderRadius: '50%',
            animation: 'keykey-spin 1s linear infinite',
          }}
        />
        <style>{`@keyframes keykey-spin { to { transform: rotate(360deg); } }`}</style>

        {/* Status text */}
        <div
          style={{
            fontSize: theme.typography.sizes.md,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.text,
            textAlign: 'center',
          }}
        >
          {status === 'syncing' ? 'Uploading to cloud\u2026' : `Importing ${imported} of ${total}`}
        </div>

        {/* Progress bar (only during importing phase) */}
        {status === 'importing' && total > 0 && (
          <div
            style={{
              width: '80%',
              height: 8,
              background: theme.colors.border,
              borderRadius: theme.radii.sm,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${(imported / total) * 100}%`,
                height: '100%',
                background: theme.colors.primary,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        )}

        <div
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            marginTop: theme.spacing.sm,
          }}
        >
          Please wait. You can close this window — the import will continue in the background.
        </div>
      </div>
    </div>
  );
}
