/**
 * DEK envelope encoded into the OS secure enclave under biometric protection.
 *
 * The envelope is plain JSON: a base64 DEK + an ISO-8601 timestamp. The
 * timestamp drives `MAX_DEK_AGE_MS` invalidation — after 14 days the user is
 * forced through a master-password unlock again, so a stolen-device window
 * with the DEK still resident in the secure enclave is bounded.
 */

import { fromBase64, toBase64 } from '../utils/index.js';

/** Maximum age of a stored biometric DEK before it auto-invalidates (14 days). */
export const MAX_DEK_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface DEKPayload {
  /** Base64-encoded DEK bytes. */
  dek: string;
  /** ISO-8601 timestamp at which the DEK was saved. */
  savedAt: string;
}

/** Encode a DEK + capture-time as the JSON string that goes into the enclave. */
export function encodeDEKPayload(dek: Uint8Array, now: Date = new Date()): string {
  const payload: DEKPayload = {
    dek: toBase64(dek),
    savedAt: now.toISOString(),
  };
  return JSON.stringify(payload);
}

/**
 * Decode a previously-encoded payload. Throws if the payload is malformed —
 * callers should treat any throw here the same as "invalidated" and clear the
 * stored bytes.
 */
export function decodeDEKPayload(raw: string): { dek: Uint8Array; savedAt: string } {
  const parsed = JSON.parse(raw) as Partial<DEKPayload>;
  if (typeof parsed.dek !== 'string' || typeof parsed.savedAt !== 'string') {
    throw new Error('Malformed DEK payload');
  }
  return { dek: fromBase64(parsed.dek), savedAt: parsed.savedAt };
}

/** True when `savedAt` is older than `MAX_DEK_AGE_MS`. */
export function isExpired(savedAt: string, nowMs: number = Date.now()): boolean {
  const savedMs = new Date(savedAt).getTime();
  if (Number.isNaN(savedMs)) return true; // unparseable → treat as expired
  return nowMs - savedMs > MAX_DEK_AGE_MS;
}
