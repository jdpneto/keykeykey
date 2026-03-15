import { useState } from 'react';
import { Fingerprint, KeyRound, X } from 'lucide-react';
import { validatePin } from '@keykeykey/core/pin';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';

type Step = 'offer_biometric' | 'offer_pin' | 'setup_pin' | 'done';

export function QuickUnlockPrompt() {
  const { theme } = useTheme();
  const {
    biometricAvailable,
    enableBiometric,
    enablePin,
    pinConfigured,
    dismissQuickUnlockPrompt,
  } = useVault();

  const initialStep: Step = biometricAvailable ? 'offer_biometric' : 'offer_pin';
  const [step, setStep] = useState<Step>(initialStep);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEnableBiometric = async () => {
    setLoading(true);
    try {
      await enableBiometric();
      await dismissQuickUnlockPrompt();
      setStep('done');
    } catch {
      setError('Failed to enable biometric. Try setting up a PIN instead.');
      setStep('offer_pin');
    } finally {
      setLoading(false);
    }
  };

  const handleSkipBiometric = () => {
    setStep('offer_pin');
  };

  const handleSetupPin = () => {
    setPin('');
    setConfirmPin('');
    setError('');
    setStep('setup_pin');
  };

  const handleSkip = async () => {
    await dismissQuickUnlockPrompt();
    setStep('done');
  };

  const handlePinSubmit = async () => {
    setError('');
    const validation = validatePin(pin);
    if (!validation.valid) {
      setError(validation.error ?? 'Invalid PIN');
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs do not match');
      return;
    }
    setLoading(true);
    try {
      await enablePin(pin);
      await dismissQuickUnlockPrompt();
      setStep('done');
    } catch {
      setError('Failed to set up PIN. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'done') return null;

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    padding: 32,
    width: 400,
    maxWidth: '90vw',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    position: 'relative',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text,
    marginBottom: 8,
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textSecondary,
    marginBottom: 24,
    lineHeight: 1.5,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    backgroundColor: theme.colors.inputBackground,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text,
    outline: 'none',
    marginBottom: 12,
    boxSizing: 'border-box',
  };

  const primaryButtonStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    backgroundColor: theme.colors.primary,
    border: 'none',
    borderRadius: theme.radii.md,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: '#000000',
    cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.7 : 1,
    marginBottom: 10,
  };

  const secondaryButtonStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px',
    backgroundColor: 'transparent',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textSecondary,
    cursor: 'pointer',
    marginBottom: 8,
  };

  const closeButtonStyle: React.CSSProperties = {
    position: 'absolute',
    top: 16,
    right: 16,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: theme.colors.textSecondary,
    display: 'flex',
    padding: 4,
  };

  const iconWrapStyle: React.CSSProperties = {
    width: 52,
    height: 52,
    borderRadius: '50%',
    backgroundColor: theme.colors.primaryMuted,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  };

  if (step === 'offer_biometric') {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <button style={closeButtonStyle} onClick={handleSkip} aria-label="Dismiss">
            <X size={18} />
          </button>
          <div style={iconWrapStyle}>
            <Fingerprint size={28} color={theme.colors.primary} />
          </div>
          <div style={titleStyle}>Enable Touch ID?</div>
          <div style={subtitleStyle}>
            Use Touch ID to unlock your vault quickly without entering your master password.
          </div>
          {error && (
            <div
              style={{
                color: theme.colors.error,
                fontSize: theme.typography.sizes.xs,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}
          <button style={primaryButtonStyle} onClick={handleEnableBiometric} disabled={loading}>
            {loading ? 'Enabling…' : 'Enable Touch ID'}
          </button>
          {!pinConfigured && (
            <button style={secondaryButtonStyle} onClick={handleSkipBiometric}>
              Set up PIN instead
            </button>
          )}
          <button style={secondaryButtonStyle} onClick={handleSkip}>
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  if (step === 'offer_pin') {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <button style={closeButtonStyle} onClick={handleSkip} aria-label="Dismiss">
            <X size={18} />
          </button>
          <div style={iconWrapStyle}>
            <KeyRound size={28} color={theme.colors.primary} />
          </div>
          <div style={titleStyle}>Set up a PIN?</div>
          <div style={subtitleStyle}>
            A 4–8 digit PIN lets you unlock your vault quickly without your master password.
          </div>
          <button style={primaryButtonStyle} onClick={handleSetupPin}>
            Set up PIN
          </button>
          <button style={secondaryButtonStyle} onClick={handleSkip}>
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  // step === 'setup_pin'
  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <button style={closeButtonStyle} onClick={handleSkip} aria-label="Dismiss">
          <X size={18} />
        </button>
        <div style={iconWrapStyle}>
          <KeyRound size={28} color={theme.colors.primary} />
        </div>
        <div style={titleStyle}>Create a PIN</div>
        <div style={subtitleStyle}>Enter a 4–8 digit PIN. Avoid simple sequences like 1234.</div>
        <input
          type="password"
          inputMode="numeric"
          placeholder="Enter PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          style={inputStyle}
          maxLength={8}
          onFocus={(e) => (e.currentTarget.style.borderColor = theme.colors.primary)}
          onBlur={(e) => (e.currentTarget.style.borderColor = theme.colors.border)}
        />
        <input
          type="password"
          inputMode="numeric"
          placeholder="Confirm PIN"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value)}
          style={{ ...inputStyle, marginBottom: 16 }}
          maxLength={8}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handlePinSubmit();
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = theme.colors.primary)}
          onBlur={(e) => (e.currentTarget.style.borderColor = theme.colors.border)}
        />
        {error && (
          <div
            style={{
              color: theme.colors.error,
              fontSize: theme.typography.sizes.xs,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}
        <button
          style={primaryButtonStyle}
          onClick={() => void handlePinSubmit()}
          disabled={loading}
        >
          {loading ? 'Saving…' : 'Save PIN'}
        </button>
        <button style={secondaryButtonStyle} onClick={() => setStep(initialStep)}>
          Back
        </button>
      </div>
    </div>
  );
}
