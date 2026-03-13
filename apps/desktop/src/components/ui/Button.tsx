import React from 'react';
import { useTheme } from '../../lib/theme';

type ButtonProps = {
  onPress: () => void;
  title: string;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
};

export function Button({
  onPress,
  title,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const { theme } = useTheme();

  const getStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '14px 24px',
      minHeight: 50,
      borderRadius: theme.radii.md,
      border: 'none',
      cursor: disabled || loading ? 'not-allowed' : 'pointer',
      opacity: disabled || loading ? 0.6 : 1,
      fontSize: theme.typography.sizes.md,
      fontWeight: theme.typography.weights.semibold,
      transition: 'opacity 0.15s ease, transform 0.1s ease',
      width: '100%',
    };

    switch (variant) {
      case 'primary':
        return { ...base, backgroundColor: theme.colors.primary, color: '#000000' };
      case 'secondary':
        return {
          ...base,
          backgroundColor: 'transparent',
          color: theme.colors.text,
          border: `1.5px solid ${theme.colors.border}`,
        };
      case 'danger':
        return { ...base, backgroundColor: theme.colors.danger, color: '#ffffff' };
      default:
        return base;
    }
  };

  return (
    <button onClick={onPress} disabled={disabled || loading} style={{ ...getStyles(), ...style }}>
      {loading ? (
        <div
          style={{
            width: 20,
            height: 20,
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      ) : (
        title
      )}
      {loading && <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>}
    </button>
  );
}
