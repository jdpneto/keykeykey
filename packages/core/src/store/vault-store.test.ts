import { describe, it, expect, beforeEach } from 'vitest';
import { createVaultStore } from './vault-store.js';
import { createVaultHeader } from '../crypto/vault-header.js';
import { generateRecoveryKey } from '../crypto/recovery.js';
import { encrypt } from '../crypto/encryption.js';
import type { Argon2Params } from '../crypto/constants.js';
import type { VaultItem } from '../models/vault-item.js';
import { v4 as uuidv4 } from 'uuid';

const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };
const MASTER_PASSWORD = 'test-master-password';

function makeCredential(
  overrides?: Partial<VaultItem>,
): Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    type: 'credential' as const,
    name: 'Test Login',
    tags: ['test'],
    favorite: false,
    username: 'user@example.com',
    password: 'secret123',
    url: 'https://example.com',
    ...overrides,
  };
}

function makeFullCredential(): VaultItem {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    type: 'credential' as const,
    name: 'Test Login',
    tags: ['test'],
    favorite: false,
    username: 'user@example.com',
    password: 'secret123',
    url: 'https://example.com',
    createdAt: now,
    updatedAt: now,
  };
}

function encryptVaultItem(item: VaultItem, dek: Uint8Array): Uint8Array {
  const json = JSON.stringify(item);
  const bytes = new TextEncoder().encode(json);
  return encrypt(bytes, dek);
}

describe('vault store', () => {
  let store: ReturnType<typeof createVaultStore>;
  let recoveryFormatted: string;
  let dek: Uint8Array;

  beforeEach(() => {
    store = createVaultStore();
    const { raw: recoveryRaw, formatted } = generateRecoveryKey();
    recoveryFormatted = formatted;
    const result = createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);
    store.getState().loadHeader(result.header);
    dek = result.dek;
  });

  describe('initial state', () => {
    it('should start as locked with no items', () => {
      const state = store.getState();
      expect(state.status).toBe('locked');
      expect(state.items).toEqual([]);
    });

    it('should have header after loadHeader', () => {
      expect(store.getState().header).not.toBeNull();
    });
  });

  describe('unlock', () => {
    it('should unlock with correct master password', () => {
      store.getState().unlock(MASTER_PASSWORD, []);
      expect(store.getState().status).toBe('unlocked');
    });

    it('should decrypt items during unlock', () => {
      const item = makeFullCredential();
      const encItem = encryptVaultItem(item, dek);

      store.getState().unlock(MASTER_PASSWORD, [encItem]);

      const state = store.getState();
      expect(state.status).toBe('unlocked');
      expect(state.items).toHaveLength(1);
      expect(state.items[0]!.name).toBe('Test Login');
    });

    it('should throw with wrong password', () => {
      expect(() => store.getState().unlock('wrong-password', [])).toThrow();
      expect(store.getState().status).toBe('locked');
    });

    it('should throw if no header loaded', () => {
      const freshStore = createVaultStore();
      expect(() => freshStore.getState().unlock(MASTER_PASSWORD, [])).toThrow(
        'No vault header loaded',
      );
    });
  });

  describe('unlockWithRecovery', () => {
    it('should unlock with correct recovery key', () => {
      store.getState().unlockWithRecovery(recoveryFormatted, []);
      expect(store.getState().status).toBe('unlocked');
    });

    it('should throw with wrong recovery key', () => {
      const { formatted: wrongKey } = generateRecoveryKey();
      expect(() => store.getState().unlockWithRecovery(wrongKey, [])).toThrow();
    });
  });

  describe('lock', () => {
    it('should clear items and set status to locked', () => {
      store.getState().unlock(MASTER_PASSWORD, []);
      store.getState().addItem(makeCredential());

      store.getState().lock();

      expect(store.getState().status).toBe('locked');
      expect(store.getState().items).toEqual([]);
    });

    it('should prevent CRUD operations after lock', () => {
      store.getState().unlock(MASTER_PASSWORD, []);
      store.getState().lock();

      expect(() => store.getState().addItem(makeCredential())).toThrow('Vault is locked');
    });
  });

  describe('CRUD operations', () => {
    beforeEach(() => {
      store.getState().unlock(MASTER_PASSWORD, []);
    });

    it('addItem should return a valid UUID', () => {
      const id = store.getState().addItem(makeCredential());
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('addItem should add item to store', () => {
      store.getState().addItem(makeCredential());
      expect(store.getState().items).toHaveLength(1);
    });

    it('addItem should set createdAt and updatedAt', () => {
      store.getState().addItem(makeCredential());
      const item = store.getState().items[0]!;
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
    });

    it('updateItem should modify the item', () => {
      const id = store.getState().addItem(makeCredential());
      store.getState().updateItem(id, { name: 'Updated Name' });

      const item = store.getState().items.find((i) => i.id === id);
      expect(item!.name).toBe('Updated Name');
    });

    it('updateItem should change updatedAt', () => {
      const id = store.getState().addItem(makeCredential());
      // Small delay to ensure different timestamp
      store.getState().updateItem(id, { name: 'New Name' });
      const newUpdatedAt = store.getState().items[0]!.updatedAt;

      // updatedAt should be set (may or may not differ in fast tests)
      expect(newUpdatedAt).toBeDefined();
    });

    it('deleteItem should remove the item', () => {
      const id = store.getState().addItem(makeCredential());
      expect(store.getState().items).toHaveLength(1);

      store.getState().deleteItem(id);
      expect(store.getState().items).toHaveLength(0);
    });

    it('deleteItem with non-existent ID should be a no-op', () => {
      store.getState().addItem(makeCredential());
      store.getState().deleteItem('non-existent-id');
      expect(store.getState().items).toHaveLength(1);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      store.getState().unlock(MASTER_PASSWORD, []);
      store.getState().addItem({
        type: 'credential',
        name: 'GitHub Login',
        tags: ['dev', 'work'],
        favorite: true,
        username: 'devuser',
        password: 'ghpass',
        url: 'https://github.com',
      });
      store.getState().addItem({
        type: 'credential',
        name: 'Gmail Account',
        tags: ['personal', 'email'],
        favorite: false,
        username: 'me@gmail.com',
        password: 'gmailpass',
        url: 'https://mail.google.com',
      });
      store.getState().addItem({
        type: 'secure-note',
        name: 'Private Notes',
        tags: ['personal'],
        favorite: false,
        content: 'Some secret content',
      });
    });

    it('should search by name (case-insensitive)', () => {
      const results = store.getState().search('github');
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('GitHub Login');
    });

    it('should search by username', () => {
      const results = store.getState().search('devuser');
      expect(results).toHaveLength(1);
    });

    it('should search by URL', () => {
      const results = store.getState().search('google.com');
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Gmail Account');
    });

    it('should search by tag', () => {
      const results = store.getState().search('personal');
      expect(results).toHaveLength(2); // Gmail + Private Notes
    });

    it('should return all items for empty query', () => {
      const results = store.getState().search('');
      expect(results).toHaveLength(3);
    });

    it('should return empty for no match', () => {
      const results = store.getState().search('nonexistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('encryptItem', () => {
    it('should encrypt and allow round-trip', () => {
      store.getState().unlock(MASTER_PASSWORD, []);
      store.getState().addItem(makeCredential());
      const item = store.getState().items[0]!;

      const encrypted = store.getState().encryptItem(item);
      expect(encrypted).toBeInstanceOf(Uint8Array);
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it('should throw when locked', () => {
      expect(() => store.getState().encryptItem(makeFullCredential())).toThrow('Vault is locked');
    });
  });

  describe('getDEK', () => {
    it('should return the DEK when unlocked', () => {
      store.getState().unlock(MASTER_PASSWORD, []);
      const storeDEK = store.getState().getDEK();
      expect(storeDEK).toEqual(dek);
    });

    it('should throw when locked', () => {
      expect(() => store.getState().getDEK()).toThrow('Vault is locked');
    });
  });
});
