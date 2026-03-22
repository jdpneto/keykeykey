import { describe, it, expect } from 'vitest';
import { exportToCsv } from './exporter.js';
import { parseCsv } from '../import/csv-parser.js';
import type { VaultItem } from '../models/vault-item.js';

const credential = (overrides: Partial<VaultItem & { type: 'credential' }> = {}): VaultItem => ({
  type: 'credential',
  id: 'test-id-1',
  name: 'Example',
  username: 'user@test.com',
  password: 'secret123',
  url: 'https://example.com',
  notes: 'my note',
  totp: '',
  tags: [],
  favorite: false,
  passwordHistory: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('exportToCsv', () => {
  it('exports credentials with correct headers', () => {
    const csv = exportToCsv([credential()]);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.headers).toEqual([
      'name', 'url', 'username', 'password', 'notes', 'totp', 'folder', 'favorite',
    ]);
  });

  it('maps credential fields correctly', () => {
    const csv = exportToCsv([credential()]);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.rows[0]).toEqual([
      'Example', 'https://example.com', 'user@test.com', 'secret123', 'my note', '', '', 'false',
    ]);
  });

  it('filters out non-credential items', () => {
    const items: VaultItem[] = [
      credential(),
      {
        type: 'card',
        id: 'card-1',
        name: 'Visa',
        cardholderName: 'John',
        number: '4111111111111111',
        expirationMonth: 12,
        expirationYear: 2027,
        cvv: '123',
        tags: [],
        favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        type: 'secure-note',
        id: 'note-1',
        name: 'Secret',
        content: 'hidden',
        tags: [],
        favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const csv = exportToCsv(items);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]![0]).toBe('Example');
  });

  it('serializes tags as semicolon-delimited folder', () => {
    const csv = exportToCsv([credential({ tags: ['work', 'banking'] })]);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.rows[0]![6]).toBe('work;banking');
  });

  it('serializes favorite as string', () => {
    const csv = exportToCsv([credential({ favorite: true })]);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.rows[0]![7]).toBe('true');
  });

  it('excludes passwordHistory', () => {
    const csv = exportToCsv([credential({
      passwordHistory: [{ password: 'prev-secret-xyz', changedAt: '2026-01-01T00:00:00.000Z' }],
    })]);
    expect(csv).not.toContain('prev-secret-xyz');
    expect(csv).not.toContain('passwordHistory');
  });

  it('handles empty items array', () => {
    const csv = exportToCsv([]);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.headers).toHaveLength(8);
    expect(parsed.rows).toHaveLength(0);
  });

  it('excludes appIdentifiers from output', () => {
    const csv = exportToCsv([credential({
      appIdentifiers: ['com.example.app'],
    })]);
    expect(csv).not.toContain('appIdentifiers');
    expect(csv).not.toContain('com.example.app');
  });

  it('handles undefined optional fields', () => {
    const csv = exportToCsv([credential({ url: undefined, notes: undefined, totp: undefined })]);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.rows[0]![1]).toBe('');
    expect(parsed.rows[0]![4]).toBe('');
    expect(parsed.rows[0]![5]).toBe('');
  });
});
