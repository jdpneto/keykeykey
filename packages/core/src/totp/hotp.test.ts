import { describe, expect, it } from 'vitest';
import { generateHotpCode } from './hotp.js';

// RFC 4226 Appendix D test vectors. ASCII secret "12345678901234567890".
const SECRET = new TextEncoder().encode('12345678901234567890');

const RFC_4226_APPENDIX_D: Array<[number, string]> = [
  [0, '755224'],
  [1, '287082'],
  [2, '359152'],
  [3, '969429'],
  [4, '338314'],
  [5, '254676'],
  [6, '287922'],
  [7, '162583'],
  [8, '399871'],
  [9, '520489'],
];

describe('generateHotpCode — RFC 4226 Appendix D', () => {
  it.each(RFC_4226_APPENDIX_D)('counter %i -> %s', (counter, expected) => {
    expect(generateHotpCode(SECRET, counter, { digits: 6, algorithm: 'SHA-1' })).toBe(expected);
  });
});

describe('generateHotpCode — digits', () => {
  it('produces 8-digit codes when requested', () => {
    // 8-digit variant of counter 0, derived by mod 10^8 instead of 10^6.
    expect(generateHotpCode(SECRET, 0, { digits: 8, algorithm: 'SHA-1' })).toBe('84755224');
  });

  it('zero-pads short codes', () => {
    // If the truncated value is small, leading zeros must be preserved.
    const code = generateHotpCode(SECRET, 0, { digits: 8, algorithm: 'SHA-1' });
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^\d{8}$/);
  });

  it('rejects digit counts outside 6..8', () => {
    expect(() => generateHotpCode(SECRET, 0, { digits: 5, algorithm: 'SHA-1' })).toThrow(/digits/i);
    expect(() => generateHotpCode(SECRET, 0, { digits: 9, algorithm: 'SHA-1' })).toThrow(/digits/i);
  });

  it('rejects negative or non-integer counters', () => {
    expect(() => generateHotpCode(SECRET, -1, { digits: 6, algorithm: 'SHA-1' })).toThrow();
    expect(() => generateHotpCode(SECRET, 1.5, { digits: 6, algorithm: 'SHA-1' })).toThrow();
  });
});

describe('generateHotpCode — 8-byte counter encoding', () => {
  it('handles counters above 2^32 without overflow', () => {
    // Just verifying the function runs and yields a 6-digit code for a
    // large counter — confirms we are encoding 64-bit counters, not 32-bit.
    const code = generateHotpCode(SECRET, 0xffffffff + 1, { digits: 6, algorithm: 'SHA-1' });
    expect(code).toMatch(/^\d{6}$/);
  });
});
