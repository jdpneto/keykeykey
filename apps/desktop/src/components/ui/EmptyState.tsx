import type { LucideIcon } from 'lucide-react';
import { useTheme } from '../../lib/theme';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
};

export function EmptyState({ icon: Icon, title, subtitle }: EmptyStateProps) {
  const { theme } = useTheme();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          backgroundColor: theme.colors.primaryMuted,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Icon size={36} color={theme.colors.primary} />
      </div>
      <h3
        style={{
          fontSize: theme.typography.sizes.lg,
          fontWeight: theme.typography.weights.semibold,
          color: theme.colors.text,
          marginBottom: 4,
        }}
      >
        {title}
      </h3>
      {subtitle && (
        <p style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
