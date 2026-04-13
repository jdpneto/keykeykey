// ---------------------------------------------------------------------------
// Platform Storage Interface
// ---------------------------------------------------------------------------

/**
 * The shape returned by loadAllEncryptedItems().
 */
export interface StoredItem {
  id: string;
  encrypted_data: string;
}

/**
 * Platform-agnostic storage contract used by SyncLifecycle.
 * Each platform (extension, desktop, mobile) provides its own implementation.
 */
export interface PlatformStorage {
  loadSyncConfigFile(): Promise<Uint8Array | null>;
  saveSyncConfigFile(data: Uint8Array): Promise<void>;
  deleteSyncConfigFile(): Promise<void>;
  saveEncryptedItem(
    id: string,
    type: string,
    encryptedBase64: string,
    createdAt: string,
    updatedAt: string,
  ): Promise<void>;
  loadAllEncryptedItems(): Promise<StoredItem[]>;
  deleteAllItems(): Promise<void>;
  saveVaultHeader(headerBase64: string): Promise<void>;
  loadVaultHeader(): Promise<string | null>;
  setVaultSetupComplete(complete: boolean): Promise<void>;
  setSyncUrlPrefix?(prefix: string | null): Promise<void>;
}
