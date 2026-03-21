import React, { useEffect, useState } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import type { Settings, SyncStatus } from '../../lib/messages.js';
import type { AutoLockMode } from '../../lib/messages.js';

interface SettingsScreenProps {
  onBack: () => void;
  onRefresh: () => void;
  onNavigate?: (screen: string) => void;
}

const THEME_OPTIONS = [
  { value: 'system', label: 'System default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

const AUTO_LOCK_MODES: { value: AutoLockMode; label: string }[] = [
  { value: 'timed', label: 'After timeout' },
  { value: 'browser_close', label: 'On browser close' },
  { value: 'never', label: 'Never' },
];

const AUTO_LOCK_MINUTES = [5, 15, 30, 60] as const;

export function SettingsScreen({ onBack, onRefresh, onNavigate }: SettingsScreenProps) {
  const { theme, mode: themeMode, setMode } = useTheme();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // PIN state
  const [hasPIN, setHasPIN] = useState(false);
  const [pinEntry, setPinEntry] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [showPinForm, setShowPinForm] = useState(false);
  const [pinError, setPinError] = useState('');

  const [locking, setLocking] = useState(false);
  const [error, setError] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [settingsResult, syncResult, statusResult] = await Promise.all([
          sendMessage<Settings>({ type: 'GET_SETTINGS' }),
          sendMessage<SyncStatus>({ type: 'GET_SYNC_STATUS' }),
          sendMessage<{ status: string; hasPIN: boolean }>({ type: 'GET_STATUS' }),
        ]);
        const s = settingsResult as Settings & { error?: string };
        const sync = syncResult as SyncStatus & { error?: string };
        const st = statusResult as { hasPIN?: boolean; error?: string };
        if (!s.error) {
          setSettings(s);
          if (s.autoLockMode) {
            // settings loaded
          }
        }
        if (!sync.error) {
          setSyncStatus(sync);
        }
        if (!st.error && st.hasPIN !== undefined) {
          setHasPIN(st.hasPIN);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const updateSetting = async (updates: Partial<Settings>) => {
    setError('');
    try {
      await sendMessage({ type: 'UPDATE_SETTINGS', settings: updates });
      setSettings((prev) => (prev ? { ...prev, ...updates } : prev));
    } catch {
      setError('Failed to update settings.');
    }
  };

  const handleSetPin = async () => {
    setPinError('');
    if (pinEntry.length < 4) {
      setPinError('PIN must be at least 4 digits.');
      return;
    }
    if (pinEntry !== pinConfirm) {
      setPinError('PINs do not match.');
      return;
    }
    try {
      const result = (await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'SET_PIN',
        pin: pinEntry,
      })) as { ok?: boolean; error?: string };
      if (result?.error) {
        setPinError(result.error);
        return;
      }
      setHasPIN(true);
      setShowPinForm(false);
      setPinEntry('');
      setPinConfirm('');
    } catch {
      setPinError('Failed to set PIN.');
    }
  };

  const handleRemovePin = async () => {
    try {
      await sendMessage({ type: 'REMOVE_PIN' });
      setHasPIN(false);
    } catch {
      setError('Failed to remove PIN.');
    }
  };

  const handleLock = async () => {
    setLocking(true);
    try {
      await sendMessage({ type: 'LOCK' });
      onRefresh();
    } finally {
      setLocking(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    background: theme.colors.inputBackground,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    color: theme.colors.text,
    fontSize: theme.typography.sizes.sm,
    outline: 'none',
    boxSizing: 'border-box' as const,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textSecondary,
    fontWeight: theme.typography.weights.medium,
    marginBottom: 4,
    display: 'block',
  };

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.md,
  };

  const sectionStyle: React.CSSProperties = {
    background: theme.colors.surface,
    borderRadius: theme.radii.md,
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    marginBottom: theme.spacing.sm,
  };

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '480px',
          color: theme.colors.textSecondary,
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '480px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: theme.colors.textSecondary,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.md,
            padding: theme.spacing.xs,
            borderRadius: theme.radii.sm,
          }}
          aria-label="Back"
        >
          &#8592;
        </button>
        <div
          style={{
            flex: 1,
            fontWeight: theme.typography.weights.bold,
            fontSize: theme.typography.sizes.md,
            color: theme.colors.text,
          }}
        >
          Settings
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: `0 ${theme.spacing.md}px` }}>
        {error && (
          <div
            style={{
              padding: theme.spacing.sm,
              background: theme.colors.errorLight,
              border: `1px solid ${theme.colors.error}`,
              borderRadius: theme.radii.md,
              color: theme.colors.error,
              fontSize: theme.typography.sizes.sm,
              marginTop: theme.spacing.sm,
            }}
          >
            {error}
          </div>
        )}

        {/* Cloud Sync section */}
        <div style={sectionHeaderStyle}>Cloud Sync</div>
        <div
          onClick={() => onNavigate?.('sync-settings')}
          style={{
            ...sectionStyle,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.text,
                fontWeight: theme.typography.weights.medium,
              }}
            >
              Cloud Sync
            </div>
            <div
              style={{
                fontSize: theme.typography.sizes.xs,
                color: theme.colors.textSecondary,
                marginTop: 2,
              }}
            >
              {syncStatus?.provider && syncStatus.provider !== 'none'
                ? `Connected via ${syncStatus.provider === 'webdav' ? 'WebDAV' : syncStatus.provider}`
                : 'Not configured'}
            </div>
          </div>
          <span
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.typography.sizes.md,
            }}
          >
            &#8250;
          </span>
        </div>

        {/* Auto-lock section */}
        <div style={sectionHeaderStyle}>Auto-Lock</div>
        <div style={sectionStyle}>
          <div style={{ marginBottom: theme.spacing.sm }}>
            <label style={labelStyle}>Lock when</label>
            <select
              value={settings?.autoLockMode ?? 'timed'}
              onChange={(e) => updateSetting({ autoLockMode: e.target.value as AutoLockMode })}
              style={inputStyle}
            >
              {AUTO_LOCK_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          {settings?.autoLockMode === 'timed' && (
            <div>
              <label style={labelStyle}>Timeout</label>
              <select
                value={settings?.autoLockMinutes ?? 15}
                onChange={(e) => updateSetting({ autoLockMinutes: Number(e.target.value) })}
                style={inputStyle}
              >
                {AUTO_LOCK_MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Appearance section */}
        <div style={sectionHeaderStyle}>Appearance</div>
        <div style={sectionStyle}>
          <label style={labelStyle}>Theme</label>
          <div style={{ display: 'flex', gap: theme.spacing.sm }}>
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  const newMode = opt.value;
                  setMode(newMode);
                  try {
                    localStorage.setItem('keykeykey-theme-mode', newMode);
                  } catch {
                    // localStorage may not be available in all contexts
                  }
                  updateSetting({ themeMode: newMode });
                }}
                style={{
                  flex: 1,
                  padding: `${theme.spacing.xs}px`,
                  borderRadius: theme.radii.md,
                  border: `1px solid ${themeMode === opt.value ? theme.colors.primary : theme.colors.border}`,
                  background: themeMode === opt.value ? theme.colors.primary : 'none',
                  color: themeMode === opt.value ? '#000' : theme.colors.textSecondary,
                  cursor: 'pointer',
                  fontSize: theme.typography.sizes.xs,
                  fontWeight:
                    themeMode === opt.value
                      ? theme.typography.weights.semibold
                      : theme.typography.weights.regular,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Security section */}
        <div style={sectionHeaderStyle}>Security</div>
        <div style={sectionStyle}>
          {showPinForm ? (
            <>
              <div style={{ marginBottom: theme.spacing.sm }}>
                <label style={labelStyle}>New PIN</label>
                <input
                  type="password"
                  value={pinEntry}
                  onChange={(e) => setPinEntry(e.target.value)}
                  placeholder="Enter PIN"
                  inputMode="numeric"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: theme.spacing.sm }}>
                <label style={labelStyle}>Confirm PIN</label>
                <input
                  type="password"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value)}
                  placeholder="Confirm PIN"
                  inputMode="numeric"
                  style={inputStyle}
                />
              </div>
              {pinError && (
                <div
                  style={{
                    color: theme.colors.error,
                    fontSize: theme.typography.sizes.xs,
                    marginBottom: theme.spacing.sm,
                  }}
                >
                  {pinError}
                </div>
              )}
              <div style={{ display: 'flex', gap: theme.spacing.sm }}>
                <button
                  onClick={() => {
                    setShowPinForm(false);
                    setPinEntry('');
                    setPinConfirm('');
                    setPinError('');
                  }}
                  style={{
                    flex: 1,
                    padding: `${theme.spacing.xs}px`,
                    background: 'none',
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: theme.radii.md,
                    color: theme.colors.text,
                    cursor: 'pointer',
                    fontSize: theme.typography.sizes.sm,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSetPin}
                  style={{
                    flex: 1,
                    padding: `${theme.spacing.xs}px`,
                    background: theme.colors.primary,
                    border: 'none',
                    borderRadius: theme.radii.md,
                    color: '#000',
                    cursor: 'pointer',
                    fontSize: theme.typography.sizes.sm,
                    fontWeight: theme.typography.weights.semibold,
                  }}
                >
                  Set PIN
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: theme.spacing.sm }}>
              <button
                onClick={() => setShowPinForm(true)}
                style={{
                  flex: 1,
                  padding: `${theme.spacing.xs}px`,
                  background: 'none',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radii.md,
                  color: theme.colors.text,
                  cursor: 'pointer',
                  fontSize: theme.typography.sizes.sm,
                }}
              >
                {hasPIN ? 'Change PIN' : 'Set PIN'}
              </button>
              {hasPIN && (
                <button
                  onClick={handleRemovePin}
                  style={{
                    flex: 1,
                    padding: `${theme.spacing.xs}px`,
                    background: 'none',
                    border: `1px solid ${theme.colors.danger}`,
                    borderRadius: theme.radii.md,
                    color: theme.colors.danger,
                    cursor: 'pointer',
                    fontSize: theme.typography.sizes.sm,
                  }}
                >
                  Remove PIN
                </button>
              )}
            </div>
          )}
        </div>

        {/* About section */}
        <div style={sectionHeaderStyle}>About</div>
        <div style={sectionStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.text }}>
              KeyKeyKey
            </span>
            <span
              style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary }}
            >
              v0.0.1
            </span>
          </div>
        </div>

        {/* Danger Zone */}
        <div style={sectionHeaderStyle}>Danger Zone</div>
        <div
          style={{
            ...sectionStyle,
            border: `1px solid ${theme.colors.danger}`,
          }}
        >
          <div
            style={{
              fontSize: theme.typography.sizes.xs,
              color: theme.colors.textSecondary,
              marginBottom: theme.spacing.sm,
            }}
          >
            Permanently delete all vault data including credentials, cards, and notes. This action
            cannot be undone.
          </div>
          {showResetConfirm ? (
            <div>
              <p
                style={{
                  fontSize: theme.typography.sizes.xs,
                  color: theme.colors.danger,
                  margin: `0 0 ${theme.spacing.sm}px 0`,
                  fontWeight: theme.typography.weights.semibold,
                }}
              >
                Are you sure? All data will be permanently lost.
              </p>
              <div style={{ display: 'flex', gap: theme.spacing.sm }}>
                <button
                  onClick={() => setShowResetConfirm(false)}
                  style={{
                    flex: 1,
                    padding: `${theme.spacing.xs}px`,
                    background: 'none',
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: theme.radii.md,
                    color: theme.colors.text,
                    cursor: 'pointer',
                    fontSize: theme.typography.sizes.sm,
                  }}
                >
                  Cancel
                </button>
                <button
                  disabled={resetting}
                  onClick={async () => {
                    setResetting(true);
                    try {
                      await sendMessage({ type: 'RESET_VAULT' });
                      onRefresh();
                    } catch {
                      setError('Failed to reset vault.');
                    } finally {
                      setResetting(false);
                      setShowResetConfirm(false);
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: `${theme.spacing.xs}px`,
                    background: theme.colors.danger,
                    border: 'none',
                    borderRadius: theme.radii.md,
                    color: '#fff',
                    cursor: resetting ? 'not-allowed' : 'pointer',
                    fontSize: theme.typography.sizes.sm,
                    fontWeight: theme.typography.weights.semibold,
                    opacity: resetting ? 0.7 : 1,
                  }}
                >
                  {resetting ? 'Resetting\u2026' : 'Yes, Reset Vault'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowResetConfirm(true)}
              style={{
                width: '100%',
                padding: `${theme.spacing.xs}px`,
                background: 'none',
                border: `1px solid ${theme.colors.danger}`,
                borderRadius: theme.radii.md,
                color: theme.colors.danger,
                cursor: 'pointer',
                fontSize: theme.typography.sizes.sm,
                fontWeight: theme.typography.weights.semibold,
              }}
            >
              Reset Vault
            </button>
          )}
        </div>

        {/* Lock vault button */}
        <div style={{ padding: `${theme.spacing.md}px 0` }}>
          <button
            onClick={handleLock}
            disabled={locking}
            style={{
              width: '100%',
              padding: `${theme.spacing.sm}px`,
              background: theme.colors.danger,
              border: 'none',
              borderRadius: theme.radii.md,
              color: '#fff',
              cursor: 'pointer',
              fontWeight: theme.typography.weights.semibold,
              fontSize: theme.typography.sizes.sm,
              opacity: locking ? 0.7 : 1,
            }}
          >
            {locking ? 'Locking…' : 'Lock Vault'}
          </button>
        </div>
      </div>
    </div>
  );
}
