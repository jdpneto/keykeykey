import { describe, it, expect } from 'vitest';
import { rebuildAfterRestore } from './password-history.js';

describe('rebuildAfterRestore', () => {
  const NOW = '2026-04-26T10:00:00.000Z';

  it('moves the chosen entry out and appends current to the end', () => {
    const history = [
      { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
      { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
      { password: 'p3', changedAt: '2026-04-22T10:00:00.000Z' },
    ];
    const result = rebuildAfterRestore('current', history, 0, NOW);

    expect(result).not.toBeNull();
    expect(result!.password).toBe('p1');
    expect(result!.passwordHistory).toEqual([
      { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
      { password: 'p3', changedAt: '2026-04-22T10:00:00.000Z' },
      { password: 'current', changedAt: NOW },
    ]);
  });

  it('keeps history length unchanged', () => {
    const history = [
      { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
      { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
    ];
    const result = rebuildAfterRestore('current', history, 1, NOW);
    expect(result!.passwordHistory).toHaveLength(2);
  });

  it('returns null (no-op) when chosen entry equals current', () => {
    const history = [
      { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
      { password: 'same', changedAt: '2026-04-21T10:00:00.000Z' },
    ];
    const result = rebuildAfterRestore('same', history, 1, NOW);
    expect(result).toBeNull();
  });

  it('throws on negative historyIndex', () => {
    const history = [{ password: 'p1', changedAt: NOW }];
    expect(() => rebuildAfterRestore('current', history, -1, NOW)).toThrow(/index out of range/i);
  });

  it('throws on out-of-range historyIndex', () => {
    const history = [{ password: 'p1', changedAt: NOW }];
    expect(() => rebuildAfterRestore('current', history, 1, NOW)).toThrow(/index out of range/i);
  });

  it('throws on empty history', () => {
    expect(() => rebuildAfterRestore('current', [], 0, NOW)).toThrow(/index out of range/i);
  });
});
