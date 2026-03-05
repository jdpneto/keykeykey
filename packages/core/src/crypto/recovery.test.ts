import { describe, it, expect } from 'vitest';
import { generateRecoveryKey, parseRecoveryKey } from './recovery.js';
import { RECOVERY_KEY_BYTES } from './constants.js';

describe('generateRecoveryKey', () => {
  it('should produce a raw key of RECOVERY_KEY_BYTES length', () => {
    const { raw } = generateRecoveryKey();
    expect(raw).toBeInstanceOf(Uint8Array);
    expect(raw.length).toBe(RECOVERY_KEY_BYTES);
  });

  it('should produce a formatted string with dashes', () => {
    const { formatted } = generateRecoveryKey();
    expect(formatted).toMatch(/^[A-Z2-7]+(-[A-Z2-7]+)+$/);
    expect(formatted).toContain('-');
  });

  it('should produce unique keys each call', () => {
    const key1 = generateRecoveryKey();
    const key2 = generateRecoveryKey();
    expect(key1.raw).not.toEqual(key2.raw);
    expect(key1.formatted).not.toBe(key2.formatted);
  });

  it('should produce groups of 5 characters separated by dashes', () => {
    const { formatted } = generateRecoveryKey();
    const groups = formatted.split('-');
    // All groups except possibly the last should be 5 chars
    for (let i = 0; i < groups.length - 1; i++) {
      expect(groups[i]!.length).toBe(5);
    }
    // Last group can be 1-5 chars
    expect(groups[groups.length - 1]!.length).toBeGreaterThanOrEqual(1);
    expect(groups[groups.length - 1]!.length).toBeLessThanOrEqual(5);
  });
});

describe('parseRecoveryKey', () => {
  it('should round-trip generate → parse', () => {
    const { raw, formatted } = generateRecoveryKey();
    const parsed = parseRecoveryKey(formatted);
    expect(parsed).toEqual(raw);
  });

  it('should accept lowercase input', () => {
    const { raw, formatted } = generateRecoveryKey();
    const parsed = parseRecoveryKey(formatted.toLowerCase());
    expect(parsed).toEqual(raw);
  });

  it('should accept input without dashes', () => {
    const { raw, formatted } = generateRecoveryKey();
    const noDashes = formatted.replace(/-/g, '');
    const parsed = parseRecoveryKey(noDashes);
    expect(parsed).toEqual(raw);
  });

  it('should accept input with extra whitespace', () => {
    const { raw, formatted } = generateRecoveryKey();
    const spaced = ' ' + formatted.replace(/-/g, ' - ') + ' ';
    const parsed = parseRecoveryKey(spaced);
    expect(parsed).toEqual(raw);
  });

  it('should throw on empty input', () => {
    expect(() => parseRecoveryKey('')).toThrow('Recovery key cannot be empty');
  });

  it('should throw on invalid Base32 characters', () => {
    expect(() => parseRecoveryKey('ABCDE-01890')).toThrow('Invalid Base32 character');
  });

  it('should throw on wrong decoded length', () => {
    // 5 Base32 chars → 3 bytes (not 16)
    expect(() => parseRecoveryKey('AAAAA')).toThrow(
      `Recovery key must decode to ${RECOVERY_KEY_BYTES} bytes`,
    );
  });

  it('should throw on dashes-only input', () => {
    expect(() => parseRecoveryKey('---')).toThrow('Recovery key cannot be empty');
  });
});
