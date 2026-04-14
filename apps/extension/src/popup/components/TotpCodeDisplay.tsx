import React, { useState } from 'react';
import { useTotpCode } from '@keykeykey/ui';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';

interface TotpCodeDisplayProps {
  input: string;
  /** Defaults to "One-Time Code". */
  label?: string;
}

function formatCode(code: string): string {
  const mid = Math.floor(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}

export function TotpCodeDisplay({ input, label = 'One-Time Code' }: TotpCodeDisplayProps) {
  const { theme } = useTheme();
  const { code, remainingSeconds, error } = useTotpCode(input);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    await sendMessage({ type: 'CLIPBOARD_COPIED' });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const labelStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textSecondary,
    fontWeight: theme.typography.weights.medium,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  return (
    <div>
      <div style={labelStyle}>{label}</div>
      {error ? (
        <div style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.error }}>
          {error}
        </div>
      ) : code ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <div
            style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: theme.typography.sizes.lg,
              fontWeight: theme.typography.weights.semibold,
              color: theme.colors.text,
              letterSpacing: 2,
            }}
          >
            {formatCode(code)}
          </div>
          <div
            style={{
              fontSize: theme.typography.sizes.xs,
              color: remainingSeconds <= 5 ? theme.colors.error : theme.colors.textSecondary,
              minWidth: 24,
              textAlign: 'right',
            }}
            title={`${remainingSeconds}s remaining`}
          >
            {remainingSeconds}s
          </div>
          <button
            onClick={handleCopy}
            style={{
              background: 'none',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.sm,
              padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
              color: copied ? theme.colors.primary : theme.colors.textSecondary,
              cursor: 'pointer',
              fontSize: theme.typography.sizes.xs,
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      ) : (
        <div style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary }}>
          Enter an otpauth:// URI or Base32 secret to preview.
        </div>
      )}
    </div>
  );
}
