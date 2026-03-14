import React, { useState } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import { PinPad } from '../components/PinPad.js';

interface UnlockScreenProps {
  hasPIN: boolean;
  onUnlock: () => void;
}

export function UnlockScreen({ hasPIN, onUnlock }: UnlockScreenProps) {
  const { theme } = useTheme();
  const [usePIN, setUsePIN] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePasswordUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setError('');
    setLoading(true);
    try {
      const result = (await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'UNLOCK',
        password,
      })) as { ok?: boolean; error?: string };
      if ('error' in result && result.error) {
        setError(result.error);
      } else {
        onUnlock();
      }
    } catch {
      setError('Unlock failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePINSubmit = async (pin: string) => {
    setError('');
    setLoading(true);
    try {
      const result = (await sendMessage<{
        ok?: boolean;
        error?: string;
        attemptsRemaining?: number;
      }>({
        type: 'UNLOCK_PIN',
        pin,
      })) as { ok?: boolean; error?: string; attemptsRemaining?: number };
      if ('error' in result && result.error) {
        setError(result.error);
        if (typeof result.attemptsRemaining === 'number') {
          setAttemptsRemaining(result.attemptsRemaining);
        }
      } else {
        onUnlock();
      }
    } catch {
      setError('PIN unlock failed. Please try again.');
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
        <div style={{ fontSize: 32, marginBottom: theme.spacing.sm }}>&#128274;</div>
        <h1
          style={{
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
            margin: 0,
          }}
        >
          Unlock Vault
        </h1>
        <p
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            marginTop: theme.spacing.xs,
            margin: `${theme.spacing.xs}px 0 0 0`,
          }}
        >
          {usePIN ? 'Enter your PIN to unlock.' : 'Enter your master password to unlock.'}
        </p>
      </div>

      {usePIN ? (
        <div>
          <PinPad
            onSubmit={handlePINSubmit}
            error={
              error
                ? attemptsRemaining !== null
                  ? `${error} (${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining)`
                  : error
                : undefined
            }
          />
          {loading && (
            <div
              style={{
                textAlign: 'center',
                color: theme.colors.textSecondary,
                fontSize: theme.typography.sizes.xs,
                marginTop: theme.spacing.sm,
              }}
            >
              Verifying\u2026
            </div>
          )}
        </div>
      ) : (
        <form
          onSubmit={handlePasswordUnlock}
          style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Master password"
            style={inputStyle}
            autoFocus
          />

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
            disabled={loading || !password.trim()}
            style={{
              background: theme.colors.primary,
              color: '#000',
              border: 'none',
              borderRadius: theme.radii.md,
              padding: `${theme.spacing.sm}px`,
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.semibold,
              cursor: loading || !password.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !password.trim() ? 0.7 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {loading ? 'Unlocking\u2026' : 'Unlock'}
          </button>
        </form>
      )}

      {/* Toggle between PIN and password */}
      {hasPIN && (
        <div style={{ textAlign: 'center', marginTop: 'auto', paddingTop: theme.spacing.sm }}>
          <button
            type="button"
            onClick={() => {
              setUsePIN(!usePIN);
              setError('');
              setAttemptsRemaining(null);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: theme.colors.textSecondary,
              fontSize: theme.typography.sizes.xs,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {usePIN ? 'Use master password instead' : 'Use PIN instead'}
          </button>
        </div>
      )}
    </div>
  );
}
