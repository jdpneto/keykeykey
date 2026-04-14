import { useEffect, useMemo, useState } from 'react';
import {
  generateTotpCode,
  getRemainingSeconds,
  parseTotpUri,
  decodeBase32,
  type TotpParams,
} from '@keykeykey/core/totp';

export interface UseTotpCodeResult {
  /** Current code, e.g. "123456". `null` if input is empty or failed to parse. */
  code: string | null;
  /** Seconds until the code rotates. 0 when there is no active code. */
  remainingSeconds: number;
  /** Issuer, when derivable from the URI. */
  issuer: string;
  /** Full account label from the URI. */
  label: string;
  /** Parse error, if any. */
  error: string | null;
}

const EMPTY: UseTotpCodeResult = {
  code: null,
  remainingSeconds: 0,
  issuer: '',
  label: '',
  error: null,
};

function toParams(input: string): TotpParams {
  const trimmed = input.trim();
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    return parseTotpUri(trimmed);
  }
  // Raw Base32 secret — use RFC defaults.
  const secret = decodeBase32(trimmed);
  if (secret.length === 0) {
    throw new Error('invalid TOTP secret: empty');
  }
  return {
    secret,
    label: '',
    issuer: '',
    algorithm: 'SHA-1',
    digits: 6,
    period: 30,
  };
}

/**
 * Generates a live TOTP code from an `otpauth://` URI or a raw Base32 secret.
 * Returns `{ code: null, error }` on parse failure; otherwise re-renders
 * every second with an updated code and countdown.
 */
export function useTotpCode(input: string | null | undefined): UseTotpCodeResult {
  const parsed = useMemo<
    { ok: true; params: TotpParams } | { ok: false; error: string } | { ok: false; error: null }
  >(() => {
    if (!input || !input.trim()) return { ok: false, error: null };
    try {
      return { ok: true, params: toParams(input) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [input]);

  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!parsed.ok) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [parsed]);

  if (!parsed.ok) {
    return { ...EMPTY, error: parsed.error };
  }

  const now = Date.now();
  return {
    code: generateTotpCode(parsed.params, now),
    remainingSeconds: getRemainingSeconds(parsed.params.period, now),
    issuer: parsed.params.issuer,
    label: parsed.params.label,
    error: null,
  };
}
