import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { decryptItems } from './vault-decryptor.js';
import { encrypt } from '../crypto/encryption.js';
import type { VaultItem } from '../models/vault-item.js';

function makeCredential(name = 'Test'): VaultItem {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    type: 'credential',
    name,
    tags: [],
    favorite: false,
    username: 'user@example.com',
    password: 'secret',
    url: 'https://example.com',
    createdAt: now,
    updatedAt: now,
  };
}

function encryptItem(item: VaultItem, dek: Uint8Array): Uint8Array {
  return encrypt(new TextEncoder().encode(JSON.stringify(item)), dek);
}

describe('decryptItems', () => {
  const dek = new Uint8Array(32).fill(7);

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns all items when every ciphertext round-trips', () => {
    const items = [makeCredential('A'), makeCredential('B'), makeCredential('C')];
    const enc = items.map((i) => encryptItem(i, dek));

    const result = decryptItems(dek, enc);
    expect(result.map((i) => i.name)).toEqual(['A', 'B', 'C']);
  });

  it('skips one corrupted ciphertext and returns the rest (silent-skip is by design)', () => {
    const good1 = encryptItem(makeCredential('good1'), dek);
    const good2 = encryptItem(makeCredential('good2'), dek);
    const tampered = encryptItem(makeCredential('tampered'), dek);
    // Flip a byte inside the auth-tag region — Poly1305 verification will fail.
    tampered[tampered.length - 1] ^= 0xff;

    const result = decryptItems(dek, [good1, tampered, good2]);
    expect(result.map((i) => i.name)).toEqual(['good1', 'good2']);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('returns [] when every ciphertext is corrupted', () => {
    const enc = [encryptItem(makeCredential('a'), dek), encryptItem(makeCredential('b'), dek)];
    enc.forEach((b) => {
      b[b.length - 1] ^= 0xff;
    });

    expect(decryptItems(dek, enc)).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('skips ciphertexts whose plaintext is not valid JSON', () => {
    const malformed = encrypt(new TextEncoder().encode('{not json'), dek);
    const good = encryptItem(makeCredential('good'), dek);

    const result = decryptItems(dek, [malformed, good]);
    expect(result.map((i) => i.name)).toEqual(['good']);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('skips ciphertexts whose JSON does not match the VaultItem schema', () => {
    const bogus = encrypt(
      new TextEncoder().encode(JSON.stringify({ type: 'credential', missing: 'fields' })),
      dek,
    );
    const good = encryptItem(makeCredential('good'), dek);

    const result = decryptItems(dek, [bogus, good]);
    expect(result.map((i) => i.name)).toEqual(['good']);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('returns [] for an empty input', () => {
    expect(decryptItems(dek, [])).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
