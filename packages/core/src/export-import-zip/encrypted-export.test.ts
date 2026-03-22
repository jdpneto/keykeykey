import { describe, it, expect } from 'vitest';
import { exportEncryptedBackup, BACKUP_PREAMBLE_SIZE } from './encrypted-export.js';

describe('exportEncryptedBackup', () => {
  const vaultFiles = new Map<string, Uint8Array>([
    ['vault.enc', new Uint8Array([1, 2, 3, 4, 5])],
    ['items/id-1', new Uint8Array([10, 20, 30])],
    ['items/id-2', new Uint8Array([40, 50, 60])],
  ]);

  it('produces a Uint8Array with preamble', async () => {
    const result = await exportEncryptedBackup(vaultFiles, 'test-password');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(BACKUP_PREAMBLE_SIZE);
  });

  it('produces different output for different passwords', async () => {
    const a = await exportEncryptedBackup(vaultFiles, 'password-a');
    const b = await exportEncryptedBackup(vaultFiles, 'password-b');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('produces different output each time (random salt)', async () => {
    const a = await exportEncryptedBackup(vaultFiles, 'same-password');
    const b = await exportEncryptedBackup(vaultFiles, 'same-password');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
