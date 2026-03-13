import { EFF_WORDLIST } from './wordlist.js';
import type {
  PasswordGeneratorOptions,
  PasswordStrength,
  RandomOptions,
  PassphraseOptions,
} from './types.js';
import { DEFAULT_RANDOM_OPTIONS, DEFAULT_PASSPHRASE_OPTIONS } from './types.js';

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';

const AMBIGUOUS = 'O0oIl1';

function secureRandomInt(max: number): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // Rejection sampling to avoid modulo bias
  const limit = Math.floor(0xffffffff / max) * max;
  let value = array[0]!;
  while (value >= limit) {
    crypto.getRandomValues(array);
    value = array[0]!;
  }
  return value % max;
}

function buildCharPool(options: RandomOptions): string {
  let pool = '';
  if (options.lowercase) pool += LOWERCASE;
  if (options.uppercase) pool += UPPERCASE;
  if (options.digits) pool += DIGITS;
  if (options.symbols) pool += SYMBOLS;

  if (options.excludeAmbiguous) {
    pool = pool
      .split('')
      .filter((c) => !AMBIGUOUS.includes(c))
      .join('');
  }

  if (pool.length === 0) {
    // Fallback to lowercase if nothing enabled
    pool = LOWERCASE;
  }

  return pool;
}

function getEnabledClasses(options: RandomOptions): string[] {
  const classes: string[] = [];
  let lower = LOWERCASE;
  let upper = UPPERCASE;
  let digits = DIGITS;
  const symbols = SYMBOLS;

  if (options.excludeAmbiguous) {
    lower = lower
      .split('')
      .filter((c) => !AMBIGUOUS.includes(c))
      .join('');
    upper = upper
      .split('')
      .filter((c) => !AMBIGUOUS.includes(c))
      .join('');
    digits = digits
      .split('')
      .filter((c) => !AMBIGUOUS.includes(c))
      .join('');
  }

  if (options.lowercase) classes.push(lower);
  if (options.uppercase) classes.push(upper);
  if (options.digits) classes.push(digits);
  if (options.symbols) classes.push(symbols);

  return classes;
}

function generateRandom(options: RandomOptions): string {
  const pool = buildCharPool(options);
  const classes = getEnabledClasses(options);

  // Rejection sampling: generate until password contains at least one char from each enabled class
  for (let attempt = 0; attempt < 1000; attempt++) {
    let password = '';
    for (let i = 0; i < options.length; i++) {
      password += pool[secureRandomInt(pool.length)];
    }

    // Check all classes are represented
    const allClassesMet = classes.every((cls) => password.split('').some((c) => cls.includes(c)));

    if (allClassesMet || classes.length <= 1) {
      return password;
    }
  }

  // Fallback: force one char from each class into random positions
  const chars: string[] = [];
  for (let i = 0; i < options.length; i++) {
    chars.push(pool[secureRandomInt(pool.length)]!);
  }
  for (let i = 0; i < classes.length && i < options.length; i++) {
    const cls = classes[i]!;
    chars[i] = cls[secureRandomInt(cls.length)]!;
  }
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

function generatePassphrase(options: PassphraseOptions): string {
  const words: string[] = [];
  for (let i = 0; i < options.wordCount; i++) {
    let word = EFF_WORDLIST[secureRandomInt(EFF_WORDLIST.length)]!;
    if (options.capitalize) {
      word = word.charAt(0).toUpperCase() + word.slice(1);
    }
    words.push(word);
  }

  let result = words.join(options.separator);

  if (options.appendNumber) {
    result += secureRandomInt(100).toString();
  }

  return result;
}

/**
 * Generate a password using the specified options.
 * Defaults to random mode with DEFAULT_RANDOM_OPTIONS.
 */
export function generatePassword(options?: Partial<PasswordGeneratorOptions>): string {
  if (!options || !('mode' in options) || options.mode === 'random') {
    const merged: RandomOptions = {
      ...DEFAULT_RANDOM_OPTIONS,
      ...(options as Partial<RandomOptions>),
      mode: 'random',
    };
    return generateRandom(merged);
  }

  const merged: PassphraseOptions = {
    ...DEFAULT_PASSPHRASE_OPTIONS,
    ...(options as Partial<PassphraseOptions>),
    mode: 'passphrase',
  };
  return generatePassphrase(merged);
}

/**
 * Calculate entropy in bits for the given generator options.
 */
export function calculateEntropy(options: PasswordGeneratorOptions): number {
  if (options.mode === 'random') {
    const poolSize = buildCharPool(options).length;
    if (poolSize <= 1) return 0;
    return Math.round(options.length * Math.log2(poolSize) * 100) / 100;
  }

  // Passphrase: each word chosen from 7,776 words = log2(7776) ≈ 12.925 bits
  const bitsPerWord = Math.log2(EFF_WORDLIST.length);
  let bits = options.wordCount * bitsPerWord;

  if (options.appendNumber) {
    bits += Math.log2(100); // ~6.64 bits
  }

  return Math.round(bits * 100) / 100;
}

/**
 * Estimate password strength from entropy bits.
 */
export function estimateStrength(entropy: number): PasswordStrength {
  if (entropy < 40) return 'weak';
  if (entropy < 60) return 'fair';
  if (entropy < 80) return 'strong';
  return 'very-strong';
}

/**
 * Convenience function: generate a strong 20-character random password
 * with all character classes enabled.
 */
export function getDefaultStrongPassword(): string {
  return generatePassword(DEFAULT_RANDOM_OPTIONS);
}
