import React, { useState } from 'react';
import { useTheme } from '../../../lib/theme.js';
import { sendMessage } from '../../hooks/useMessage.js';
import { EyeIcon, EyeOffIcon } from '../../components/icons/index.js';

interface PinSettingsProps {
  hasPIN: boolean;
  onPinChanged: (hasPIN: boolean) => void;
  onError: (error: string) => void;
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  eyeButtonStyle: React.CSSProperties;
  sectionStyle: React.CSSProperties;
  sectionHeaderStyle: React.CSSProperties;
}

export function PinSettings({
  hasPIN,
  onPinChanged,
  onError,
  inputStyle,
  labelStyle,
  eyeButtonStyle,
  sectionStyle,
  sectionHeaderStyle,
}: PinSettingsProps) {
  const { theme } = useTheme();

  const [pinEntry, setPinEntry] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [showPinForm, setShowPinForm] = useState(false);
  const [pinError, setPinError] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [showPinConfirm, setShowPinConfirm] = useState(false);

  const handleSetPin = async () => {
    setPinError('');
    if (pinEntry.length < 4) {
      setPinError('PIN must be at least 4 digits.');
      return;
    }
    if (pinEntry !== pinConfirm) {
      setPinError('PINs do not match.');
      return;
    }
    try {
      const result = (await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'SET_PIN',
        pin: pinEntry,
      })) as { ok?: boolean; error?: string };
      if (result?.error) {
        setPinError(result.error);
        return;
      }
      onPinChanged(true);
      setShowPinForm(false);
      setPinEntry('');
      setPinConfirm('');
    } catch {
      setPinError('Failed to set PIN.');
    }
  };

  const handleRemovePin = async () => {
    try {
      await sendMessage({ type: 'REMOVE_PIN' });
      onPinChanged(false);
    } catch {
      onError('Failed to remove PIN.');
    }
  };

  return (
    <>
      <div style={sectionHeaderStyle}>Security</div>
      <div style={sectionStyle}>
        {showPinForm ? (
          <>
            <div style={{ marginBottom: theme.spacing.sm }}>
              <label style={labelStyle}>New PIN</label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type={showPin ? 'text' : 'password'}
                  value={pinEntry}
                  onChange={(e) => setPinEntry(e.target.value)}
                  placeholder="Enter PIN"
                  inputMode="numeric"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={() => setShowPin(!showPin)}
                  style={eyeButtonStyle}
                  aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                  type="button"
                >
                  {showPin ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            </div>
            <div style={{ marginBottom: theme.spacing.sm }}>
              <label style={labelStyle}>Confirm PIN</label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type={showPinConfirm ? 'text' : 'password'}
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value)}
                  placeholder="Confirm PIN"
                  inputMode="numeric"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={() => setShowPinConfirm(!showPinConfirm)}
                  style={eyeButtonStyle}
                  aria-label={showPinConfirm ? 'Hide PIN' : 'Show PIN'}
                  type="button"
                >
                  {showPinConfirm ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            </div>
            {pinError && (
              <div
                style={{
                  color: theme.colors.error,
                  fontSize: theme.typography.sizes.xs,
                  marginBottom: theme.spacing.sm,
                }}
              >
                {pinError}
              </div>
            )}
            <div style={{ display: 'flex', gap: theme.spacing.sm }}>
              <button
                onClick={() => {
                  setShowPinForm(false);
                  setPinEntry('');
                  setPinConfirm('');
                  setPinError('');
                }}
                style={{
                  flex: 1,
                  padding: `${theme.spacing.xs}px`,
                  background: 'none',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radii.md,
                  color: theme.colors.text,
                  cursor: 'pointer',
                  fontSize: theme.typography.sizes.sm,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSetPin}
                style={{
                  flex: 1,
                  padding: `${theme.spacing.xs}px`,
                  background: theme.colors.primary,
                  border: 'none',
                  borderRadius: theme.radii.md,
                  color: '#000',
                  cursor: 'pointer',
                  fontSize: theme.typography.sizes.sm,
                  fontWeight: theme.typography.weights.semibold,
                }}
              >
                Set PIN
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', gap: theme.spacing.sm }}>
            <button
              onClick={() => setShowPinForm(true)}
              style={{
                flex: 1,
                padding: `${theme.spacing.xs}px`,
                background: 'none',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radii.md,
                color: theme.colors.text,
                cursor: 'pointer',
                fontSize: theme.typography.sizes.sm,
              }}
            >
              {hasPIN ? 'Change PIN' : 'Set PIN'}
            </button>
            {hasPIN && (
              <button
                onClick={handleRemovePin}
                style={{
                  flex: 1,
                  padding: `${theme.spacing.xs}px`,
                  background: 'none',
                  border: `1px solid ${theme.colors.danger}`,
                  borderRadius: theme.radii.md,
                  color: theme.colors.danger,
                  cursor: 'pointer',
                  fontSize: theme.typography.sizes.sm,
                }}
              >
                Remove PIN
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
