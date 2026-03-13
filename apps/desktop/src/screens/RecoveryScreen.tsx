import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Copy, Check, AlertTriangle } from 'lucide-react';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';
import { copyToClipboard } from '../lib/clipboard';
import { Button } from '../components/ui/Button';

export function RecoveryScreen() {
  const { theme } = useTheme();
  const { recoveryKey } = useVault();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!recoveryKey) return;
    await copyToClipboard(recoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      <div style={{ width: '100%', maxWidth: 480 }}>
        {/* Icon */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: theme.colors.warningLight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <KeyRound size={32} color={theme.colors.warning} />
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
          Save Your Recovery Key
        </h1>
        <p
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            marginBottom: 24,
          }}
        >
          If you forget your master password, this key is the only way to recover your vault.
        </p>

        {/* Recovery key display */}
        <div
          style={{
            backgroundColor: theme.colors.surface,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radii.md,
            padding: 20,
            marginBottom: 16,
            textAlign: 'center',
          }}
        >
          <code
            className="mono"
            style={{
              fontSize: theme.typography.sizes.lg,
              color: theme.colors.text,
              letterSpacing: 1,
              lineHeight: 1.8,
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {recoveryKey}
          </code>
        </div>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            padding: '10px 16px',
            backgroundColor: 'transparent',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radii.md,
            color: copied ? theme.colors.success : theme.colors.textSecondary,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            marginBottom: 24,
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </button>

        {/* Warning */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: 16,
            backgroundColor: theme.colors.warningLight,
            borderRadius: theme.radii.md,
            marginBottom: 24,
          }}
        >
          <AlertTriangle
            size={20}
            color={theme.colors.warning}
            style={{ flexShrink: 0, marginTop: 2 }}
          />
          <p style={{ fontSize: theme.typography.sizes.sm, color: '#78350F', lineHeight: 1.5 }}>
            Write this key down or save it in a secure location. It cannot be displayed again.
          </p>
        </div>

        <Button
          title="I've Saved It — Continue"
          onPress={() => navigate('/vault', { replace: true })}
        />
      </div>
    </div>
  );
}
