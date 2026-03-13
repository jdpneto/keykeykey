import { KeyRound, CreditCard, FileText, Star, ChevronRight } from 'lucide-react';
import { useTheme } from '../../lib/theme';
import type { VaultItem } from '@keykeykey/core';

type ItemCardProps = {
  item: VaultItem;
  onPress: () => void;
};

function getIcon(type: string) {
  switch (type) {
    case 'credential':
      return KeyRound;
    case 'card':
      return CreditCard;
    case 'secure-note':
      return FileText;
    default:
      return KeyRound;
  }
}

function getSubtitle(item: VaultItem): string {
  if (item.type === 'credential' && item.username) return item.username;
  if (item.type === 'card' && item.number) return `**** ${item.number.slice(-4)}`;
  if (item.type === 'secure-note') return 'Secure Note';
  return item.type;
}

export function ItemCard({ item, onPress }: ItemCardProps) {
  const { theme } = useTheme();
  const Icon = getIcon(item.type);

  return (
    <button
      onClick={onPress}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: 14,
        backgroundColor: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radii.md,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background-color 0.15s ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.colors.surfaceAlt)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.colors.surface)}
    >
      {/* Icon */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radii.sm,
          backgroundColor: theme.colors.primaryMuted,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={20} color={theme.colors.primary} />
      </div>

      {/* Name + subtitle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: theme.typography.sizes.md,
            fontWeight: theme.typography.weights.medium,
            color: theme.colors.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {item.name}
        </div>
        <div
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.textSecondary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {getSubtitle(item)}
        </div>
      </div>

      {/* Favorite */}
      {item.favorite && <Star size={16} color={theme.colors.warning} fill={theme.colors.warning} />}

      <ChevronRight size={16} color={theme.colors.textSecondary} />
    </button>
  );
}
