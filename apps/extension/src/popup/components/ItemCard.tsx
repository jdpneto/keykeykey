import React from 'react';
import { useTheme } from '../../lib/theme.js';
import type { VaultItem } from '@keykeykey/core';

interface ItemCardProps {
  item: VaultItem;
  onClick: () => void;
  onFill?: () => void;
}

export function ItemCard({ item, onClick, onFill }: ItemCardProps) {
  const { theme } = useTheme();
  const initial = item.name.charAt(0).toUpperCase();
  const subtitle =
    item.type === 'credential'
      ? item.username
      : item.type === 'card'
        ? '•••• ' + (item.number?.slice(-4) ?? '')
        : 'Note';

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        background: theme.colors.surface,
        borderRadius: theme.radii.md,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: theme.radii.sm,
          background: theme.colors.primaryMuted,
          color: theme.colors.primary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: theme.typography.weights.semibold,
          fontSize: theme.typography.sizes.sm,
        }}
      >
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.medium,
            color: theme.colors.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </div>
        <div
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {subtitle}
        </div>
      </div>
      {item.type === 'credential' && item.totp && (
        <span
          style={{ color: theme.colors.primary, fontSize: 12 }}
          title="Has two-factor code"
          aria-label="Has two-factor code"
        >
          &#128274;&#8288;2FA
        </span>
      )}
      {item.favorite && <span style={{ color: theme.colors.primary, fontSize: 14 }}>&#9733;</span>}
      {onFill && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFill();
          }}
          aria-label="Fill credentials"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            borderRadius: theme.radii.sm,
            color: theme.colors.primary,
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          &#8626;
        </button>
      )}
      <span style={{ color: theme.colors.textSecondary, fontSize: 14 }}>&#8250;</span>
    </div>
  );
}
