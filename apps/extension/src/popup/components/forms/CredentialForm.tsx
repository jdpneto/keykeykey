import React, { useState } from 'react';
import type { Theme } from '../../../lib/theme.js';
import { generatePassword } from '@keykeykey/core/generator';
import { EyeIcon, EyeOffIcon, RefreshIcon } from '../icons/index.js';
import { TotpCodeDisplay } from '../TotpCodeDisplay.js';

export interface CredentialFormValues {
  url: string;
  username: string;
  password: string;
  totp: string;
  notes: string;
}

interface CredentialFormProps {
  values: CredentialFormValues;
  onChange: (field: keyof CredentialFormValues, value: string) => void;
  theme: Theme;
}

export function CredentialForm({ values, onChange, theme }: CredentialFormProps) {
  const [showPassword, setShowPassword] = useState(false);

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
        <label style={labelStyle}>URL</label>
        <input
          type="url"
          value={values.url}
          onChange={(e) => onChange('url', e.target.value)}
          placeholder="https://example.com"
          style={inputStyle}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Username</label>
        <input
          type="text"
          value={values.username}
          onChange={(e) => onChange('username', e.target.value)}
          placeholder="user@example.com"
          style={inputStyle}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Password</label>
        <div style={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'center' }}>
          <input
            type={showPassword ? 'text' : 'password'}
            value={values.password}
            onChange={(e) => onChange('password', e.target.value)}
            placeholder="Password"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={() => setShowPassword(!showPassword)}
            style={eyeButtonStyle}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            type="button"
          >
            {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
          </button>
          <button
            onClick={() => {
              const pw = generatePassword({
                mode: 'random',
                length: 20,
                uppercase: true,
                lowercase: true,
                digits: true,
                symbols: true,
              });
              onChange('password', pw);
              setShowPassword(true);
            }}
            style={{
              padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
              background: theme.colors.primaryMuted,
              border: 'none',
              borderRadius: theme.radii.md,
              color: theme.colors.text,
              cursor: 'pointer',
              fontSize: theme.typography.sizes.xs,
              fontWeight: theme.typography.weights.medium,
              whiteSpace: 'nowrap' as const,
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
            type="button"
          >
            {values.password ? <RefreshIcon size={14} /> : 'Generate'}
          </button>
        </div>
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>TOTP / 2FA</label>
        <input
          type="text"
          value={values.totp}
          onChange={(e) => onChange('totp', e.target.value)}
          placeholder="otpauth://totp/... or Base32 secret"
          style={inputStyle}
        />
      </div>
      {values.totp.trim() && (
        <div style={fieldStyle}>
          <TotpCodeDisplay input={values.totp} label="Preview" />
        </div>
      )}
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
