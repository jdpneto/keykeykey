import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createVaultHeader,
  unlockVault,
  unlockVaultWithRecovery,
  changeMasterPassword,
  serializeVaultHeader,
  serializeVaultHeaderV1,
  deserializeVaultHeader,
} from './vault-header.js';

import { generateRecoveryKey } from './recovery.js';
import { VAULT_VERSION, SALT_SIZE, MANAGED_NONCE_OVERHEAD, KEY_SIZE } from './constants.js';
import type { Argon2Params } from './constants.js';

/** Fast test params — NOT for production. */
const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };

const MASTER_PASSWORD = 'correct-horse-battery-staple';

describe('createVaultHeader', () => {
  it('should create a valid vault header with correct version', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    expect(header.version).toBe(VAULT_VERSION);
    expect(header.masterSalt.length).toBe(SALT_SIZE);
    expect(header.recoverySalt.length).toBe(SALT_SIZE);
    expect(header.argon2Params).toEqual(TEST_PARAMS);
    expect(header.masterWrappedDEK.length).toBeGreaterThan(0);
    expect(header.recoveryWrappedDEK.length).toBeGreaterThan(0);
    expect(dek.length).toBe(32);
  });

  it('should include a vaultId (UUID v4) in the header', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);
    expect(header.vaultId).toBeDefined();
    expect(header.vaultId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should generate unique vaultIds for different vaults', async () => {
    const { raw: recoveryRaw1 } = generateRecoveryKey();
    const { raw: recoveryRaw2 } = generateRecoveryKey();
    const result1 = await createVaultHeader('password1', recoveryRaw1, TEST_PARAMS);
    const result2 = await createVaultHeader('password2', recoveryRaw2, TEST_PARAMS);
    expect(result1.header.vaultId).not.toBe(result2.header.vaultId);
  });

  it('should set version to 2', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);
    expect(header.version).toBe(2);
  });

  it('should generate distinct master and recovery salts', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    // Salts are random so should virtually never be equal
    expect(header.masterSalt).not.toEqual(header.recoverySalt);
  });
});

describe('unlockVault', () => {
  it('should unlock with correct master password', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const unlocked = await unlockVault(header, MASTER_PASSWORD);

    expect(unlocked).toEqual(dek);
  });

  it('should throw with wrong master password', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    await expect(unlockVault(header, 'wrong-password')).rejects.toThrow();
  });
});

describe('unlockVaultWithRecovery', () => {
  it('should unlock with correct formatted recovery key', async () => {
    const { raw: recoveryRaw, formatted: recoveryFormatted } = generateRecoveryKey();
    const { header, dek } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const unlocked = await unlockVaultWithRecovery(header, recoveryFormatted);

    expect(unlocked).toEqual(dek);
  });

  it('should throw with wrong recovery key', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const { formatted: otherRecovery } = generateRecoveryKey();
    await expect(unlockVaultWithRecovery(header, otherRecovery)).rejects.toThrow();
  });

  it('should return same DEK whether unlocked by password or recovery key', async () => {
    const { raw: recoveryRaw, formatted: recoveryFormatted } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const dekFromPassword = await unlockVault(header, MASTER_PASSWORD);
    const dekFromRecovery = await unlockVaultWithRecovery(header, recoveryFormatted);

    expect(dekFromPassword).toEqual(dekFromRecovery);
  });
});

describe('changeMasterPassword', () => {
  it('should allow unlock with new password after change', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const newPassword = 'new-master-password-2024';
    const newHeader = await changeMasterPassword(header, dek, newPassword);

    const unlocked = await unlockVault(newHeader, newPassword);
    expect(unlocked).toEqual(dek);
  });

  it('should reject the old password after change', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const newHeader = await changeMasterPassword(header, dek, 'new-password');

    await expect(unlockVault(newHeader, MASTER_PASSWORD)).rejects.toThrow();
  });

  it('should preserve recovery key wrapping after password change', async () => {
    const { raw: recoveryRaw, formatted: recoveryFormatted } = generateRecoveryKey();
    const { header, dek } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const newHeader = await changeMasterPassword(header, dek, 'new-password');

    const unlocked = await unlockVaultWithRecovery(newHeader, recoveryFormatted);
    expect(unlocked).toEqual(dek);
  });

  it('should allow upgrading Argon2 parameters', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const upgradedParams: Argon2Params = { t: 2, m: 512, p: 1, dkLen: 32 };
    const newHeader = await changeMasterPassword(header, dek, 'new-password', upgradedParams);

    expect(newHeader.argon2Params).toEqual(upgradedParams);
    const unlocked = await unlockVault(newHeader, 'new-password');
    expect(unlocked).toEqual(dek);
  });

  it('should preserve vaultId through changeMasterPassword', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const result = await createVaultHeader('old-pass', recoveryRaw, TEST_PARAMS);
    const newHeader = await changeMasterPassword(result.header, result.dek, 'new-pass');
    expect(newHeader.vaultId).toBe(result.header.vaultId);
  });

  it('should generate a new master salt on password change', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const newHeader = await changeMasterPassword(header, dek, 'another-password');

    expect(newHeader.masterSalt).not.toEqual(header.masterSalt);
  });
});

describe('serializeVaultHeader / deserializeVaultHeader', () => {
  it('should round-trip serialize → deserialize', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    const restored = deserializeVaultHeader(bytes);

    expect(restored.version).toBe(header.version);
    expect(restored.masterSalt).toEqual(header.masterSalt);
    expect(restored.recoverySalt).toEqual(header.recoverySalt);
    expect(restored.argon2Params).toEqual(header.argon2Params);
    expect(restored.masterWrappedDEK).toEqual(header.masterWrappedDEK);
    expect(restored.recoveryWrappedDEK).toEqual(header.recoveryWrappedDEK);
  });

  it('should produce deterministic output for the same header', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes1 = serializeVaultHeader(header);
    const bytes2 = serializeVaultHeader(header);

    expect(bytes1).toEqual(bytes2);
  });

  it('should still allow unlock after round-trip', async () => {
    const { raw: recoveryRaw, formatted: recoveryFormatted } = generateRecoveryKey();
    const { header, dek } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    const restored = deserializeVaultHeader(bytes);

    // Both unlock methods should work
    expect(await unlockVault(restored, MASTER_PASSWORD)).toEqual(dek);
    expect(await unlockVaultWithRecovery(restored, recoveryFormatted)).toEqual(dek);
  });

  it('should throw on empty bytes', () => {
    expect(() => deserializeVaultHeader(new Uint8Array(0))).toThrow('empty');
  });

  it('should throw on unsupported version', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    bytes[0] = 99; // bad version

    expect(() => deserializeVaultHeader(bytes)).toThrow('Unsupported vault version');
  });

  it('should throw on truncated data', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    const truncated = bytes.slice(0, 20); // way too short

    expect(() => deserializeVaultHeader(truncated)).toThrow('too short');
  });

  it('should throw when truncated at masterWrappedDEK length', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    // v2: 1 (version) + 1 (vaultId len) + vaultId.length + 16 (masterSalt) + 16 (recoverySalt) + 16 (argon2 params)
    const vaultIdLen = new TextEncoder().encode(header.vaultId).length;
    const cutPoint = 1 + 1 + vaultIdLen + SALT_SIZE + SALT_SIZE + 16;
    const truncated = bytes.slice(0, cutPoint);

    expect(() => deserializeVaultHeader(truncated)).toThrow('truncated at masterWrappedDEK length');
  });

  it('should throw when truncated at masterWrappedDEK data', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    const vaultIdLen = new TextEncoder().encode(header.vaultId).length;
    // Cut after master length prefix but before all master data
    const cutPoint = 1 + 1 + vaultIdLen + SALT_SIZE + SALT_SIZE + 16 + 2 + 1; // only 1 byte of master data
    const truncated = bytes.slice(0, cutPoint);

    expect(() => deserializeVaultHeader(truncated)).toThrow('truncated at masterWrappedDEK data');
  });

  it('should throw when truncated at recoveryWrappedDEK length', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    const vaultIdLen = new TextEncoder().encode(header.vaultId).length;
    const masterLen = header.masterWrappedDEK.length;
    const cutPoint = 1 + 1 + vaultIdLen + SALT_SIZE + SALT_SIZE + 16 + 2 + masterLen;
    const truncated = bytes.slice(0, cutPoint);

    expect(() => deserializeVaultHeader(truncated)).toThrow(
      'truncated at recoveryWrappedDEK length',
    );
  });

  it('should throw when truncated at recoveryWrappedDEK data', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    const vaultIdLen = new TextEncoder().encode(header.vaultId).length;
    const masterLen = header.masterWrappedDEK.length;
    const cutPoint = 1 + 1 + vaultIdLen + SALT_SIZE + SALT_SIZE + 16 + 2 + masterLen + 2 + 1;
    const truncated = bytes.slice(0, cutPoint);

    expect(() => deserializeVaultHeader(truncated)).toThrow('truncated at recoveryWrappedDEK data');
  });
});

describe('v2 serialization', () => {
  it('should round-trip vaultId through serialize/deserialize', async () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    const restored = deserializeVaultHeader(bytes);

    expect(restored.vaultId).toBe(header.vaultId);
    expect(restored.vaultId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should deserialize v1 headers and generate a random UUID vaultId', () => {
    const header = {
      version: 2, // version field is ignored by serializeVaultHeaderV1; it writes 1
      vaultId: 'ignored',
      masterSalt: new Uint8Array(SALT_SIZE).fill(0xaa),
      recoverySalt: new Uint8Array(SALT_SIZE).fill(0xbb),
      argon2Params: TEST_PARAMS,
      masterWrappedDEK: new Uint8Array(KEY_SIZE + MANAGED_NONCE_OVERHEAD).fill(0x11),
      recoveryWrappedDEK: new Uint8Array(KEY_SIZE + MANAGED_NONCE_OVERHEAD).fill(0x22),
    };

    const v1Bytes = serializeVaultHeaderV1(header);
    // First byte should be 1
    expect(v1Bytes[0]).toBe(1);

    const restored = deserializeVaultHeader(v1Bytes);
    expect(restored.version).toBe(1);
    // Should have generated a UUID v4
    expect(restored.vaultId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    // Other fields should match
    expect(restored.masterSalt).toEqual(header.masterSalt);
    expect(restored.recoverySalt).toEqual(header.recoverySalt);
    expect(restored.argon2Params).toEqual(header.argon2Params);
    expect(restored.masterWrappedDEK).toEqual(header.masterWrappedDEK);
    expect(restored.recoveryWrappedDEK).toEqual(header.recoveryWrappedDEK);
  });

  it('should generate different vaultIds on repeated v1 deserialization', () => {
    const header = {
      version: 2,
      vaultId: 'ignored',
      masterSalt: new Uint8Array(SALT_SIZE).fill(0xaa),
      recoverySalt: new Uint8Array(SALT_SIZE).fill(0xbb),
      argon2Params: TEST_PARAMS,
      masterWrappedDEK: new Uint8Array(KEY_SIZE + MANAGED_NONCE_OVERHEAD).fill(0x11),
      recoveryWrappedDEK: new Uint8Array(KEY_SIZE + MANAGED_NONCE_OVERHEAD).fill(0x22),
    };

    const v1Bytes = serializeVaultHeaderV1(header);
    const restored1 = deserializeVaultHeader(v1Bytes);
    const restored2 = deserializeVaultHeader(v1Bytes);

    expect(restored1.vaultId).not.toBe(restored2.vaultId);
  });

  it('should reject v2 header with empty vaultId', () => {
    // Craft a v2 binary with vaultId length = 0
    const header = {
      version: 2,
      vaultId: '', // empty
      masterSalt: new Uint8Array(SALT_SIZE).fill(0xaa),
      recoverySalt: new Uint8Array(SALT_SIZE).fill(0xbb),
      argon2Params: TEST_PARAMS,
      masterWrappedDEK: new Uint8Array(KEY_SIZE + MANAGED_NONCE_OVERHEAD).fill(0x11),
      recoveryWrappedDEK: new Uint8Array(KEY_SIZE + MANAGED_NONCE_OVERHEAD).fill(0x22),
    };

    // Manually craft a v2 binary with length byte 0
    const masterLen = header.masterWrappedDEK.length;
    const recoveryLen = header.recoveryWrappedDEK.length;
    const totalSize = 1 + 1 + 0 + SALT_SIZE + SALT_SIZE + 16 + 2 + masterLen + 2 + recoveryLen;
    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer);
    let offset = 0;
    buffer[offset] = 2; // version
    offset += 1;
    buffer[offset] = 0; // vaultId length = 0
    offset += 1;
    // rest doesn't matter - should fail before reading it

    expect(() => deserializeVaultHeader(buffer)).toThrow('vaultId');
  });

  it('property: round-trip any valid header with vaultId', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uint8Array({ minLength: SALT_SIZE, maxLength: SALT_SIZE }),
        fc.uint8Array({ minLength: SALT_SIZE, maxLength: SALT_SIZE }),
        fc.uint8Array({
          minLength: KEY_SIZE + MANAGED_NONCE_OVERHEAD,
          maxLength: KEY_SIZE + MANAGED_NONCE_OVERHEAD,
        }),
        fc.uint8Array({
          minLength: KEY_SIZE + MANAGED_NONCE_OVERHEAD,
          maxLength: KEY_SIZE + MANAGED_NONCE_OVERHEAD,
        }),
        (vaultId, masterSalt, recoverySalt, masterWrappedDEK, recoveryWrappedDEK) => {
          const header = {
            version: VAULT_VERSION,
            vaultId,
            masterSalt,
            recoverySalt,
            argon2Params: TEST_PARAMS,
            masterWrappedDEK,
            recoveryWrappedDEK,
          };

          const bytes = serializeVaultHeader(header);
          const restored = deserializeVaultHeader(bytes);

          expect(restored.vaultId).toBe(header.vaultId);
          expect(restored.version).toBe(header.version);
          expect(restored.masterSalt).toEqual(header.masterSalt);
          expect(restored.recoverySalt).toEqual(header.recoverySalt);
          expect(restored.argon2Params).toEqual(header.argon2Params);
          expect(restored.masterWrappedDEK).toEqual(header.masterWrappedDEK);
          expect(restored.recoveryWrappedDEK).toEqual(header.recoveryWrappedDEK);
        },
      ),
      { numRuns: 50 },
    );
  });
});
