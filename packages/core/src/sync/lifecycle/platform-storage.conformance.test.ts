import { describePlatformStorageConformance } from './platform-storage.conformance.js';
import type { PlatformStorage } from './platform-storage.js';

/**
 * Trivial in-memory PlatformStorage to validate the conformance suite itself.
 * Not exported — exists only so the suite doesn't bitrot.
 */
function createInMemoryStorage(): PlatformStorage {
  let header: string | null = null;
  let syncConfig: Uint8Array | null = null;
  let setupComplete = false;
  let syncUrlPrefix: string | null = null;
  const items = new Map<
    string,
    { id: string; type: string; encrypted_data: string; created_at: string; updated_at: string }
  >();

  return {
    async loadSyncConfigFile() {
      return syncConfig ? new Uint8Array(syncConfig) : null;
    },
    async saveSyncConfigFile(data) {
      syncConfig = new Uint8Array(data);
    },
    async deleteSyncConfigFile() {
      syncConfig = null;
    },
    async saveEncryptedItem(id, type, encryptedBase64, createdAt, updatedAt) {
      items.set(id, {
        id,
        type,
        encrypted_data: encryptedBase64,
        created_at: createdAt,
        updated_at: updatedAt,
      });
    },
    async loadAllEncryptedItems() {
      return [...items.values()].map(({ id, encrypted_data }) => ({ id, encrypted_data }));
    },
    async deleteAllItems() {
      items.clear();
    },
    async saveVaultHeader(headerBase64) {
      header = headerBase64;
    },
    async loadVaultHeader() {
      return header;
    },
    async setVaultSetupComplete(complete) {
      setupComplete = complete;
    },
    async setSyncUrlPrefix(prefix) {
      syncUrlPrefix = prefix;
    },
  };
}

describePlatformStorageConformance('InMemory', () => createInMemoryStorage());
