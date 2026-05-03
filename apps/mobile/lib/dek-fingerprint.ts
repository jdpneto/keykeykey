import { sha256 } from '@noble/hashes/sha256';
import { toBase64 } from '@keykeykey/core/utils';

/**
 * 8-byte prefix of SHA-256(dek), base64-encoded. Used as a cheap identity
 * check for "is the DEK I just unwrapped the same DEK that's encrypting the
 * items on disk?".
 *
 * Stored alongside PIN-wrapped and biometric-wrapped DEKs. On every
 * master-password unlock in the main app we compare the stored fingerprint
 * against the current DEK and auto-clear the stale wrapping — so the
 * credential-provider appex never hits a DEK mismatch in the first place.
 *
 * 64-bit collision resistance is plenty for identity comparison. This is NOT
 * a confidentiality measure: an attacker with the fingerprint can't derive
 * the DEK. The fingerprint lives in the same keychain group as the wrapped
 * DEK anyway — if they can read one, they can read the other.
 */
export function dekFingerprint(dek: Uint8Array): string {
  const full = sha256(dek);
  return toBase64(full.slice(0, 8));
}
