import { useState, useCallback } from 'react';
import { RefreshCw, Copy, Check } from 'lucide-react';
import { generatePassword, calculateEntropy, estimateStrength } from '@keykeykey/core';
import type { RandomOptions } from '@keykeykey/core';
import { useTheme } from '../lib/theme';
import { copyWithAutoClear } from '../lib/clipboard';
import { useToast } from '../components/ui/Toast';
import { ToggleSwitch } from '../components/ui/ToggleSwitch';

function buildOptions(
  length: number,
  uppercase: boolean,
  digits: boolean,
  symbols: boolean,
): RandomOptions {
  return {
    mode: 'random',
    length,
    uppercase,
    lowercase: true,
    digits,
    symbols,
    excludeAmbiguous: false,
  };
}

const STRENGTH_COLORS: Record<string, string> = {
  weak: '#EF4444',
  fair: '#F59E0B',
  strong: '#22C55E',
  'very-strong': '#16A34A',
};

export function GeneratorScreen() {
  const { theme } = useTheme();
  const toast = useToast();

  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [password, setPassword] = useState(() =>
    generatePassword(buildOptions(20, true, true, true)),
  );
  const [copied, setCopied] = useState(false);

  const currentOptions = buildOptions(length, uppercase, digits, symbols);
  const entropy = calculateEntropy(currentOptions);
  const strength = estimateStrength(entropy);

  const regenerate = useCallback(() => {
    setPassword(generatePassword(buildOptions(length, uppercase, digits, symbols)));
    setCopied(false);
  }, [length, uppercase, digits, symbols]);

  const handleCopy = async () => {
    await copyWithAutoClear(password);
    setCopied(true);
    toast.show('Copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  const updateAndRegenerate = <T extends number | boolean>(setter: (v: T) => void, value: T) => {
    setter(value);
    setTimeout(() => {
      setPassword(
        generatePassword(
          buildOptions(
            typeof value === 'number' ? value : length,
            typeof value === 'boolean' && setter === setUppercase ? value : uppercase,
            typeof value === 'boolean' && setter === setDigits ? value : digits,
            typeof value === 'boolean' && setter === setSymbols ? value : symbols,
          ),
        ),
      );
      setCopied(false);
    }, 0);
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <h1
        style={{
          fontSize: theme.typography.sizes.xl,
          fontWeight: theme.typography.weights.bold,
          color: theme.colors.text,
          marginBottom: 24,
        }}
      >
        Password Generator
      </h1>

      {/* Password display */}
      <div
        style={{
          padding: 20,
          backgroundColor: theme.colors.surface,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radii.md,
          marginBottom: 8,
          textAlign: 'center',
        }}
      >
        <code
          className="mono"
          style={{
            fontSize: theme.typography.sizes.lg,
            color: theme.colors.text,
            wordBreak: 'break-all',
            letterSpacing: 0.5,
            userSelect: 'all',
          }}
        >
          {password}
        </code>
      </div>

      {/* Strength indicator */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary }}>
          {Math.round(entropy)} bits of entropy
        </span>
        <span
          style={{
            fontSize: theme.typography.sizes.xs,
            fontWeight: theme.typography.weights.semibold,
            color: STRENGTH_COLORS[strength],
          }}
        >
          {strength.replace('-', ' ')}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
        <button
          onClick={handleCopy}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '10px 16px',
            backgroundColor: theme.colors.primary,
            border: 'none',
            borderRadius: theme.radii.md,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.semibold,
            color: '#000000',
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={regenerate}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '10px 16px',
            backgroundColor: 'transparent',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radii.md,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.text,
          }}
        >
          <RefreshCw size={16} />
          Regenerate
        </button>
      </div>

      {/* Length slider */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <label style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary }}>
            Length
          </label>
          <span
            style={{
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.semibold,
              color: theme.colors.text,
            }}
          >
            {length}
          </span>
        </div>
        <input
          type="range"
          min={8}
          max={64}
          value={length}
          onChange={(e) => updateAndRegenerate(setLength, Number(e.target.value))}
          style={{
            width: '100%',
            accentColor: theme.colors.primary,
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
          }}
        >
          <span>8</span>
          <span>64</span>
        </div>
      </div>

      {/* Character options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.text }}>
            Uppercase (A-Z)
          </span>
          <ToggleSwitch value={uppercase} onToggle={(v) => updateAndRegenerate(setUppercase, v)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.text }}>
            Digits (0-9)
          </span>
          <ToggleSwitch value={digits} onToggle={(v) => updateAndRegenerate(setDigits, v)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.text }}>
            Symbols (!@#$...)
          </span>
          <ToggleSwitch value={symbols} onToggle={(v) => updateAndRegenerate(setSymbols, v)} />
        </div>
      </div>
    </div>
  );
}
