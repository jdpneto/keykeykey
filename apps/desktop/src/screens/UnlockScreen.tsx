import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';

export function UnlockScreen() {
  const { theme } = useTheme();
  const { unlock } = useVault();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUnlock = async () => {
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
          Enter your master password to unlock your vault.
        </p>

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
          onSubmit={handleUnlock}
        />

        <Button
          title="Unlock"
          onPress={handleUnlock}
          loading={loading}
          disabled={!password}
          style={{ marginTop: 8 }}
        />
      </div>
    </div>
  );
}
