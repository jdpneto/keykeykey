import React, { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import { isSyncProviderEnabled } from '@keykeykey/core/sync';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import { EyeIcon, EyeOffIcon } from '../components/icons/index.js';
import { getBrowserKind } from '../../lib/browser-detect.js';

interface SetupScreenProps {
  onComplete: (recoveryKey: string) => void;
  onNavigate?: (screen: string) => void;
}

export function SetupScreen({ onComplete, onNavigate }: SetupScreenProps) {
  const { theme } = useTheme();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [restoreProvider, setRestoreProvider] = useState<string | null>(null);

  useEffect(() => {
    // Check for last connected provider first (persisted across popup close)
    browser.storage.local.get('last_connected_provider').then((result) => {
      const data = result.last_connected_provider as
        | { provider: string; timestamp: string }
        | undefined;
      if (data?.provider && isSyncProviderEnabled(data.provider as never)) {
        setRestoreProvider(data.provider);
        return;
      }
      // Fallback: check for a cached Google token via chrome.identity.
      // This is a Chrome-only optimization — on Firefox there is no
      // "silent" getAuthToken, so we just skip and let the user pick a
      // provider explicitly on the restore screen.
      if (getBrowserKind() === 'chrome') {
        try {
          // Use the same browser.identity cast pattern as google-oauth.ts —
          // chrome.identity.getAuthToken isn't in the webextension-polyfill types.
          const identity = browser.identity as unknown as {
            getAuthToken?: (opts: { interactive: boolean }) => Promise<{ token?: string }>;
          };
          if (identity?.getAuthToken) {
            identity
              .getAuthToken({ interactive: false })
              .then((r) => {
                if (r?.token) setRestoreProvider('google-drive');
              })
              .catch(() => {});
          }
        } catch {
          // Not available
        }
      }
    });
  }, []);

  const validate = (): string | null => {
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (password !== confirm) return 'Passwords do not match.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = (await sendMessage<{ recoveryKey?: string; error?: string }>({
        type: 'SETUP',
        password,
      })) as { recoveryKey?: string; error?: string };
      if ('error' in result && result.error) {
        setError(result.error);
      } else if (result.recoveryKey) {
        onComplete(result.recoveryKey);
      }
    } catch {
      setError('Setup failed. Please try again.');
    } finally {
      setLoading(false);
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
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
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

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
        minHeight: '100%',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: theme.spacing.sm }}>
        <div
          style={{
            fontSize: 32,
            marginBottom: theme.spacing.sm,
          }}
        >
          &#128273;
        </div>
        <h1
          style={{
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
            margin: 0,
          }}
        >
          Create Your Vault
        </h1>
        <p
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            marginTop: theme.spacing.xs,
            margin: `${theme.spacing.xs}px 0 0 0`,
          }}
        >
          Set a master password to protect your credentials.
        </p>
      </div>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}
      >
        <div>
          <label htmlFor="setup-password" style={labelStyle}>
            Master Password
          </label>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              id="setup-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              style={{ ...inputStyle, flex: 1 }}
              autoFocus
            />
            <button
              onClick={() => setShowPassword(!showPassword)}
              style={eyeButtonStyle}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              type="button"
            >
              {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="setup-confirm" style={labelStyle}>
            Confirm Password
          </label>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              id="setup-confirm"
              type={showConfirm ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => setShowConfirm(!showConfirm)}
              style={eyeButtonStyle}
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
              type="button"
            >
              {showConfirm ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              color: theme.colors.error,
              fontSize: theme.typography.sizes.xs,
              padding: `${theme.spacing.sm}px`,
              background: theme.colors.inputBackground,
              borderRadius: theme.radii.sm,
              border: `1px solid ${theme.colors.error}`,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            background: theme.colors.primary,
            color: '#000',
            border: 'none',
            borderRadius: theme.radii.md,
            padding: `${theme.spacing.sm}px`,
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.semibold,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {loading ? 'Creating vault\u2026' : 'Create Vault'}
        </button>
      </form>

      {/* Restore options */}
      <div
        style={{
          marginTop: 'auto',
          textAlign: 'center',
          paddingTop: theme.spacing.md,
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.sm,
        }}
      >
        {restoreProvider && (
          <button
            type="button"
            onClick={() => onNavigate?.(`restore:${restoreProvider}`)}
            style={{
              background: theme.colors.surface,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.md,
              padding: `${theme.spacing.sm}px`,
              color: theme.colors.text,
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.medium,
              cursor: 'pointer',
            }}
          >
            Restore from{' '}
            {restoreProvider === 'google-drive'
              ? 'Google Drive'
              : restoreProvider === 'dropbox'
                ? 'Dropbox'
                : restoreProvider === 'onedrive'
                  ? 'OneDrive'
                  : restoreProvider}
          </button>
        )}
        <button
          type="button"
          onClick={() => onNavigate?.('restore')}
          style={{
            background: 'none',
            border: 'none',
            color: theme.colors.textSecondary,
            fontSize: theme.typography.sizes.xs,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          Restore from Cloud
        </button>
      </div>
    </div>
  );
}
