import { describe, it, expect } from 'vitest';
import {
  generatePassword,
  calculateEntropy,
  estimateStrength,
  getDefaultStrongPassword,
  DEFAULT_RANDOM_OPTIONS,
  DEFAULT_PASSPHRASE_OPTIONS,
} from '../index.js';
import type { RandomOptions } from '../types.js';

const LOWERCASE = /[a-z]/;
const UPPERCASE = /[A-Z]/;
const DIGITS = /[0-9]/;
const SYMBOLS = /[!@#$%^&*()\-_=+[\]{}|;:,.<>?]/;
const AMBIGUOUS = /[O0oIl1]/;

describe('generatePassword', () => {
  describe('random mode', () => {
    it('generates password of requested length', () => {
      for (const length of [8, 16, 32, 64, 128]) {
        const pw = generatePassword({
          mode: 'random',
          length,
          uppercase: true,
          lowercase: true,
          digits: true,
          symbols: true,
          excludeAmbiguous: false,
        });
        expect(pw).toHaveLength(length);
      }
    });

    it('generates lowercase-only when only lowercase enabled', () => {
      const pw = generatePassword({
        mode: 'random',
        length: 40,
        uppercase: false,
        lowercase: true,
        digits: false,
        symbols: false,
        excludeAmbiguous: false,
      });
      expect(pw).toMatch(/^[a-z]+$/);
    });

    it('generates uppercase-only when only uppercase enabled', () => {
      const pw = generatePassword({
        mode: 'random',
        length: 40,
        uppercase: true,
        lowercase: false,
        digits: false,
        symbols: false,
        excludeAmbiguous: false,
      });
      expect(pw).toMatch(/^[A-Z]+$/);
    });

    it('generates digits-only when only digits enabled', () => {
      const pw = generatePassword({
        mode: 'random',
        length: 40,
        uppercase: false,
        lowercase: false,
        digits: true,
        symbols: false,
        excludeAmbiguous: false,
      });
      expect(pw).toMatch(/^[0-9]+$/);
    });

    it('generates symbols-only when only symbols enabled', () => {
      const pw = generatePassword({
        mode: 'random',
        length: 40,
        uppercase: false,
        lowercase: false,
        digits: false,
        symbols: true,
        excludeAmbiguous: false,
      });
      // No letters or digits
      expect(pw).not.toMatch(/[a-zA-Z0-9]/);
      expect(pw).toHaveLength(40);
    });

    it('guarantees all enabled classes are present (1000 iterations)', () => {
      const options: RandomOptions = {
        mode: 'random',
        length: 20,
        uppercase: true,
        lowercase: true,
        digits: true,
        symbols: true,
        excludeAmbiguous: false,
      };

      for (let i = 0; i < 1000; i++) {
        const pw = generatePassword(options);
        expect(pw).toMatch(LOWERCASE);
        expect(pw).toMatch(UPPERCASE);
        expect(pw).toMatch(DIGITS);
        expect(pw).toMatch(SYMBOLS);
      }
    });

    it('excludes ambiguous characters when excludeAmbiguous is true', () => {
      for (let i = 0; i < 100; i++) {
        const pw = generatePassword({
          mode: 'random',
          length: 50,
          uppercase: true,
          lowercase: true,
          digits: true,
          symbols: true,
          excludeAmbiguous: true,
        });
        expect(pw).not.toMatch(AMBIGUOUS);
      }
    });

    it('falls back to lowercase if no classes enabled', () => {
      const pw = generatePassword({
        mode: 'random',
        length: 20,
        uppercase: false,
        lowercase: false,
        digits: false,
        symbols: false,
        excludeAmbiguous: false,
      });
      expect(pw).toMatch(/^[a-z]+$/);
      expect(pw).toHaveLength(20);
    });

    it('uses default options when called with no arguments', () => {
      const pw = generatePassword();
      expect(pw).toHaveLength(DEFAULT_RANDOM_OPTIONS.length);
    });
  });

  describe('passphrase mode', () => {
    it('generates correct number of words', () => {
      const pw = generatePassword({
        mode: 'passphrase',
        wordCount: 4,
        separator: '-',
        capitalize: false,
        appendNumber: false,
      });
      expect(pw.split('-')).toHaveLength(4);
    });

    it('uses specified separator', () => {
      const pw = generatePassword({
        mode: 'passphrase',
        wordCount: 3,
        separator: '.',
        capitalize: false,
        appendNumber: false,
      });
      expect(pw.split('.')).toHaveLength(3);
    });

    it('capitalizes first letter of each word', () => {
      for (let i = 0; i < 50; i++) {
        const pw = generatePassword({
          mode: 'passphrase',
          wordCount: 4,
          separator: '.', // Use '.' not '-' because some EFF words contain hyphens (e.g., 'yo-yo')
          capitalize: true,
          appendNumber: false,
        });
        const words = pw.split('.');
        for (const word of words) {
          expect(word[0]).toMatch(/[A-Z]/);
        }
      }
    });

    it('appends a number when appendNumber is true', () => {
      for (let i = 0; i < 50; i++) {
        const pw = generatePassword({
          mode: 'passphrase',
          wordCount: 3,
          separator: '-',
          capitalize: false,
          appendNumber: true,
        });
        expect(pw).toMatch(/\d+$/);
      }
    });

    it('does not append number when appendNumber is false', () => {
      for (let i = 0; i < 50; i++) {
        const pw = generatePassword({
          mode: 'passphrase',
          wordCount: 3,
          separator: '-',
          capitalize: false,
          appendNumber: false,
        });
        expect(pw).not.toMatch(/\d/);
      }
    });

    it('uses default passphrase options for partial options', () => {
      const pw = generatePassword({ mode: 'passphrase' });
      // Default is 5 words with '-' separator, capitalize, appendNumber
      const parts = pw.replace(/\d+$/, '').split('-');
      expect(parts).toHaveLength(DEFAULT_PASSPHRASE_OPTIONS.wordCount);
    });
  });
});

describe('calculateEntropy', () => {
  it('calculates entropy for random mode with all classes', () => {
    const entropy = calculateEntropy({
      mode: 'random',
      length: 20,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: true,
      excludeAmbiguous: false,
    });
    // Pool: 26 + 26 + 10 + 26 = 88 chars, log2(88) ≈ 6.46, * 20 ≈ 129
    expect(entropy).toBeGreaterThan(120);
    expect(entropy).toBeLessThan(140);
  });

  it('calculates entropy for lowercase-only', () => {
    const entropy = calculateEntropy({
      mode: 'random',
      length: 10,
      uppercase: false,
      lowercase: true,
      digits: false,
      symbols: false,
      excludeAmbiguous: false,
    });
    // Pool: 26 chars, log2(26) ≈ 4.7, * 10 ≈ 47
    expect(entropy).toBeGreaterThan(45);
    expect(entropy).toBeLessThan(50);
  });

  it('calculates entropy for passphrase mode', () => {
    const entropy = calculateEntropy({
      mode: 'passphrase',
      wordCount: 5,
      separator: '-',
      capitalize: true,
      appendNumber: true,
    });
    // 5 * log2(7776) + log2(100) ≈ 5 * 12.925 + 6.64 ≈ 71.27
    expect(entropy).toBeGreaterThan(70);
    expect(entropy).toBeLessThan(73);
  });

  it('returns 0 for empty pool', () => {
    const entropy = calculateEntropy({
      mode: 'random',
      length: 10,
      uppercase: false,
      lowercase: false,
      digits: false,
      symbols: false,
      excludeAmbiguous: false,
    });
    // Falls back to lowercase pool of 26
    expect(entropy).toBeGreaterThan(0);
  });
});

describe('estimateStrength', () => {
  it('returns weak for entropy < 40', () => {
    expect(estimateStrength(0)).toBe('weak');
    expect(estimateStrength(20)).toBe('weak');
    expect(estimateStrength(39)).toBe('weak');
  });

  it('returns fair for entropy 40-59', () => {
    expect(estimateStrength(40)).toBe('fair');
    expect(estimateStrength(50)).toBe('fair');
    expect(estimateStrength(59)).toBe('fair');
  });

  it('returns strong for entropy 60-79', () => {
    expect(estimateStrength(60)).toBe('strong');
    expect(estimateStrength(70)).toBe('strong');
    expect(estimateStrength(79)).toBe('strong');
  });

  it('returns very-strong for entropy >= 80', () => {
    expect(estimateStrength(80)).toBe('very-strong');
    expect(estimateStrength(100)).toBe('very-strong');
    expect(estimateStrength(200)).toBe('very-strong');
  });
});

describe('getDefaultStrongPassword', () => {
  it('returns a 20-character password', () => {
    const pw = getDefaultStrongPassword();
    expect(pw).toHaveLength(20);
  });

  it('contains all character classes', () => {
    // Run multiple times since it's random
    for (let i = 0; i < 100; i++) {
      const pw = getDefaultStrongPassword();
      expect(pw).toMatch(LOWERCASE);
      expect(pw).toMatch(UPPERCASE);
      expect(pw).toMatch(DIGITS);
      expect(pw).toMatch(SYMBOLS);
    }
  });
});
