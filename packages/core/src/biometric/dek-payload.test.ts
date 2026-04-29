import { describe, it, expect } from 'vitest';
import { MAX_DEK_AGE_MS, encodeDEKPayload, decodeDEKPayload, isExpired } from './dek-payload.js';

describe('encodeDEKPayload / decodeDEKPayload', () => {
  it('round-trips a DEK + ISO timestamp', () => {
    const dek = new Uint8Array([1, 2, 3, 4, 5]);
    const now = new Date('2026-04-29T12:00:00.000Z');
    const raw = encodeDEKPayload(dek, now);
    const decoded = decodeDEKPayload(raw);
    expect(Array.from(decoded.dek)).toEqual([1, 2, 3, 4, 5]);
    expect(decoded.savedAt).toBe('2026-04-29T12:00:00.000Z');
  });

  it('decode throws on malformed JSON', () => {
    expect(() => decodeDEKPayload('not json')).toThrow();
  });

  it('decode throws on missing fields', () => {
    expect(() => decodeDEKPayload(JSON.stringify({ dek: 'AAA=' }))).toThrow('Malformed');
    expect(() => decodeDEKPayload(JSON.stringify({ savedAt: '2026-01-01T00:00:00Z' }))).toThrow(
      'Malformed',
    );
  });

  it('decode throws on wrong-typed fields', () => {
    expect(() => decodeDEKPayload(JSON.stringify({ dek: 1, savedAt: 's' }))).toThrow('Malformed');
  });

  it('encoded value is JSON with both fields', () => {
    const raw = encodeDEKPayload(new Uint8Array([0]), new Date('2026-01-01T00:00:00.000Z'));
    const obj = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(obj).sort()).toEqual(['dek', 'savedAt']);
  });
});

describe('isExpired', () => {
  const NOW = new Date('2026-04-29T12:00:00.000Z').getTime();

  it('returns false for a fresh timestamp', () => {
    expect(isExpired('2026-04-29T11:59:00.000Z', NOW)).toBe(false);
  });

  it('returns false for a timestamp exactly 14 days old (boundary)', () => {
    const fourteenDaysAgo = new Date(NOW - MAX_DEK_AGE_MS).toISOString();
    expect(isExpired(fourteenDaysAgo, NOW)).toBe(false);
  });

  it('returns true for a timestamp older than 14 days by a millisecond', () => {
    const justOver = new Date(NOW - MAX_DEK_AGE_MS - 1).toISOString();
    expect(isExpired(justOver, NOW)).toBe(true);
  });

  it('returns true for an unparseable timestamp', () => {
    expect(isExpired('not-a-date', NOW)).toBe(true);
  });
});
