/**
 * Base32 decoder (RFC 4648) for TOTP secrets.
 *
 * Tolerates lowercase input, spaces, hyphens, and optional `=` padding,
 * which is how users commonly paste OTP secrets.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const LOOKUP = (() => {
  const table = new Int8Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
    table[ALPHABET.toLowerCase().charCodeAt(i)] = i;
  }
  return table;
})();

export function decodeBase32(input: string): Uint8Array {
  let clean = '';
  for (const ch of input) {
    if (ch === ' ' || ch === '-' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    if (ch === '=') break;
    clean += ch;
  }

  if (clean.length === 0) return new Uint8Array(0);

  // Base32 encodes 5 bits per char. Only 2, 4, 5, 7, or 8 chars per 40-bit
  // block produce whole bytes; 1, 3, 6 cannot.
  const rem = clean.length % 8;
  if (rem === 1 || rem === 3 || rem === 6) {
    throw new Error(`invalid base32: length ${clean.length} cannot represent whole bytes`);
  }

  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let pos = 0;

  for (let i = 0; i < clean.length; i++) {
    const value = LOOKUP[clean.charCodeAt(i)];
    if (value === undefined || value < 0) {
      throw new Error(`invalid base32: unexpected character "${clean[i]}"`);
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (buffer >> bits) & 0xff;
    }
  }

  return out;
}
