import React from 'react';
import { useTheme } from '../../../lib/theme.js';

interface MismatchInfo {
  canRestore: boolean;
  remoteItemCount: number;
}

interface MismatchResolverProps {
  mismatchInfo: MismatchInfo;
  merging: boolean;
  replacingLocal: boolean;
  replacingRemote: boolean;
  onMerge: () => void;
  onReplaceLocal: () => void;
  onReplaceRemote: () => void;
  onClearMismatch: () => void;
  buttonStyle: (
    variant: 'primary' | 'secondary' | 'danger',
    disabled?: boolean,
  ) => React.CSSProperties;
}

export function MismatchResolver({
  mismatchInfo,
  merging,
  replacingLocal,
  replacingRemote,
  onMerge,
  onReplaceLocal,
  onReplaceRemote,
  onClearMismatch,
  buttonStyle,
}: MismatchResolverProps) {
  const { theme } = useTheme();
  const mismatchBusy = merging || replacingLocal || replacingRemote;

  return (
    <div
      style={{
        position: 'absolute',
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
          maxWidth: 340,
          width: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        <div
          style={{
            fontSize: theme.typography.sizes.md,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.text,
            marginBottom: theme.spacing.sm,
          }}
        >
          {mismatchInfo.canRestore ? 'Remote Vault Detected' : 'Incompatible Remote Vault'}
        </div>
        <div
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            marginBottom: theme.spacing.md,
          }}
        >
          {mismatchInfo.canRestore
            ? `The remote server has a vault with ${mismatchInfo.remoteItemCount} item${mismatchInfo.remoteItemCount === 1 ? '' : 's'} from a different device.`
            : 'The remote server has vault data encrypted with a different password.'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
          {mismatchInfo.canRestore && (
            <>
              <button
                onClick={onMerge}
                disabled={mismatchBusy}
                style={buttonStyle('primary', mismatchBusy)}
              >
                {merging ? 'Merging...' : 'Merge Vaults'}
              </button>
              <button
                onClick={onReplaceLocal}
                disabled={mismatchBusy}
                style={buttonStyle('secondary', mismatchBusy)}
              >
                {replacingLocal ? 'Replacing...' : 'Replace Local with Remote'}
              </button>
            </>
          )}
          <button
            onClick={onReplaceRemote}
            disabled={mismatchBusy}
            style={buttonStyle('danger', mismatchBusy)}
          >
            {replacingRemote ? 'Replacing...' : 'Replace Remote with Local'}
          </button>
          <button
            onClick={onClearMismatch}
            disabled={mismatchBusy}
            style={buttonStyle('secondary', mismatchBusy)}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
