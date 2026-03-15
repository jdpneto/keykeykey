/**
 * Base64 encoding/decoding utilities for Uint8Array.
 *
 * Used across all platforms for serializing binary data (DEKs, salts, etc.)
 * to/from storage formats.
 */

/** Encode a Uint8Array to a base64 string. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Decode a base64 string to a Uint8Array. Throws on invalid input. */
export function fromBase64(b64: string): Uint8Array {
  if (!b64 || typeof b64 !== 'string') {
    throw new Error('Invalid base64 input');
  }
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    throw new Error('Invalid base64 data');
  }
}
