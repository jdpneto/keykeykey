import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';

export function UnlockScreen() {
  const { theme } = useTheme();
  const { unlock, unlockWithPin, pinConfigured, biometricAvailable, unlockWithBiometric, resetVault } =
    useVault();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'biometric' | 'pin' | 'password'>('password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Auto-detect highest-priority unlock mode on mount
  useEffect(() => {
    if (biometricAvailable) {
      setMode('biometric');
    } else if (pinConfigured) {
      setMode('pin');
    } else {
      setMode('password');
    }
  }, [biometricAvailable, pinConfigured]);

  const handleBiometricUnlock = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const result = await unlockWithBiometric();
      if (result.status === 'success') {
        navigate('/vault', { replace: true });
      } else if (result.status === 'cancelled') {
        // User cancelled — stay in biometric mode, no error
      } else if (result.status === 'invalidated') {
        setError('Biometric data has expired. Please use your PIN or master password.');
        setMode(pinConfigured ? 'pin' : 'password');
      } else {
        setError(result.message ?? 'Biometric unlock failed. Please try another method.');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [unlockWithBiometric, navigate, pinConfigured]);

  // Auto-trigger biometric unlock when mode is 'biometric'
  useEffect(() => {
    if (mode === 'biometric') {
      handleBiometricUnlock();
    }
  }, [mode]);

  const handlePasswordUnlock = async () => {
    if (!password) return;
    setError('');
    setLoading(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      await unlock(password);
      navigate('/vault', { replace: true });
    } catch {
      setError('Incorrect master password');
    } finally {
      setLoading(false);
    }
  };

  const handlePinUnlock = async () => {
    if (!pin) return;
    setError('');
    setLoading(true);
    try {
      const result = await unlockWithPin(pin);
      if (result.success) {
        navigate('/vault', { replace: true });
      } else if (result.attemptsRemaining === 0) {
        setError('Too many incorrect attempts. PIN has been removed. Use your master password.');
        setMode('password');
        setPin('');
      } else if (result.attemptsRemaining !== null) {
        setError(
          `Incorrect PIN. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} remaining.`,
        );
        setPin('');
      } else {
        setError('PIN is not configured. Use your master password.');
        setMode('password');
        setPin('');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const subtitle =
    mode === 'biometric'
      ? 'Use Touch ID to unlock your vault.'
      : mode === 'pin'
        ? 'Enter your PIN to unlock your vault.'
        : 'Enter your master password to unlock your vault.';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: theme.colors.background,
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: theme.colors.primaryMuted,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Lock size={32} color={theme.colors.primary} />
          </div>
        </div>

        <h1
          style={{
            fontSize: theme.typography.sizes['2xl'],
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
            textAlign: 'center',
            marginBottom: 8,
          }}
        >
          Welcome Back
        </h1>
        <p
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            marginBottom: 32,
          }}
        >
          {subtitle}
        </p>

        {mode === 'biometric' ? (
          <>
            {error ? (
              <p
                style={{
                  fontSize: theme.typography.sizes.sm,
                  color: theme.colors.error,
                  textAlign: 'center',
                  marginBottom: 16,
                }}
              >
                {error}
              </p>
            ) : null}

            <Button
              title="Use Biometrics"
              onPress={handleBiometricUnlock}
              loading={loading}
              style={{ marginTop: 8 }}
            />

            {pinConfigured && (
              <Button
                title="Use PIN"
                onPress={() => {
                  setMode('pin');
                  setError('');
                }}
                variant="secondary"
                style={{ marginTop: 8 }}
              />
            )}

            <Button
              title="Use Master Password"
              onPress={() => {
                setMode('password');
                setError('');
              }}
              variant="secondary"
              style={{ marginTop: 8 }}
            />
          </>
        ) : mode === 'pin' ? (
          <>
            <TextInput
              label="PIN"
              value={pin}
              onChangeText={(text) => {
                setPin(text);
                if (error) setError('');
              }}
              placeholder="Enter PIN"
              secureTextEntry
              autoFocus
              error={error}
              onSubmit={handlePinUnlock}
            />

            <Button
              title="Unlock with PIN"
              onPress={handlePinUnlock}
              loading={loading}
              disabled={!pin}
              style={{ marginTop: 8 }}
            />

            {biometricAvailable && (
              <Button
                title="Use Biometrics"
                onPress={() => {
                  setMode('biometric');
                  setPin('');
                  setError('');
                }}
                variant="secondary"
                style={{ marginTop: 8 }}
              />
            )}

            <Button
              title="Use Master Password"
              onPress={() => {
                setMode('password');
                setPin('');
                setError('');
              }}
              variant="secondary"
              style={{ marginTop: 8 }}
            />
          </>
        ) : (
          <>
            <TextInput
              label="Master Password"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError('');
              }}
              placeholder="Enter master password"
              secureTextEntry
              autoFocus
              error={error}
              onSubmit={handlePasswordUnlock}
            />

            <Button
              title="Unlock"
              onPress={handlePasswordUnlock}
              loading={loading}
              disabled={!password}
              style={{ marginTop: 8 }}
            />

            {biometricAvailable && (
              <Button
                title="Use Biometrics"
                onPress={() => {
                  setMode('biometric');
                  setPassword('');
                  setError('');
                }}
                variant="secondary"
                style={{ marginTop: 8 }}
              />
            )}

            {pinConfigured && (
              <Button
                title="Use PIN"
                onPress={() => {
                  setMode('pin');
                  setPassword('');
                  setError('');
                }}
                variant="secondary"
                style={{ marginTop: 8 }}
              />
            )}
          </>
        )}

        {/* Reset Vault link */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button
            onClick={() => setShowResetConfirm(true)}
            style={{
              background: 'none',
              border: 'none',
              color: theme.colors.textSecondary,
              fontSize: theme.typography.sizes.xs,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            Reset Vault
          </button>
        </div>
      </div>

      {/* Reset Vault confirmation dialog */}
      {showResetConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: theme.colors.surface,
              borderRadius: 12,
              padding: 24,
              maxWidth: 420,
              width: '90%',
              border: `1px solid ${theme.colors.border}`,
            }}
          >
            <h2
              style={{
                fontSize: theme.typography.sizes.lg,
                fontWeight: theme.typography.weights.bold,
                color: theme.colors.error,
                marginBottom: 12,
              }}
            >
              Reset Vault?
            </h2>
            <p
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.text,
                marginBottom: 12,
              }}
            >
              This will permanently delete your vault from this device. All stored passwords, cards,
              and notes will be lost.
            </p>
            <p
              style={{
                fontSize: theme.typography.sizes.xs,
                color: theme.colors.textSecondary,
                marginBottom: 20,
              }}
            >
              If you have a cloud backup, you can restore your vault by setting up cloud sync again
              after resetting.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                style={{
                  padding: '8px 16px',
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
              <button
                onClick={async () => {
                  setResetting(true);
                  try {
                    await resetVault();
                  } catch {
                    /* status change will navigate */
                  } finally {
                    setResetting(false);
                    setShowResetConfirm(false);
                  }
                }}
                disabled={resetting}
                style={{
                  padding: '8px 16px',
                  fontSize: theme.typography.sizes.sm,
                  fontWeight: theme.typography.weights.semibold,
                  color: '#fff',
                  background: theme.colors.error,
                  border: 'none',
                  borderRadius: 6,
                  cursor: resetting ? 'not-allowed' : 'pointer',
                  opacity: resetting ? 0.6 : 1,
                }}
              >
                {resetting ? 'Resetting...' : 'Reset Vault'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
