import React from 'react';
import type { useTheme } from '../../lib/theme.js';

type Theme = ReturnType<typeof useTheme>['theme'];

export function ProgressSpinner({
  title,
  message,
  subtitle,
  theme,
}: {
  title: string;
  message: string;
  subtitle?: string;
  theme: Theme;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      <div
        style={{
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          fontWeight: theme.typography.weights.bold,
          fontSize: theme.typography.sizes.md,
          color: theme.colors.text,
        }}
      >
        {title}
      </div>
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
        <div
          style={{
            fontSize: theme.typography.sizes.md,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.text,
            textAlign: 'center',
          }}
        >
          {message}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: theme.typography.sizes.xs,
              color: theme.colors.textSecondary,
              textAlign: 'center',
              marginTop: theme.spacing.sm,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

export function ErrorView({
  title,
  error,
  buttonLabel,
  onDismiss,
  theme,
}: {
  title: string;
  error: string;
  buttonLabel: string;
  onDismiss: () => void;
  theme: Theme;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      <div
        style={{
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          fontWeight: theme.typography.weights.bold,
          fontSize: theme.typography.sizes.md,
          color: theme.colors.text,
        }}
      >
        {title}
      </div>
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
        <div style={{ fontSize: 40 }}>&#9888;&#65039;</div>
        <div
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.text,
            textAlign: 'center',
          }}
        >
          {error}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            marginTop: theme.spacing.md,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            background: theme.colors.primary,
            color: '#000',
            border: 'none',
            borderRadius: theme.radii.md,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.semibold,
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
