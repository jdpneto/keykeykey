import { describe, expect, it } from 'vitest';
import { generateTotpCode, getRemainingSeconds, type TotpParams } from './totp.js';

// RFC 6238 Appendix B test vectors. Each algorithm uses a different seed
// length (per RFC 6238 Errata ID 2832): 20/32/64 bytes for SHA-1/256/512.
const SHA1_SECRET = new TextEncoder().encode('12345678901234567890');
const SHA256_SECRET = new TextEncoder().encode('12345678901234567890123456789012');
const SHA512_SECRET = new TextEncoder().encode(
  '1234567890123456789012345678901234567890123456789012345678901234',
);

const BASE: Omit<TotpParams, 'secret' | 'algorithm'> = {
  digits: 8,
  period: 30,
  label: 'rfc',
  issuer: '',
};

const RFC_6238_APPENDIX_B: Array<{
  time: number;
  sha1: string;
  sha256: string;
  sha512: string;
}> = [
  { time: 59, sha1: '94287082', sha256: '46119246', sha512: '90693936' },
  { time: 1111111109, sha1: '07081804', sha256: '68084774', sha512: '25091201' },
  { time: 1111111111, sha1: '14050471', sha256: '67062674', sha512: '99943326' },
  { time: 1234567890, sha1: '89005924', sha256: '91819424', sha512: '93441116' },
  { time: 2000000000, sha1: '69279037', sha256: '90698825', sha512: '38618901' },
  { time: 20000000000, sha1: '65353130', sha256: '77737706', sha512: '47863826' },
];

describe('generateTotpCode — RFC 6238 Appendix B', () => {
  for (const v of RFC_6238_APPENDIX_B) {
    it(`SHA-1  @ ${v.time} -> ${v.sha1}`, () => {
      const code = generateTotpCode(
        { ...BASE, secret: SHA1_SECRET, algorithm: 'SHA-1' },
        v.time * 1000,
      );
      expect(code).toBe(v.sha1);
    });

    it(`SHA-256 @ ${v.time} -> ${v.sha256}`, () => {
      const code = generateTotpCode(
        { ...BASE, secret: SHA256_SECRET, algorithm: 'SHA-256' },
        v.time * 1000,
      );
      expect(code).toBe(v.sha256);
    });

    it(`SHA-512 @ ${v.time} -> ${v.sha512}`, () => {
      const code = generateTotpCode(
        { ...BASE, secret: SHA512_SECRET, algorithm: 'SHA-512' },
        v.time * 1000,
      );
      expect(code).toBe(v.sha512);
    });
  }
});

describe('generateTotpCode — defaults and behavior', () => {
  const params: TotpParams = {
    secret: SHA1_SECRET,
    algorithm: 'SHA-1',
    digits: 6,
    period: 30,
    label: 'rfc',
    issuer: '',
  };

  it('uses the current wall clock when no timestamp is provided', () => {
    const a = generateTotpCode(params);
    const b = generateTotpCode(params, Date.now());
    expect(a).toBe(b);
  });

  it('rejects period <= 0', () => {
    expect(() => generateTotpCode({ ...params, period: 0 })).toThrow(/period/i);
    expect(() => generateTotpCode({ ...params, period: -30 })).toThrow(/period/i);
  });

  it('rejects empty secrets', () => {
    expect(() => generateTotpCode({ ...params, secret: new Uint8Array(0) })).toThrow(/secret/i);
  });
});

describe('getRemainingSeconds', () => {
  it('counts down over a 30-second window', () => {
    // period=30, timestamp 10s into the window => 20s remaining.
    expect(getRemainingSeconds(30, 10_000)).toBe(20);
    expect(getRemainingSeconds(30, 29_999)).toBe(1);
    // Exactly at the boundary => a full new period.
    expect(getRemainingSeconds(30, 30_000)).toBe(30);
  });

  it('rejects period <= 0', () => {
    expect(() => getRemainingSeconds(0)).toThrow(/period/i);
  });
});
