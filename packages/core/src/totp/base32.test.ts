import { describe, expect, it } from 'vitest';
import { decodeBase32 } from './base32.js';

function bytes(...v: number[]): Uint8Array {
  return new Uint8Array(v);
}

function ascii(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('decodeBase32 — RFC 4648 §10 test vectors', () => {
  it.each([
    ['', ''],
    ['MY======', 'f'],
    ['MZXQ====', 'fo'],
    ['MZXW6===', 'foo'],
    ['MZXW6YQ=', 'foob'],
    ['MZXW6YTB', 'fooba'],
    ['MZXW6YTBOI======', 'foobar'],
  ])('decodes %s -> %s', (encoded, plain) => {
    expect(decodeBase32(encoded)).toEqual(ascii(plain));
  });
});

describe('decodeBase32 — relaxed input handling', () => {
  it('decodes without padding', () => {
    expect(decodeBase32('MY')).toEqual(ascii('f'));
    expect(decodeBase32('MZXW6YTBOI')).toEqual(ascii('foobar'));
  });

  it('accepts lowercase input', () => {
    expect(decodeBase32('mzxw6ytboi')).toEqual(ascii('foobar'));
  });

  it('ignores spaces and hyphens inside the input', () => {
    expect(decodeBase32('MZXW 6YTB OI')).toEqual(ascii('foobar'));
    expect(decodeBase32('MZXW-6YTB-OI')).toEqual(ascii('foobar'));
    expect(decodeBase32('  mzxw-6ytb oi  ')).toEqual(ascii('foobar'));
  });

  it('decodes a canonical otpauth secret', () => {
    // JBSWY3DPEHPK3PXP -> "Hello!\xDE\xAD\xBE\xEF"
    expect(decodeBase32('JBSWY3DPEHPK3PXP')).toEqual(
      bytes(0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef),
    );
  });
});

describe('decodeBase32 — errors', () => {
  it('throws on invalid characters', () => {
    expect(() => decodeBase32('MZXW6YT!')).toThrow(/invalid base32/i);
    expect(() => decodeBase32('0189')).toThrow(/invalid base32/i);
  });

  it('throws on a length that cannot represent whole bytes', () => {
    // 1 or 3 or 6 base32 chars are not valid lengths after padding removal.
    expect(() => decodeBase32('M')).toThrow(/invalid base32/i);
    expect(() => decodeBase32('MZX')).toThrow(/invalid base32/i);
    expect(() => decodeBase32('MZXW6Y')).toThrow(/invalid base32/i);
  });
});
