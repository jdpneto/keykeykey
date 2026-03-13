import { Lock, Sun, Moon, Monitor, Cloud, Download, Info } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useVault } from '../lib/vault-context';
import { useNavigate } from 'react-router-dom';

type SettingRowProps = {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  onClick?: () => void;
  disabled?: boolean;
  right?: React.ReactNode;
};

function SettingRow({ icon, label, subtitle, onClick, disabled, right }: SettingRowProps) {
  const { theme } = useTheme();

  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        padding: '14px 0',
        background: 'none',
        border: 'none',
        borderBottom: `1px solid ${theme.colors.border}`,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
      }}
    >
      <div style={{ color: theme.colors.textSecondary, display: 'flex' }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.text,
            fontWeight: theme.typography.weights.medium,
          }}
        >
          {label}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: theme.typography.sizes.xs,
              color: theme.colors.textSecondary,
              marginTop: 2,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {right}
    </button>
  );
}

export function SettingsScreen() {
  const { theme, mode, setMode } = useTheme();
  const { lock } = useVault();
  const navigate = useNavigate();

  const handleLock = () => {
    if (window.confirm('Lock your vault? You will need to enter your master password to unlock.')) {
      lock();
      navigate('/unlock', { replace: true });
    }
  };

  const themeIcon =
    mode === 'dark' ? (
      <Moon size={18} />
    ) : mode === 'light' ? (
      <Sun size={18} />
    ) : (
      <Monitor size={18} />
    );

  const cycleTheme = () => {
    const modes: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark'];
    const idx = modes.indexOf(mode);
    setMode(modes[(idx + 1) % modes.length]!);
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <h1
        style={{
          fontSize: theme.typography.sizes.xl,
          fontWeight: theme.typography.weights.bold,
          color: theme.colors.text,
          marginBottom: 24,
        }}
      >
        Settings
      </h1>

      {/* Security */}
      <div style={{ marginBottom: 32 }}>
        <h2
          style={{
            fontSize: theme.typography.sizes.xs,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 8,
          }}
        >
          Security
        </h2>
        <SettingRow icon={<Lock size={18} />} label="Lock Vault Now" onClick={handleLock} />
        <SettingRow
          icon={themeIcon}
          label="Theme"
          subtitle={`Currently: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`}
          onClick={cycleTheme}
          right={
            <span
              style={{
                fontSize: theme.typography.sizes.xs,
                color: theme.colors.textSecondary,
                textTransform: 'capitalize',
              }}
            >
              {mode}
            </span>
          }
        />
        <SettingRow
          icon={<Lock size={18} />}
          label="Auto-Lock Timeout"
          subtitle="5 minutes"
          disabled
        />
      </div>

      {/* Sync */}
      <div style={{ marginBottom: 32 }}>
        <h2
          style={{
            fontSize: theme.typography.sizes.xs,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 8,
          }}
        >
          Sync
        </h2>
        <SettingRow icon={<Cloud size={18} />} label="Cloud Sync" subtitle="Coming soon" disabled />
        <SettingRow
          icon={<Download size={18} />}
          label="Export Vault"
          subtitle="Coming soon"
          disabled
        />
      </div>

      {/* About */}
      <div>
        <h2
          style={{
            fontSize: theme.typography.sizes.xs,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 8,
          }}
        >
          About
        </h2>
        <SettingRow icon={<Info size={18} />} label="Version" subtitle="0.0.1" disabled />
      </div>
    </div>
  );
}
