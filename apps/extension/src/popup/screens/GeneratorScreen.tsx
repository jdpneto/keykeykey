import React, { useCallback, useEffect, useState } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import { CopyButton } from '../components/CopyButton.js';
import type { PasswordStrength } from '@keykeykey/core';

interface GeneratorScreenProps {
  onBack: () => void;
}

type GenMode = 'random' | 'passphrase';

const SEPARATORS = [
  { value: '-', label: 'Hyphen (-)' },
  { value: '.', label: 'Period (.)' },
  { value: '_', label: 'Underscore (_)' },
  { value: ' ', label: 'Space' },
];

const STRENGTH_COLORS: Record<PasswordStrength, string> = {
  weak: '#EF4444',
  fair: '#F59E0B',
  strong: '#22C55E',
  'very-strong': '#16A34A',
};

const STRENGTH_LABELS: Record<PasswordStrength, string> = {
  weak: 'Weak',
  fair: 'Fair',
  strong: 'Strong',
  'very-strong': 'Very Strong',
};

export function GeneratorScreen({ onBack }: GeneratorScreenProps) {
  const { theme } = useTheme();

  const [mode, setMode] = useState<GenMode>('random');

  // Random options
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);

  // Passphrase options
  const [wordCount, setWordCount] = useState(5);
  const [separator, setSeparator] = useState('-');

  // Output
  const [generated, setGenerated] = useState('');
  const [entropy, setEntropy] = useState(0);
  const [strength, setStrength] = useState<PasswordStrength>('weak');

  const generate = useCallback(async () => {
    try {
      const options =
        mode === 'random'
          ? {
              mode: 'random' as const,
              length,
              uppercase,
              lowercase,
              digits,
              symbols,
              excludeAmbiguous: false,
            }
          : {
              mode: 'passphrase' as const,
              wordCount,
              separator,
              capitalize: true,
              appendNumber: true,
            };

      const result = (await sendMessage<{
        password?: string;
        entropy?: number;
        strength?: PasswordStrength;
      }>({
        type: 'GENERATE_PASSWORD',
        options,
      })) as { password?: string; entropy?: number; strength?: PasswordStrength };

      if (result?.password) {
        setGenerated(result.password);
        setEntropy(result.entropy ?? 0);
        setStrength(result.strength ?? 'weak');
      }
    } catch {
      // ignore
    }
  }, [mode, length, uppercase, lowercase, digits, symbols, wordCount, separator]);

  // Auto-generate on option change
  useEffect(() => {
    generate();
  }, [generate]);

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
    display: 'block',
    marginBottom: 4,
  };

  const checkboxRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  };

  const strengthColor = STRENGTH_COLORS[strength];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '480px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: theme.colors.textSecondary,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.md,
            padding: theme.spacing.xs,
            borderRadius: theme.radii.sm,
          }}
          aria-label="Back"
        >
          &#8592;
        </button>
        <div
          style={{
            flex: 1,
            fontWeight: theme.typography.weights.bold,
            fontSize: theme.typography.sizes.md,
            color: theme.colors.text,
          }}
        >
          Password Generator
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: theme.spacing.md }}>
        {/* Mode toggle */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            background: theme.colors.surfaceAlt,
            borderRadius: theme.radii.full,
            padding: 2,
            marginBottom: theme.spacing.md,
          }}
        >
          {(['random', 'passphrase'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: `${theme.spacing.xs}px`,
                borderRadius: theme.radii.full,
                border: 'none',
                background: mode === m ? theme.colors.primary : 'none',
                color: mode === m ? '#000' : theme.colors.textSecondary,
                fontWeight:
                  mode === m ? theme.typography.weights.semibold : theme.typography.weights.regular,
                fontSize: theme.typography.sizes.sm,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {m === 'random' ? 'Random' : 'Passphrase'}
            </button>
          ))}
        </div>

        {/* Generated password display */}
        <div
          style={{
            background: theme.colors.surface,
            borderRadius: theme.radii.md,
            padding: theme.spacing.md,
            marginBottom: theme.spacing.sm,
            border: `1px solid ${theme.colors.border}`,
          }}
        >
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: theme.typography.sizes.md,
              color: theme.colors.text,
              wordBreak: 'break-all',
              minHeight: 48,
              lineHeight: 1.5,
            }}
          >
            {generated || '…'}
          </div>
        </div>

        {/* Entropy / strength */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.md,
          }}
        >
          <div
            style={{
              flex: 1,
              height: 6,
              background: theme.colors.border,
              borderRadius: theme.radii.full,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                background: strengthColor,
                borderRadius: theme.radii.full,
                width:
                  strength === 'weak'
                    ? '25%'
                    : strength === 'fair'
                      ? '50%'
                      : strength === 'strong'
                        ? '75%'
                        : '100%',
                transition: 'width 0.3s',
              }}
            />
          </div>
          <div
            style={{
              fontSize: theme.typography.sizes.xs,
              color: strengthColor,
              fontWeight: theme.typography.weights.semibold,
              minWidth: 64,
              textAlign: 'right' as const,
            }}
          >
            {STRENGTH_LABELS[strength]}
          </div>
          <div
            style={{
              fontSize: theme.typography.sizes.xs,
              color: theme.colors.textSecondary,
            }}
          >
            {Math.round(entropy)} bits
          </div>
        </div>

        {/* Random options */}
        {mode === 'random' && (
          <>
            <div style={{ marginBottom: theme.spacing.sm }}>
              <label style={labelStyle}>
                Length: <strong>{length}</strong>
              </label>
              <input
                type="range"
                min={8}
                max={128}
                value={length}
                onChange={(e) => setLength(Number(e.target.value))}
                style={{ width: '100%', accentColor: theme.colors.primary }}
              />
            </div>
            <div style={{ marginBottom: theme.spacing.md }}>
              <div style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  id="gen-uppercase"
                  checked={uppercase}
                  onChange={(e) => setUppercase(e.target.checked)}
                />
                <label
                  htmlFor="gen-uppercase"
                  style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.text }}
                >
                  Uppercase (A–Z)
                </label>
              </div>
              <div style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  id="gen-lowercase"
                  checked={lowercase}
                  onChange={(e) => setLowercase(e.target.checked)}
                />
                <label
                  htmlFor="gen-lowercase"
                  style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.text }}
                >
                  Lowercase (a–z)
                </label>
              </div>
              <div style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  id="gen-digits"
                  checked={digits}
                  onChange={(e) => setDigits(e.target.checked)}
                />
                <label
                  htmlFor="gen-digits"
                  style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.text }}
                >
                  Digits (0–9)
                </label>
              </div>
              <div style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  id="gen-symbols"
                  checked={symbols}
                  onChange={(e) => setSymbols(e.target.checked)}
                />
                <label
                  htmlFor="gen-symbols"
                  style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.text }}
                >
                  Symbols (!@#…)
                </label>
              </div>
            </div>
          </>
        )}

        {/* Passphrase options */}
        {mode === 'passphrase' && (
          <>
            <div style={{ marginBottom: theme.spacing.sm }}>
              <label style={labelStyle}>
                Word Count: <strong>{wordCount}</strong>
              </label>
              <input
                type="range"
                min={3}
                max={10}
                value={wordCount}
                onChange={(e) => setWordCount(Number(e.target.value))}
                style={{ width: '100%', accentColor: theme.colors.primary }}
              />
            </div>
            <div style={{ marginBottom: theme.spacing.md }}>
              <label style={labelStyle}>Separator</label>
              <select
                value={separator}
                onChange={(e) => setSeparator(e.target.value)}
                style={inputStyle}
              >
                {SEPARATORS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: theme.spacing.sm }}>
          <button
            onClick={generate}
            style={{
              flex: 1,
              padding: `${theme.spacing.sm}px`,
              background: theme.colors.surface,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.md,
              color: theme.colors.text,
              cursor: 'pointer',
              fontWeight: theme.typography.weights.medium,
              fontSize: theme.typography.sizes.sm,
            }}
          >
            Regenerate
          </button>
          <div style={{ flex: 1 }}>
            <CopyButton text={generated} label="Copy Password" />
          </div>
        </div>
      </div>
    </div>
  );
}
