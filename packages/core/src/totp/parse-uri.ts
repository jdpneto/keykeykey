/**
 * Parser for the `otpauth://totp/...` URI format.
 *
 * Spec: https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 */

import { decodeBase32 } from './base32.js';
import type { HotpAlgorithm } from './hotp.js';
import type { TotpParams } from './totp.js';

function normalizeAlgorithm(raw: string): HotpAlgorithm {
  const v = raw.replace(/-/g, '').toUpperCase();
  if (v === 'SHA1') return 'SHA-1';
  if (v === 'SHA256') return 'SHA-256';
  if (v === 'SHA512') return 'SHA-512';
  throw new Error(`unsupported TOTP algorithm: ${raw}`);
}

function splitPath(uri: string): { type: string; label: string; query: string } {
  // `new URL` mangles `otpauth://totp/Foo:bar` in some JS runtimes, so we
  // parse by hand to stay consistent across mobile/desktop/extension.
  const withoutScheme = uri.replace(/^otpauth:\/\//i, '');
  const questionIdx = withoutScheme.indexOf('?');
  const pathPart = questionIdx === -1 ? withoutScheme : withoutScheme.substring(0, questionIdx);
  const query = questionIdx === -1 ? '' : withoutScheme.substring(questionIdx + 1);

  const slashIdx = pathPart.indexOf('/');
  if (slashIdx === -1) {
    return { type: pathPart.toLowerCase(), label: '', query };
  }
  return {
    type: pathPart.substring(0, slashIdx).toLowerCase(),
    label: decodeURIComponent(pathPart.substring(slashIdx + 1)),
    query,
  };
}

export function parseTotpUri(uri: string): TotpParams {
  if (!/^otpauth:\/\//i.test(uri)) {
    throw new Error('invalid TOTP URI: must start with otpauth://');
  }

  const { type, label, query } = splitPath(uri);
  if (type === 'hotp') {
    throw new Error('HOTP URIs are not supported — only otpauth://totp/...');
  }
  if (type !== 'totp') {
    throw new Error(`invalid TOTP URI: unknown type "${type}"`);
  }

  const params = new URLSearchParams(query);
  const rawSecret = params.get('secret');
  if (!rawSecret) {
    throw new Error('invalid TOTP URI: missing secret');
  }

  const secret = decodeBase32(rawSecret);

  const algorithm = normalizeAlgorithm(params.get('algorithm') ?? 'SHA1');

  const digitsRaw = params.get('digits');
  const digits = digitsRaw === null ? 6 : Number.parseInt(digitsRaw, 10);
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error(`invalid TOTP digits: ${digitsRaw}`);
  }

  const periodRaw = params.get('period');
  const period = periodRaw === null ? 30 : Number.parseInt(periodRaw, 10);
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error(`invalid TOTP period: ${periodRaw}`);
  }

  let issuer = params.get('issuer') ?? '';
  if (!issuer && label.includes(':')) {
    issuer = label.substring(0, label.indexOf(':'));
  }

  return { secret, label, issuer, algorithm, digits, period };
}
