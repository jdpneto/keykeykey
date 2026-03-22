import { describe, it, expect } from 'vitest';
import { importEncryptedBackup } from './encrypted-import.js';
import { exportEncryptedBackup } from './encrypted-export.js';

describe('importEncryptedBackup', { timeout: 30_000 }, () => {
  const vaultFiles = new Map<string, Uint8Array>([
    ['vault.enc', new Uint8Array([1, 2, 3, 4, 5])],
    ['items/id-1', new Uint8Array([10, 20, 30])],
    ['items/id-2', new Uint8Array([40, 50, 60])],
  ]);

  it('round-trips vault files through export → import', async () => {
    const encrypted = await exportEncryptedBackup(vaultFiles, 'my-password');
    const restored = await importEncryptedBackup(encrypted, 'my-password');
    expect(restored.size).toBe(3);
    expect(Buffer.from(restored.get('vault.enc')!)).toEqual(
      Buffer.from(vaultFiles.get('vault.enc')!),
    );
    expect(Buffer.from(restored.get('items/id-1')!)).toEqual(
      Buffer.from(vaultFiles.get('items/id-1')!),
    );
    expect(Buffer.from(restored.get('items/id-2')!)).toEqual(
      Buffer.from(vaultFiles.get('items/id-2')!),
    );
  });

  it('throws on wrong password', async () => {
    const encrypted = await exportEncryptedBackup(vaultFiles, 'correct');
    await expect(importEncryptedBackup(encrypted, 'wrong')).rejects.toThrow();
  });

  it('throws on truncated data', async () => {
    const encrypted = await exportEncryptedBackup(vaultFiles, 'pass');
    const truncated = encrypted.slice(0, 16);
    await expect(importEncryptedBackup(truncated, 'pass')).rejects.toThrow();
  });

  it('throws on invalid Argon2 params in preamble', async () => {
    const encrypted = await exportEncryptedBackup(vaultFiles, 'pass');
    // Tamper with memory param (offset 20) to exceed max
    const tampered = new Uint8Array(encrypted);
    const view = new DataView(tampered.buffer, tampered.byteOffset, tampered.byteLength);
    view.setUint32(20, 999_999_999, true); // m way too high
    await expect(importEncryptedBackup(tampered, 'pass')).rejects.toThrow('Argon2 m');
  });
});
