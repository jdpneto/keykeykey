import React, { useState } from 'react';
import type { Theme } from '../../../lib/theme.js';
import { EyeIcon, EyeOffIcon } from '../icons/index.js';

export interface CardFormValues {
  cardholderName: string;
  cardNumber: string;
  expirationMonth: string;
  expirationYear: string;
  cvv: string;
  pin: string;
  notes: string;
}

interface CardFormProps {
  values: CardFormValues;
  onChange: (field: keyof CardFormValues, value: string) => void;
  theme: Theme;
}

export function CardForm({ values, onChange, theme }: CardFormProps) {
  const [showCvv, setShowCvv] = useState(false);
  const [showPin, setShowPin] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    background: theme.colors.inputBackground,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    color: theme.colors.text,
    fontSize: theme.typography.sizes.sm,
    outline: 'none',
    boxSizing: 'border-box' as const,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textSecondary,
    fontWeight: theme.typography.weights.medium,
    marginBottom: 4,
    display: 'block',
  };

  const fieldStyle: React.CSSProperties = {
    marginBottom: theme.spacing.sm,
  };

  const eyeButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: theme.colors.textSecondary,
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  };

  return (
    <>
      <div style={fieldStyle}>
        <label style={labelStyle}>Cardholder Name</label>
        <input
          type="text"
          value={values.cardholderName}
          onChange={(e) => onChange('cardholderName', e.target.value)}
          placeholder="John Doe"
          style={inputStyle}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Card Number</label>
        <input
          type="text"
          value={values.cardNumber}
          onChange={(e) => onChange('cardNumber', e.target.value)}
          placeholder="1234 5678 9012 3456"
          style={inputStyle}
        />
      </div>
      <div style={{ display: 'flex', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Exp. Month</label>
          <input
            type="number"
            value={values.expirationMonth}
            onChange={(e) => onChange('expirationMonth', e.target.value)}
            placeholder="MM"
            min={1}
            max={12}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Exp. Year</label>
          <input
            type="number"
            value={values.expirationYear}
            onChange={(e) => onChange('expirationYear', e.target.value)}
            placeholder="YYYY"
            min={2000}
            style={inputStyle}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>CVV</label>
          <div style={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'center' }}>
            <input
              type={showCvv ? 'text' : 'password'}
              value={values.cvv}
              onChange={(e) => onChange('cvv', e.target.value)}
              placeholder="123"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => setShowCvv(!showCvv)}
              style={eyeButtonStyle}
              aria-label={showCvv ? 'Hide CVV' : 'Show CVV'}
              type="button"
            >
              {showCvv ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>PIN (optional)</label>
          <div style={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'center' }}>
            <input
              type={showPin ? 'text' : 'password'}
              value={values.pin}
              onChange={(e) => onChange('pin', e.target.value)}
              placeholder="Optional"
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
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Notes</label>
        <textarea
          value={values.notes}
          onChange={(e) => onChange('notes', e.target.value)}
          placeholder="Optional notes"
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' as const }}
        />
      </div>
    </>
  );
}
