/**
 * PKCE (RFC 7636) helpers — pure crypto, no HTTP.
 *
 * @module sync/oauth/pkce
 */

import { sha256 } from '@noble/hashes/sha256';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// PKCE helpers (RFC 7636)
// ---------------------------------------------------------------------------

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** Generate a 43-128 character URL-safe random string for PKCE. */
export function generateCodeVerifier(): string {
  const length = 64;
  const alphabetLen = UNRESERVED.length; // 66
  const maxUnbiased = 256 - (256 % alphabetLen); // 198
  const result: string[] = [];
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < maxUnbiased && result.length < length) {
        result.push(UNRESERVED[b % alphabetLen]!);
      }
    }
  }
  return result.join('');
}

/**
 * Compute the S256 code challenge for a PKCE verifier.
 *
 * Uses `@noble/hashes/sha256` rather than `crypto.subtle.digest` so the
 * function works on React Native / Hermes — `crypto.subtle` is undefined
 * there, which previously surfaced as "Cannot read property 'digest' of
 * undefined" when the user tapped Connect on any OAuth provider
 * (OneDrive / Google Drive / Dropbox).
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  return base64UrlEncode(sha256(data));
}

// ---------------------------------------------------------------------------
// State parameter
// ---------------------------------------------------------------------------

/** Generate a random state parameter (32 bytes → 64 hex chars) for OAuth CSRF protection. */
export function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
