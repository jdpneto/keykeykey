import { useTheme } from '../../lib/theme';

type ToggleSwitchProps = {
  value: boolean;
  onToggle: (value: boolean) => void;
  label?: string;
};

export function ToggleSwitch({ value, onToggle, label }: ToggleSwitchProps) {
  const { theme } = useTheme();

  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onToggle(!value)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <div
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          backgroundColor: value ? theme.colors.primary : theme.colors.border,
          position: 'relative',
          transition: 'background-color 0.2s ease',
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            position: 'absolute',
            top: 2,
            left: value ? 22 : 2,
            transition: 'left 0.2s ease',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        />
      </div>
      {label && (
        <span style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.text }}>
          {label}
        </span>
      )}
    </button>
  );
}
