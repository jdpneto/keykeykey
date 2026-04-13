import React, { useEffect, useState } from 'react';
import { useTheme } from '../../../lib/theme.js';
import { sendMessage } from '../../hooks/useMessage.js';
import type { Settings, SyncStatus } from '../../../lib/messages.js';
import { UploadIcon, DownloadIcon } from '../../components/icons/index.js';
import { AutoLockSettings } from './AutoLockSettings.js';
import { PinSettings } from './PinSettings.js';
import { DangerZone } from './DangerZone.js';

const THEME_OPTIONS = [
  { value: 'system', label: 'System default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

interface SettingsScreenProps {
  onBack: () => void;
  onRefresh: () => void;
  onNavigate?: (screen: string) => void;
}

export function SettingsScreen({ onBack, onRefresh, onNavigate }: SettingsScreenProps) {
  const { theme, mode: themeMode, setMode } = useTheme();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPIN, setHasPIN] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [settingsResult, syncResult, statusResult] = await Promise.all([
          sendMessage<Settings>({ type: 'GET_SETTINGS' }),
          sendMessage<SyncStatus>({ type: 'GET_SYNC_STATUS' }),
          sendMessage<{ status: string; hasPIN: boolean }>({ type: 'GET_STATUS' }),
        ]);
        const raw = settingsResult as { settings?: Settings; error?: string } & Settings;
        const s: Settings & { error?: string } = raw.settings
          ? { ...raw.settings, error: raw.error }
          : (raw as Settings & { error?: string });
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

  const eyeButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: theme.colors.textSecondary,
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
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
          minHeight: '600px',
          color: theme.colors.textSecondary,
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
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

        {/* Import / Export rows */}
        <div
          onClick={() => onNavigate?.('import')}
          style={{
            ...sectionStyle,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: theme.spacing.sm,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <UploadIcon size={16} color={theme.colors.textSecondary} />
            <div
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.text,
                fontWeight: theme.typography.weights.medium,
              }}
            >
              Import Passwords
            </div>
          </div>
          <span style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.md }}>
            &#8250;
          </span>
        </div>
        <div
          onClick={() => onNavigate?.('export')}
          style={{
            ...sectionStyle,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: theme.spacing.sm,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <DownloadIcon size={16} color={theme.colors.textSecondary} />
            <div
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.text,
                fontWeight: theme.typography.weights.medium,
              }}
            >
              Export Vault
            </div>
          </div>
          <span style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.md }}>
            &#8250;
          </span>
        </div>

        {/* Auto-lock */}
        <AutoLockSettings
          settings={settings}
          onUpdateSetting={updateSetting}
          inputStyle={inputStyle}
          labelStyle={labelStyle}
          sectionStyle={sectionStyle}
          sectionHeaderStyle={sectionHeaderStyle}
        />

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

        {/* PIN / Security */}
        <PinSettings
          hasPIN={hasPIN}
          onPinChanged={setHasPIN}
          onError={setError}
          inputStyle={inputStyle}
          labelStyle={labelStyle}
          eyeButtonStyle={eyeButtonStyle}
          sectionStyle={sectionStyle}
          sectionHeaderStyle={sectionHeaderStyle}
        />

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
        <DangerZone
          onRefresh={onRefresh}
          onError={setError}
          sectionStyle={sectionStyle}
          sectionHeaderStyle={sectionHeaderStyle}
        />

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
