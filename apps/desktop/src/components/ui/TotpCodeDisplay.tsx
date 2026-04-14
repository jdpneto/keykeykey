import { Copy, Check, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTotpCode } from '@keykeykey/ui';
import { useTheme } from '../../lib/theme';
import { copyWithAutoClear } from '../../lib/clipboard';

type TotpCodeDisplayProps = {
  /** Raw otpauth:// URI or Base32 secret. */
  input: string;
  /** Shown as the field label. Defaults to "One-Time Code". */
  label?: string;
  /** Called after a successful copy (for toast feedback). */
  onCopy?: () => void;
};

function formatCode(code: string): string {
  const mid = Math.floor(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}

export function TotpCodeDisplay({ input, label = 'One-Time Code', onCopy }: TotpCodeDisplayProps) {
  const { theme } = useTheme();
  const { code, remainingSeconds, error } = useTotpCode(input);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!code) return;
    await copyWithAutoClear(code);
    setCopied(true);
    onCopy?.();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      {label && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            marginBottom: 4,
          }}
        >
          <ShieldCheck size={12} />
          {label}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 12px',
          backgroundColor: theme.colors.surface,
          border: `1px solid ${error ? theme.colors.error : theme.colors.border}`,
          borderRadius: theme.radii.sm,
        }}
      >
        {error ? (
          <span
            style={{
              flex: 1,
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.error,
            }}
          >
            {error}
          </span>
        ) : code ? (
          <>
            <span
              className="mono"
              style={{
                flex: 1,
                fontSize: theme.typography.sizes.xl,
                fontWeight: theme.typography.weights.semibold,
                color: theme.colors.text,
                letterSpacing: 2,
              }}
            >
              {formatCode(code)}
            </span>
            <Countdown remaining={remainingSeconds} />
            <button
              type="button"
              onClick={handleCopy}
              title="Copy code"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: copied ? theme.colors.success : theme.colors.textSecondary,
                display: 'flex',
                padding: 2,
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </>
        ) : (
          <span
            style={{
              flex: 1,
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.textSecondary,
            }}
          >
            Enter an otpauth:// URI or Base32 secret to preview the code.
          </span>
        )}
      </div>
    </div>
  );
}

function Countdown({ remaining }: { remaining: number }) {
  const { theme } = useTheme();
  // 30s window is the common case; clamp the ring to [0,1] regardless of period.
  const fraction = Math.max(0, Math.min(1, remaining / 30));
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - fraction);
  return (
    <div
      style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}
      title={`${remaining}s remaining`}
    >
      <svg width={28} height={28} viewBox="0 0 28 28">
        <circle
          cx={14}
          cy={14}
          r={radius}
          fill="none"
          stroke={theme.colors.border}
          strokeWidth={2}
        />
        <circle
          cx={14}
          cy={14}
          r={radius}
          fill="none"
          stroke={remaining <= 5 ? theme.colors.error : theme.colors.primary}
          strokeWidth={2}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 14 14)"
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <span
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: theme.typography.sizes.xs,
          color: theme.colors.textSecondary,
        }}
      >
        {remaining}
      </span>
    </div>
  );
}
