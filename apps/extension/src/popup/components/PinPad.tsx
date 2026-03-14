import React, { useState } from 'react';
import { useTheme } from '../../lib/theme.js';

interface PinPadProps {
  onSubmit: (pin: string) => void;
  maxLength?: number;
  error?: string;
}

export function PinPad({ onSubmit, maxLength = 6, error }: PinPadProps) {
  const { theme } = useTheme();
  const [pin, setPin] = useState('');

  const addDigit = (d: string) => {
    const next = pin + d;
    setPin(next);
    if (next.length >= maxLength) onSubmit(next);
  };

  const backspace = () => setPin(pin.slice(0, -1));

  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 8,
          marginBottom: theme.spacing.md,
        }}
      >
        {Array.from({ length: maxLength }, (_, i) => (
          <div
            key={i}
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: i < pin.length ? theme.colors.primary : theme.colors.border,
              transition: 'background 0.15s',
            }}
          />
        ))}
      </div>
      {error && (
        <div
          style={{
            color: theme.colors.error,
            fontSize: theme.typography.sizes.xs,
            marginBottom: theme.spacing.sm,
          }}
        >
          {error}
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          maxWidth: 240,
          margin: '0 auto',
        }}
      >
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←'].map((d, i) =>
          d ? (
            <button
              key={i}
              onClick={() => (d === '←' ? backspace() : addDigit(d))}
              style={{
                padding: `${theme.spacing.sm}px`,
                fontSize: theme.typography.sizes.lg,
                background: theme.colors.surface,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radii.sm,
                color: theme.colors.text,
                cursor: 'pointer',
              }}
            >
              {d}
            </button>
          ) : (
            <div key={i} />
          ),
        )}
      </div>
    </div>
  );
}
