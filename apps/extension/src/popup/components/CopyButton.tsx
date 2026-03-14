import React, { useState } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const { theme } = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    await sendMessage({ type: 'CLIPBOARD_COPIED' });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
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
        transition: 'color 0.15s',
      }}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}
