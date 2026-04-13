import React from 'react';
import type { SyncSettingsTheme } from './types.js';

// Inline cloud SVG icon

function CloudIcon({ size = 28, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ marginBottom: 12 }}
    >
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConnectingOverlayProps {
  /** Whether the overlay should be shown. */
  connecting: boolean;
  /** Called when the user clicks Cancel. */
  onCancel: () => void;
  /** Theme tokens. */
  theme: SyncSettingsTheme;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConnectingOverlay({ connecting, onCancel, theme }: ConnectingOverlayProps) {
  if (!connecting) return null;

  const buttonStyle: React.CSSProperties = {
    padding: '10px 20px',
    borderRadius: theme.radii.md,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    border: 'none',
    cursor: 'pointer',
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.text,
    textAlign: 'center',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.4)',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: theme.colors.background,
          borderRadius: theme.radii.lg,
          padding: 24,
          maxWidth: 340,
          width: '90%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          textAlign: 'center',
        }}
      >
        <CloudIcon size={28} color={theme.colors.primary} />
        <h3
          style={{
            fontSize: theme.typography.sizes.lg,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.text,
            margin: '0 0 8px',
          }}
        >
          Connecting to Cloud
        </h3>
        <p
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.textSecondary,
            margin: '0 0 20px',
          }}
        >
          Checking for existing vault data...
        </p>
        <button onClick={onCancel} style={buttonStyle} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
