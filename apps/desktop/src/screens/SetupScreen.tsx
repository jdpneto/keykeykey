import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Check, Circle } from 'lucide-react';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';

export function SetupScreen() {
  const { theme } = useTheme();
  const { setupVault } = useVault();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isLongEnough = password.length >= 8;
  const passwordsMatch = password === confirm && confirm.length > 0;
  const isValid = isLongEnough && passwordsMatch;

  const handleCreate = async () => {
    if (!isValid) return;
    setError('');
    setLoading(true);
    // Yield to let the spinner render
    await new Promise((r) => setTimeout(r, 50));
    try {
      await setupVault(password);
      navigate('/recovery', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create vault');
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
      <div style={{ width: '100%', maxWidth: 440 }}>
        {/* Icon */}
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
            <Shield size={32} color={theme.colors.primary} />
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
          Create Your Vault
        </h1>
        <p
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            marginBottom: 32,
          }}
        >
          Choose a strong master password. This is the only password you need to remember.
        </p>

        <TextInput
          label="Master Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Enter master password"
          secureTextEntry
          autoFocus
        />

        <TextInput
          label="Confirm Password"
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Confirm master password"
          secureTextEntry
          onSubmit={handleCreate}
        />

        {/* Requirements */}
        <div style={{ marginBottom: 24 }}>
          <Requirement met={isLongEnough} text="At least 8 characters" theme={theme} />
          <Requirement met={passwordsMatch} text="Passwords match" theme={theme} />
        </div>

        {error && (
          <p
            style={{
              color: theme.colors.error,
              fontSize: theme.typography.sizes.sm,
              textAlign: 'center',
              marginBottom: 16,
            }}
          >
            {error}
          </p>
        )}

        <Button
          title="Create Vault"
          onPress={handleCreate}
          loading={loading}
          disabled={!isValid}
        />
      </div>
    </div>
  );
}

function Requirement({ met, text, theme }: { met: boolean; text: string; theme: any }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 6,
      }}
    >
      {met ? (
        <Check size={16} color={theme.colors.success} />
      ) : (
        <Circle size={16} color={theme.colors.textSecondary} />
      )}
      <span
        style={{
          fontSize: theme.typography.sizes.sm,
          color: met ? theme.colors.success : theme.colors.textSecondary,
        }}
      >
        {text}
      </span>
    </div>
  );
}
