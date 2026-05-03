import React from 'react';
import type { MismatchInfo } from '../../hooks/sync-settings-types.js';
import type { SyncSettingsTheme } from './types.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MismatchDialogProps {
  mismatchInfo: MismatchInfo;

  // Operation flags
  merging: boolean;
  replacingLocal: boolean;
  replacingRemote: boolean;

  // Action callbacks
  onMerge: () => void;
  onReplaceLocal: () => void;
  onReplaceRemote: () => void;
  onCancel: () => void;

  // Styling
  theme: SyncSettingsTheme;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MismatchDialog({
  mismatchInfo,
  merging,
  replacingLocal,
  replacingRemote,
  onMerge,
  onReplaceLocal,
  onReplaceRemote,
  onCancel,
  theme,
}: MismatchDialogProps) {
  const busy = merging || replacingLocal || replacingRemote;

  // ---- shared button helpers ----
  const buttonBase: React.CSSProperties = {
    width: '100%',
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
    backgroundColor: theme.colors.primary,
    color: theme.colors.text,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  const secondaryBtn = (disabled: boolean): React.CSSProperties => ({
    ...buttonBase,
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.text,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  const dangerBtn = (disabled: boolean): React.CSSProperties => ({
    ...buttonBase,
    backgroundColor: theme.colors.danger,
    color: '#fff',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  const itemCount = mismatchInfo.remoteItemCount;
  const description = mismatchInfo.canRestore
    ? typeof itemCount === 'number'
      ? `The remote server has a vault with ${itemCount} item${itemCount === 1 ? '' : 's'} from a different device.`
      : 'The remote server has an existing vault from a different device.'
    : 'The remote server has vault data encrypted with a different password.';

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
          padding: theme.spacing.lg,
          margin: theme.spacing.md,
          maxWidth: 420,
          width: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        {/* Title */}
        <div
          style={{
            fontSize: theme.typography.sizes.lg,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.text,
            marginBottom: theme.spacing.sm,
          }}
        >
          {mismatchInfo.canRestore ? 'Remote Vault Detected' : 'Incompatible Remote Vault'}
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.textSecondary,
            marginBottom: theme.spacing.md,
          }}
        >
          {description}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
          {mismatchInfo.canRestore && (
            <>
              <button onClick={onMerge} disabled={busy} style={primaryBtn(busy)}>
                {merging ? 'Merging...' : 'Merge Vaults'}
              </button>
              <button onClick={onReplaceLocal} disabled={busy} style={secondaryBtn(busy)}>
                {replacingLocal ? 'Replacing...' : 'Replace Local with Remote'}
              </button>
            </>
          )}
          <button onClick={onReplaceRemote} disabled={busy} style={dangerBtn(busy)}>
            {replacingRemote ? 'Replacing...' : 'Replace Remote with Local'}
          </button>
          <button onClick={onCancel} disabled={busy} style={secondaryBtn(busy)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
