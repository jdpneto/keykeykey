import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlatformStorage } from './platform-storage.js';

/**
 * Shared conformance test suite for PlatformStorage implementations.
 *
 * Each app calls this with a factory that creates their adapter (with mocked
 * backends) and an optional cleanup function.
 *
 * The `.conformance.ts` extension keeps this out of core's test glob
 * (`*.{test,spec}.ts`).
 */
export function describePlatformStorageConformance(
  name: string,
  factory: () => PlatformStorage | Promise<PlatformStorage>,
  cleanup?: () => void | Promise<void>,
): void {
  describe(`PlatformStorage conformance: ${name}`, () => {
    let storage: PlatformStorage;

    beforeEach(async () => {
      storage = await factory();
    });

    afterEach(async () => {
      await cleanup?.();
    });

    // ----- Vault Header -----

    describe('vault header', () => {
      it('returns null when no header saved', async () => {
        const result = await storage.loadVaultHeader();
        expect(result).toBeNull();
      });

      it('round-trips a base64 string', async () => {
        await storage.saveVaultHeader('dmF1bHRfaGVhZGVyX2RhdGE=');
        const result = await storage.loadVaultHeader();
        expect(result).toBe('dmF1bHRfaGVhZGVyX2RhdGE=');
      });

      it('overwrites on second save', async () => {
        await storage.saveVaultHeader('first');
        await storage.saveVaultHeader('second');
        const result = await storage.loadVaultHeader();
        expect(result).toBe('second');
      });
    });

    // ----- Encrypted Items -----

    describe('encrypted items', () => {
      it('returns empty array initially', async () => {
        const items = await storage.loadAllEncryptedItems();
        expect(items).toEqual([]);
      });

      it('saves and retrieves a single item', async () => {
        await storage.saveEncryptedItem(
          'item-1',
          'credential',
          'ZW5jcnlwdGVkX2RhdGE=',
          '2026-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
        );
        const items = await storage.loadAllEncryptedItems();
        expect(items).toHaveLength(1);
        expect(items[0]!.id).toBe('item-1');
        expect(items[0]!.encrypted_data).toBe('ZW5jcnlwdGVkX2RhdGE=');
      });

      it('saves multiple items', async () => {
        await storage.saveEncryptedItem(
          'item-1',
          'credential',
          'data1',
          '2026-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
        );
        await storage.saveEncryptedItem(
          'item-2',
          'card',
          'data2',
          '2026-01-02T00:00:00Z',
          '2026-01-02T00:00:00Z',
        );
        const items = await storage.loadAllEncryptedItems();
        expect(items).toHaveLength(2);
        const ids = items.map((i) => i.id).sort();
        expect(ids).toEqual(['item-1', 'item-2']);
      });

      it('upserts item with same id', async () => {
        await storage.saveEncryptedItem(
          'item-1',
          'credential',
          'original',
          '2026-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
        );
        await storage.saveEncryptedItem(
          'item-1',
          'credential',
          'updated',
          '2026-01-01T00:00:00Z',
          '2026-01-02T00:00:00Z',
        );
        const items = await storage.loadAllEncryptedItems();
        expect(items).toHaveLength(1);
        expect(items[0]!.encrypted_data).toBe('updated');
      });

      it('deleteAllItems clears everything', async () => {
        await storage.saveEncryptedItem(
          'item-1',
          'credential',
          'data1',
          '2026-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
        );
        await storage.saveEncryptedItem(
          'item-2',
          'card',
          'data2',
          '2026-01-02T00:00:00Z',
          '2026-01-02T00:00:00Z',
        );
        await storage.deleteAllItems();
        const items = await storage.loadAllEncryptedItems();
        expect(items).toEqual([]);
      });
    });

    // ----- Sync Config File -----

    describe('sync config file', () => {
      it('returns null when no config saved', async () => {
        const result = await storage.loadSyncConfigFile();
        expect(result).toBeNull();
      });

      it('round-trips Uint8Array data', async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5, 10, 20, 255]);
        await storage.saveSyncConfigFile(data);
        const result = await storage.loadSyncConfigFile();
        expect(result).toBeInstanceOf(Uint8Array);
        expect(Array.from(result!)).toEqual([1, 2, 3, 4, 5, 10, 20, 255]);
      });

      it('delete makes subsequent load return null', async () => {
        const data = new Uint8Array([99, 100]);
        await storage.saveSyncConfigFile(data);
        await storage.deleteSyncConfigFile();
        const result = await storage.loadSyncConfigFile();
        expect(result).toBeNull();
      });
    });

    // ----- Lifecycle Flags -----

    describe('lifecycle flags', () => {
      it('setVaultSetupComplete(true) does not throw', async () => {
        await expect(storage.setVaultSetupComplete(true)).resolves.not.toThrow();
      });

      it('setVaultSetupComplete(false) does not throw', async () => {
        await expect(storage.setVaultSetupComplete(false)).resolves.not.toThrow();
      });
    });

    // ----- Optional Methods -----

    describe('optional methods', () => {
      it('setSyncUrlPrefix with string does not throw (if defined)', async () => {
        if (!storage.setSyncUrlPrefix) return;
        await expect(storage.setSyncUrlPrefix('https://example.com')).resolves.not.toThrow();
      });

      it('setSyncUrlPrefix with null does not throw (if defined)', async () => {
        if (!storage.setSyncUrlPrefix) return;
        await expect(storage.setSyncUrlPrefix(null)).resolves.not.toThrow();
      });
    });
  });
}
