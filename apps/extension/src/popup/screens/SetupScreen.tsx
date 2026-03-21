import React, { useState } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';

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
          <input
            id="setup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            style={inputStyle}
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="setup-confirm" style={labelStyle}>
            Confirm Password
          </label>
          <input
            id="setup-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your password"
            style={inputStyle}
          />
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

      {/* Restore link */}
      <div style={{ marginTop: 'auto', textAlign: 'center', paddingTop: theme.spacing.md }}>
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
