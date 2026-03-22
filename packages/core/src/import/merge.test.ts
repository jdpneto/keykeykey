import { describe, it, expect } from 'vitest';
import { findDuplicates, normalizeUrl } from './merge.js';
import type { VaultItem } from '../models/vault-item.js';

const cred = (overrides: Record<string, unknown> = {}): VaultItem => ({
  type: 'credential',
  id: 'id-1',
  name: 'Test',
  username: 'user@test.com',
  password: 'pass123',
  url: 'https://example.com',
  tags: [],
  favorite: false,
  passwordHistory: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
} as VaultItem);

const card = (overrides: Record<string, unknown> = {}): VaultItem => ({
  type: 'card',
  id: 'card-1',
  name: 'Visa',
  cardholderName: 'John Doe',
  number: '4111111111111111',
  expirationMonth: 12,
  expirationYear: 2027,
  cvv: '123',
  tags: [],
  favorite: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
} as VaultItem);

const note = (overrides: Record<string, unknown> = {}): VaultItem => ({
  type: 'secure-note',
  id: 'note-1',
  name: 'My Note',
  content: 'secret stuff',
  tags: [],
  favorite: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
} as VaultItem);

describe('normalizeUrl', () => {
  it('lowercases hostname', () => {
    expect(normalizeUrl('https://Example.COM/path')).toBe('https://example.com/path');
  });
  it('strips trailing slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
  });
  it('strips www prefix', () => {
    expect(normalizeUrl('https://www.example.com')).toBe('https://example.com');
  });
  it('handles all normalizations together', () => {
    expect(normalizeUrl('https://WWW.Example.COM/')).toBe('https://example.com');
  });
  it('returns empty string for undefined/empty', () => {
    expect(normalizeUrl(undefined)).toBe('');
    expect(normalizeUrl('')).toBe('');
  });
  it('returns original for non-URL strings', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('findDuplicates', () => {
  it('detects credential duplicates by username + password + url', () => {
    const result = findDuplicates([cred({ id: 'id-2' })], [cred()]);
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });
  it('imports credentials with different passwords', () => {
    const result = findDuplicates([cred({ id: 'id-2', password: 'different' })], [cred()]);
    expect(result.toImport).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });
  it('normalizes URLs for credential matching', () => {
    const result = findDuplicates(
      [cred({ id: 'id-2', url: 'https://example.com' })],
      [cred({ url: 'https://www.Example.com/' })],
    );
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });
  it('detects card duplicates by cardholderName + number', () => {
    const result = findDuplicates([card({ id: 'card-2' })], [card()]);
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });
  it('imports cards with different numbers', () => {
    const result = findDuplicates([card({ id: 'card-2', number: '5555555555554444' })], [card()]);
    expect(result.toImport).toHaveLength(1);
  });
  it('detects secure note duplicates by name + content', () => {
    const result = findDuplicates([note({ id: 'note-2' })], [note()]);
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });
  it('imports notes with different content', () => {
    const result = findDuplicates([note({ id: 'note-2', content: 'different' })], [note()]);
    expect(result.toImport).toHaveLength(1);
  });
  it('handles mixed types correctly', () => {
    const result = findDuplicates([cred({ id: 'id-2' }), card(), note()], [cred()]);
    expect(result.toImport).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
  });
  it('handles empty incoming', () => {
    const result = findDuplicates([], [cred()]);
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
  it('handles empty existing', () => {
    const result = findDuplicates([cred(), card()], []);
    expect(result.toImport).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });
});
