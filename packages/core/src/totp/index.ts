/**
 * TOTP authenticator — RFC 6238 code generation and `otpauth://` URI parsing.
 *
 * Pure TypeScript; uses `@noble/hashes` for HMAC.
 *
 * @module totp
 */

export { decodeBase32 } from './base32.js';
export { generateHotpCode } from './hotp.js';
export type { HotpAlgorithm, HotpOptions } from './hotp.js';
export { generateTotpCode, getRemainingSeconds } from './totp.js';
export type { TotpParams } from './totp.js';
export { parseTotpUri } from './parse-uri.js';
