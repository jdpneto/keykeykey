import { describe, expect, it } from 'vitest';
import { parseTotpUri } from './parse-uri.js';

describe('parseTotpUri — canonical otpauth URIs', () => {
  it('parses a fully-specified URI', () => {
    const uri =
      'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=60';
    const p = parseTotpUri(uri);

    expect(p.label).toBe('Example:alice@example.com');
    expect(p.issuer).toBe('Example');
    expect(p.algorithm).toBe('SHA-256');
    expect(p.digits).toBe(8);
    expect(p.period).toBe(60);
    expect(p.secret).toHaveLength(10);
  });

  it('applies RFC defaults when optional params are omitted', () => {
    const p = parseTotpUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP');
    expect(p.algorithm).toBe('SHA-1');
    expect(p.digits).toBe(6);
    expect(p.period).toBe(30);
    expect(p.label).toBe('x');
    expect(p.issuer).toBe('');
  });

  it('extracts issuer from the label prefix when the param is missing', () => {
    const p = parseTotpUri('otpauth://totp/ACME%20Co:alice@example.com?secret=JBSWY3DPEHPK3PXP');
    expect(p.label).toBe('ACME Co:alice@example.com');
    expect(p.issuer).toBe('ACME Co');
  });

  it('prefers the issuer query param over the label prefix', () => {
    const p = parseTotpUri('otpauth://totp/Legacy:alice?secret=JBSWY3DPEHPK3PXP&issuer=Canonical');
    expect(p.issuer).toBe('Canonical');
  });

  it('decodes percent-encoded labels', () => {
    const p = parseTotpUri('otpauth://totp/Big%20Corp:a%40b.com?secret=JBSWY3DPEHPK3PXP');
    expect(p.label).toBe('Big Corp:a@b.com');
    expect(p.issuer).toBe('Big Corp');
  });

  it('normalizes algorithm casing and dashes', () => {
    expect(parseTotpUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=sha1').algorithm).toBe(
      'SHA-1',
    );
    expect(
      parseTotpUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=SHA-256').algorithm,
    ).toBe('SHA-256');
    expect(
      parseTotpUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=sha512').algorithm,
    ).toBe('SHA-512');
  });

  it('tolerates Base32 secrets with spaces and hyphens', () => {
    const p = parseTotpUri('otpauth://totp/x?secret=JBSW-Y3DP-EHPK-3PXP');
    expect(p.secret).toHaveLength(10);
  });
});

describe('parseTotpUri — errors', () => {
  it('rejects non-otpauth schemes', () => {
    expect(() => parseTotpUri('https://example.com/?secret=JBSWY3DPEHPK3PXP')).toThrow(/otpauth/i);
  });

  it('rejects hotp URIs (HOTP is not supported as a user-facing credential)', () => {
    expect(() => parseTotpUri('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=0')).toThrow(
      /hotp/i,
    );
  });

  it('rejects URIs with no secret', () => {
    expect(() => parseTotpUri('otpauth://totp/x?issuer=Example')).toThrow(/secret/i);
  });

  it('rejects URIs with an invalid Base32 secret', () => {
    expect(() => parseTotpUri('otpauth://totp/x?secret=not!base32')).toThrow(/base32/i);
  });

  it('rejects unsupported algorithms', () => {
    expect(() => parseTotpUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=md5')).toThrow(
      /algorithm/i,
    );
  });

  it('rejects out-of-range digits', () => {
    expect(() => parseTotpUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=4')).toThrow(
      /digits/i,
    );
    expect(() => parseTotpUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=12')).toThrow(
      /digits/i,
    );
  });

  it('rejects non-positive periods', () => {
    expect(() => parseTotpUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0')).toThrow(
      /period/i,
    );
  });
});
