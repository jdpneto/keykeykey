import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';

export function UnlockScreen() {
  const { theme } = useTheme();
  const { unlock, unlockWithPin, pinConfigured } = useVault();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'pin' | 'password'>('password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setMode(pinConfigured ? 'pin' : 'password');
  }, [pinConfigured]);

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
    await new Promise((r) => setTimeout(r, 50));
    try {
      const result = await unlockWithPin(pin);
      if (result.success) {
        navigate('/vault', { replace: true });
      } else if (result.attemptsRemaining === 0) {
        setError('Too many incorrect attempts. PIN has been removed. Use your master password.');
        setMode('password');
        setPin('');
      } else if (result.attemptsRemaining !== null) {
        setError(`Incorrect PIN. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} remaining.`);
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
          {mode === 'pin'
            ? 'Enter your PIN to unlock your vault.'
            : 'Enter your master password to unlock your vault.'}
        </p>

        {mode === 'pin' ? (
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
      </div>
    </div>
  );
}
