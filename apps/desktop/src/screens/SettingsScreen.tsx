import {
  Lock,
  Sun,
  Moon,
  Monitor,
  Cloud,
  Download,
  Info,
  KeyRound,
  AlertTriangle,
} from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '../lib/theme';
import { useVault } from '../lib/vault-context';
import { useNavigate } from 'react-router-dom';
import { validatePin } from '@keykeykey/core/pin';
import { ResetVaultDialog } from '../components/ResetVaultDialog';

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
  const { lock, pinConfigured, enablePin, disablePin, resetVault } = useVault();
  const navigate = useNavigate();

  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

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

  const handlePinToggle = () => {
    if (pinConfigured) {
      if (window.confirm('Disable PIN unlock? You will need your master password to unlock.')) {
        disablePin().catch(() => {
          window.alert('Failed to disable PIN unlock.');
        });
      }
    } else {
      setPinValue('');
      setPinConfirm('');
      setPinError('');
      setShowPinSetup(true);
    }
  };

  const handlePinSave = async () => {
    setPinError('');
    const validation = validatePin(pinValue);
    if (!validation.valid) {
      setPinError(validation.error ?? 'Invalid PIN.');
      return;
    }
    if (pinValue !== pinConfirm) {
      setPinError('PINs do not match.');
      return;
    }
    setPinLoading(true);
    try {
      await enablePin(pinValue);
      setShowPinSetup(false);
    } catch {
      setPinError('Failed to set up PIN. Please try again.');
    } finally {
      setPinLoading(false);
    }
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

        {/* PIN Unlock row */}
        <SettingRow
          icon={<KeyRound size={18} />}
          label="PIN Unlock"
          subtitle={pinConfigured ? 'Enabled — click to disable' : 'Set a PIN for quick unlock'}
          onClick={handlePinToggle}
          right={
            <span
              style={{
                fontSize: theme.typography.sizes.xs,
                color: pinConfigured ? theme.colors.primary : theme.colors.textSecondary,
                fontWeight: theme.typography.weights.medium,
              }}
            >
              {pinConfigured ? 'On' : 'Off'}
            </span>
          }
        />

        {/* Inline PIN setup form */}
        {showPinSetup && (
          <div
            style={{
              padding: 16,
              background: theme.colors.surface,
              borderRadius: 8,
              border: `1px solid ${theme.colors.border}`,
              marginTop: 8,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontSize: theme.typography.sizes.sm,
                fontWeight: theme.typography.weights.semibold,
                color: theme.colors.text,
                marginBottom: 4,
              }}
            >
              Set Up PIN Unlock
            </div>
            <div
              style={{
                fontSize: theme.typography.sizes.xs,
                color: theme.colors.textSecondary,
                marginBottom: 12,
              }}
            >
              Choose a 4–8 digit PIN. Avoid simple patterns like 1234 or 0000.
            </div>

            {pinError && (
              <div
                style={{
                  fontSize: theme.typography.sizes.xs,
                  color: theme.colors.error,
                  marginBottom: 8,
                }}
              >
                {pinError}
              </div>
            )}

            <div style={{ marginBottom: 10 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: theme.typography.sizes.xs,
                  color: theme.colors.textSecondary,
                  marginBottom: 4,
                  fontWeight: theme.typography.weights.medium,
                }}
              >
                PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pinValue}
                onChange={(e) => {
                  setPinValue(e.target.value);
                  setPinError('');
                }}
                placeholder="Enter PIN"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: theme.typography.sizes.sm,
                  color: theme.colors.text,
                  background: theme.colors.inputBackground,
                  border: `1px solid ${pinError ? theme.colors.error : theme.colors.border}`,
                  borderRadius: 6,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: theme.typography.sizes.xs,
                  color: theme.colors.textSecondary,
                  marginBottom: 4,
                  fontWeight: theme.typography.weights.medium,
                }}
              >
                Confirm PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pinConfirm}
                onChange={(e) => {
                  setPinConfirm(e.target.value);
                  setPinError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handlePinSave();
                }}
                placeholder="Re-enter PIN"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: theme.typography.sizes.sm,
                  color: theme.colors.text,
                  background: theme.colors.inputBackground,
                  border: `1px solid ${pinError ? theme.colors.error : theme.colors.border}`,
                  borderRadius: 6,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handlePinSave}
                disabled={pinLoading || !pinValue || !pinConfirm}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  fontSize: theme.typography.sizes.sm,
                  fontWeight: theme.typography.weights.semibold,
                  color: '#1a2e05',
                  background: theme.colors.primary,
                  border: 'none',
                  borderRadius: 6,
                  cursor: pinLoading || !pinValue || !pinConfirm ? 'not-allowed' : 'pointer',
                  opacity: pinLoading || !pinValue || !pinConfirm ? 0.5 : 1,
                }}
              >
                {pinLoading ? 'Saving…' : 'Enable PIN'}
              </button>
              <button
                onClick={() => setShowPinSetup(false)}
                disabled={pinLoading}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  fontSize: theme.typography.sizes.sm,
                  fontWeight: theme.typography.weights.medium,
                  color: theme.colors.text,
                  background: theme.colors.surfaceAlt,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

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
          About
        </h2>
        <SettingRow icon={<Info size={18} />} label="Version" subtitle="0.0.1" disabled />
      </div>

      {/* Danger Zone */}
      <div
        style={{
          border: `1px solid ${theme.colors.error}`,
          borderRadius: 8,
          padding: 16,
        }}
      >
        <h2
          style={{
            fontSize: theme.typography.sizes.xs,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.error,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 8,
          }}
        >
          Danger Zone
        </h2>
        <SettingRow
          icon={<AlertTriangle size={18} />}
          label="Reset Vault"
          subtitle="Permanently delete all vault data from this device"
          onClick={() => setShowResetConfirm(true)}
        />
      </div>

      <ResetVaultDialog
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={() => resetVault()}
      />
    </div>
  );
}
