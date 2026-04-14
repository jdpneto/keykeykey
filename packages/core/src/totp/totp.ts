/**
 * TOTP (RFC 6238) — time-based wrapper around HOTP.
 */

import { generateHotpCode, type HotpAlgorithm } from './hotp.js';

export interface TotpParams {
  /** Raw secret (already Base32-decoded). */
  secret: Uint8Array;
  /** Display label from the otpauth URI (e.g. "Example:user@example.com"). */
  label: string;
  /** Issuer name, if present. */
  issuer: string;
  /** HMAC hash algorithm. */
  algorithm: HotpAlgorithm;
  /** Number of digits in the generated code (6, 7, or 8). */
  digits: number;
  /** Time-step in seconds (typically 30). */
  period: number;
}

export function generateTotpCode(params: TotpParams, timestampMs: number = Date.now()): string {
  const { secret, algorithm, digits, period } = params;
  if (secret.length === 0) {
    throw new Error('invalid TOTP secret: empty');
  }
  if (!Number.isFinite(period) || period <= 0) {
    throw new Error(`invalid TOTP period: ${period}`);
  }
  const counter = Math.floor(timestampMs / 1000 / period);
  return generateHotpCode(secret, counter, { digits, algorithm });
}

/**
 * Seconds remaining before the current TOTP code rotates.
 * A timestamp exactly on a period boundary belongs to the new window,
 * so it reports a full `period` of life.
 */
export function getRemainingSeconds(period: number, timestampMs: number = Date.now()): number {
  if (!Number.isFinite(period) || period <= 0) {
    throw new Error(`invalid TOTP period: ${period}`);
  }
  const seconds = Math.floor(timestampMs / 1000);
  const elapsed = seconds % period;
  return period - elapsed;
}
