import React from 'react';
import type { SyncSettingsTheme } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLastSynced(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Inline SVG icons to avoid external dependency

function CheckCircleIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
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
      style={{ flexShrink: 0 }}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function CloudIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
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
      style={{ flexShrink: 0 }}
    >
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

function AlertTriangleIcon({
  size = 15,
  color = 'currentColor',
}: {
  size?: number;
  color?: string;
}) {
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
      style={{ flexShrink: 0, marginTop: 1 }}
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1={12} y1={9} x2={12} y2={13} />
      <line x1={12} y1={17} x2={12.01} y2={17} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SyncStatusCardProps {
  /** ISO string of last successful sync, or null. */
  lastSynced: string | null;
  /** Whether a sync operation is currently in progress. */
  syncing: boolean;
  /** Current error message, if any. */
  error: string | null;
  /** Whether the disconnect confirmation dialog is shown. */
  showDisconnectConfirm: boolean;
  /** Toggle the disconnect confirmation dialog. */
  setShowDisconnectConfirm: (v: boolean) => void;
  /** Trigger a manual sync. */
  onSyncNow: () => void;
  /** Confirm disconnect. */
  onDisconnect: () => void;

  // Styling
  theme: SyncSettingsTheme;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SyncStatusCard({
  lastSynced,
  syncing,
  error,
  showDisconnectConfirm,
  setShowDisconnectConfirm,
  onSyncNow,
  onDisconnect,
  theme,
}: SyncStatusCardProps) {
  // ---- button helpers ----
  const buttonBase: React.CSSProperties = {
    padding: '10px 20px',
    borderRadius: theme.radii.md,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    border: 'none',
    cursor: 'pointer',
    textAlign: 'center',
  };

  const primaryBtn = (disabled: boolean): React.CSSProperties => ({
    ...buttonBase,
    width: '100%',
    backgroundColor: theme.colors.primary,
    color: theme.colors.text,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  const dangerBtn = (disabled: boolean): React.CSSProperties => ({
    ...buttonBase,
    width: '100%',
    backgroundColor: theme.colors.danger,
    color: '#fff',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  const secondaryBtn: React.CSSProperties = {
    ...buttonBase,
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.text,
  };

  return (
    <>
      {/* Status card */}
      <div
        style={{
          padding: 16,
          background: theme.colors.surface,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radii.md,
          marginBottom: 20,
        }}
      >
        {/* Sync status row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: error ? 12 : 0,
          }}
        >
          {syncing ? (
            <span
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
              }}
            >
              Syncing...
            </span>
          ) : lastSynced ? (
            <>
              <CheckCircleIcon size={16} color={theme.colors.success} />
              <span
                style={{
                  fontSize: theme.typography.sizes.sm,
                  color: theme.colors.textSecondary,
                }}
              >
                Last synced: {formatLastSynced(lastSynced)}
              </span>
            </>
          ) : (
            <>
              <CloudIcon size={16} color={theme.colors.textSecondary} />
              <span
                style={{
                  fontSize: theme.typography.sizes.sm,
                  color: theme.colors.textSecondary,
                }}
              >
                Never synced
              </span>
            </>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 12px',
              background: theme.colors.errorLight,
              border: `1px solid ${theme.colors.error}`,
              borderRadius: theme.radii.sm,
            }}
          >
            <AlertTriangleIcon size={15} color={theme.colors.error} />
            <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.error }}>
              {error}
            </span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button onClick={onSyncNow} disabled={syncing} style={primaryBtn(syncing)}>
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
        <button
          onClick={() => setShowDisconnectConfirm(true)}
          disabled={syncing}
          style={dangerBtn(syncing)}
        >
          Disconnect
        </button>
      </div>

      {/* Disconnect confirmation dialog */}
      {showDisconnectConfirm && (
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
              maxWidth: 380,
              width: '90%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <h3
              style={{
                fontSize: theme.typography.sizes.lg,
                fontWeight: theme.typography.weights.semibold,
                color: theme.colors.text,
                margin: '0 0 8px',
              }}
            >
              Disconnect Sync
            </h3>
            <p
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
                margin: '0 0 20px',
              }}
            >
              Are you sure? You will need to re-enter your credentials to reconnect.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDisconnectConfirm(false)} style={secondaryBtn}>
                Cancel
              </button>
              <button
                onClick={onDisconnect}
                style={{
                  ...buttonBase,
                  backgroundColor: theme.colors.danger,
                  color: '#fff',
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
