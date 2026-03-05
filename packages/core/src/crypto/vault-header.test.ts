import { describe, it, expect } from 'vitest';
import {
  createVaultHeader,
  unlockVault,
  unlockVaultWithRecovery,
  changeMasterPassword,
  serializeVaultHeader,
  deserializeVaultHeader,
} from './vault-header.js';

import { generateRecoveryKey } from './recovery.js';
import { VAULT_VERSION, SALT_SIZE } from './constants.js';
import type { Argon2Params } from './constants.js';

/** Fast test params — NOT for production. */
const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };

const MASTER_PASSWORD = 'correct-horse-battery-staple';

describe('createVaultHeader', () => {
  it('should create a valid vault header with correct version', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    expect(header.version).toBe(VAULT_VERSION);
    expect(header.masterSalt.length).toBe(SALT_SIZE);
    expect(header.recoverySalt.length).toBe(SALT_SIZE);
    expect(header.argon2Params).toEqual(TEST_PARAMS);
    expect(header.masterWrappedDEK.length).toBeGreaterThan(0);
    expect(header.recoveryWrappedDEK.length).toBeGreaterThan(0);
    expect(dek.length).toBe(32);
  });

  it('should generate distinct master and recovery salts', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    // Salts are random so should virtually never be equal
    expect(header.masterSalt).not.toEqual(header.recoverySalt);
  });
});

describe('unlockVault', () => {
  it('should unlock with correct master password', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const unlocked = unlockVault(header, MASTER_PASSWORD);

    expect(unlocked).toEqual(dek);
  });

  it('should throw with wrong master password', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    expect(() => unlockVault(header, 'wrong-password')).toThrow();
  });
});

describe('unlockVaultWithRecovery', () => {
  it('should unlock with correct formatted recovery key', () => {
    const { raw: recoveryRaw, formatted: recoveryFormatted } = generateRecoveryKey();
    const { header, dek } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const unlocked = unlockVaultWithRecovery(header, recoveryFormatted);

    expect(unlocked).toEqual(dek);
  });

  it('should throw with wrong recovery key', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const { formatted: otherRecovery } = generateRecoveryKey();
    expect(() => unlockVaultWithRecovery(header, otherRecovery)).toThrow();
  });

  it('should return same DEK whether unlocked by password or recovery key', () => {
    const { raw: recoveryRaw, formatted: recoveryFormatted } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const dekFromPassword = unlockVault(header, MASTER_PASSWORD);
    const dekFromRecovery = unlockVaultWithRecovery(header, recoveryFormatted);

    expect(dekFromPassword).toEqual(dekFromRecovery);
  });
});

describe('changeMasterPassword', () => {
  it('should allow unlock with new password after change', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const newPassword = 'new-master-password-2024';
    const newHeader = changeMasterPassword(header, dek, newPassword);

    const unlocked = unlockVault(newHeader, newPassword);
    expect(unlocked).toEqual(dek);
  });

  it('should reject the old password after change', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const newHeader = changeMasterPassword(header, dek, 'new-password');

    expect(() => unlockVault(newHeader, MASTER_PASSWORD)).toThrow();
  });

  it('should preserve recovery key wrapping after password change', () => {
    const { raw: recoveryRaw, formatted: recoveryFormatted } = generateRecoveryKey();
    const { header, dek } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const newHeader = changeMasterPassword(header, dek, 'new-password');

    const unlocked = unlockVaultWithRecovery(newHeader, recoveryFormatted);
    expect(unlocked).toEqual(dek);
  });

  it('should allow upgrading Argon2 parameters', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const upgradedParams: Argon2Params = { t: 2, m: 512, p: 1, dkLen: 32 };
    const newHeader = changeMasterPassword(header, dek, 'new-password', upgradedParams);

    expect(newHeader.argon2Params).toEqual(upgradedParams);
    const unlocked = unlockVault(newHeader, 'new-password');
    expect(unlocked).toEqual(dek);
  });

  it('should generate a new master salt on password change', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header, dek } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const newHeader = changeMasterPassword(header, dek, 'another-password');

    expect(newHeader.masterSalt).not.toEqual(header.masterSalt);
  });
});

describe('serializeVaultHeader / deserializeVaultHeader', () => {
  it('should round-trip serialize → deserialize', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    const restored = deserializeVaultHeader(bytes);

    expect(restored.version).toBe(header.version);
    expect(restored.masterSalt).toEqual(header.masterSalt);
    expect(restored.recoverySalt).toEqual(header.recoverySalt);
    expect(restored.argon2Params).toEqual(header.argon2Params);
    expect(restored.masterWrappedDEK).toEqual(header.masterWrappedDEK);
    expect(restored.recoveryWrappedDEK).toEqual(header.recoveryWrappedDEK);
  });

  it('should produce deterministic output for the same header', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes1 = serializeVaultHeader(header);
    const bytes2 = serializeVaultHeader(header);

    expect(bytes1).toEqual(bytes2);
  });

  it('should still allow unlock after round-trip', () => {
    const { raw: recoveryRaw, formatted: recoveryFormatted } = generateRecoveryKey();
    const { header, dek } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    const restored = deserializeVaultHeader(bytes);

    // Both unlock methods should work
    expect(unlockVault(restored, MASTER_PASSWORD)).toEqual(dek);
    expect(unlockVaultWithRecovery(restored, recoveryFormatted)).toEqual(dek);
  });

  it('should throw on empty bytes', () => {
    expect(() => deserializeVaultHeader(new Uint8Array(0))).toThrow('empty');
  });

  it('should throw on unsupported version', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    bytes[0] = 99; // bad version

    expect(() => deserializeVaultHeader(bytes)).toThrow('Unsupported vault version');
  });

  it('should throw on truncated data', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    const truncated = bytes.slice(0, 20); // way too short

    expect(() => deserializeVaultHeader(truncated)).toThrow('too short');
  });

  it('should throw when truncated at masterWrappedDEK length', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    // Cut right before the masterWrappedDEK length prefix
    // 1 (version) + 16 (masterSalt) + 16 (recoverySalt) + 16 (argon2 params) = 49
    const cutPoint = 1 + SALT_SIZE + SALT_SIZE + 16;
    const truncated = bytes.slice(0, cutPoint);

    expect(() => deserializeVaultHeader(truncated)).toThrow('truncated at masterWrappedDEK length');
  });

  it('should throw when truncated at masterWrappedDEK data', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    // Cut after master length prefix but before all master data
    const cutPoint = 1 + SALT_SIZE + SALT_SIZE + 16 + 2 + 1; // only 1 byte of master data
    const truncated = bytes.slice(0, cutPoint);

    expect(() => deserializeVaultHeader(truncated)).toThrow('truncated at masterWrappedDEK data');
  });

  it('should throw when truncated at recoveryWrappedDEK length', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    // Cut right after the masterWrappedDEK data, before the recovery length prefix
    const masterLen = header.masterWrappedDEK.length;
    const cutPoint = 1 + SALT_SIZE + SALT_SIZE + 16 + 2 + masterLen;
    const truncated = bytes.slice(0, cutPoint);

    expect(() => deserializeVaultHeader(truncated)).toThrow(
      'truncated at recoveryWrappedDEK length',
    );
  });

  it('should throw when truncated at recoveryWrappedDEK data', () => {
    const { raw: recoveryRaw } = generateRecoveryKey();
    const { header } = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);

    const bytes = serializeVaultHeader(header);
    // Cut after recovery length prefix but before all recovery data
    const masterLen = header.masterWrappedDEK.length;
    const cutPoint = 1 + SALT_SIZE + SALT_SIZE + 16 + 2 + masterLen + 2 + 1; // only 1 byte of recovery data
    const truncated = bytes.slice(0, cutPoint);

    expect(() => deserializeVaultHeader(truncated)).toThrow('truncated at recoveryWrappedDEK data');
  });
});
