import {
  encryptSyncConfig,
  decryptSyncConfig,
  createAdapterFromConfig,
  createSyncEngineFromConfig,
  initSyncEngine,
  deriveMEKFromAdapter,
  DEFAULT_SYNC_CONFIG,
} from './sync-config.js';
import type { SyncConfig, AdapterOverrides } from './sync-config.js';
import { connectSyncEngine } from './connect.js';
import { restoreFromCloud as restoreFromCloudCore } from './restore.js';
import type { RestoreProgressEvent } from './restore.js';
import { deleteCloudVault } from './delete-cloud-vault.js';
import { mergeItemSets } from './merge.js';
import { generateSyncSalt, deriveMEK } from './vault-blob.js';
import { decrypt } from '../crypto/encryption.js';
import { SyncEngine } from './sync-engine.js';
import type { SyncableStore, VaultMismatchInfo } from './sync-engine.js';
import { unlockVault, serializeVaultHeader } from '../crypto/vault-header.js';
import type { VaultHeader } from '../crypto/vault-header.js';
import { toBase64 } from '../utils/base64.js';
import { pMap } from '../utils/concurrency.js';
import { VaultItemSchema } from '../models/vault-item.js';
import type { VaultItem } from '../models/vault-item.js';

// ---------------------------------------------------------------------------
// Platform Storage Interface
// ---------------------------------------------------------------------------

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
  loadAllEncryptedItems(): Promise<Array<{ id: string; encrypted_data: string }>>;
  deleteAllItems(): Promise<void>;
  saveVaultHeader(headerBase64: string): Promise<void>;
  loadVaultHeader(): Promise<string | null>;
  setVaultSetupComplete(complete: boolean): Promise<void>;
  setSyncUrlPrefix?(prefix: string | null): Promise<void>;
}

// ---------------------------------------------------------------------------
// Callbacks Interface
// ---------------------------------------------------------------------------

export interface SyncLifecycleCallbacks {
  onConfigChanged(config: SyncConfig): void;
  onMismatch(info: VaultMismatchInfo): void;
  onMismatchCleared(): void;
  onItemsChanged(): void;
}

// ---------------------------------------------------------------------------
// Store type that includes subscribe (needed by connectSyncEngine)
// ---------------------------------------------------------------------------

export interface SubscribableSyncStore extends SyncableStore {
  subscribe: (
    listener: (
      state: { status: string; items: unknown[] },
      prevState: { status: string; items: unknown[] },
    ) => void,
  ) => () => void;
}

// ---------------------------------------------------------------------------
// SyncLifecycle Class
// ---------------------------------------------------------------------------

export class SyncLifecycle {
  private _store: SubscribableSyncStore;
  private _storage: PlatformStorage;
  private _callbacks: SyncLifecycleCallbacks;
  private _getHeader: () => VaultHeader | null;
  private _adapterOverrides?: AdapterOverrides;
  private _engine: SyncEngine | null = null;
  private _disconnect: (() => void) | null = null;
  private _config: SyncConfig | null = null;
  private _mismatchInfo: VaultMismatchInfo | null = null;

  constructor(options: {
    store: SubscribableSyncStore;
    storage: PlatformStorage;
    callbacks: SyncLifecycleCallbacks;
    /** Provide access to the vault header without extending SyncableStore. */
    getHeader: () => VaultHeader | null;
    /** Optional overrides for adapter creation (e.g., chrome.identity token provider). */
    adapterOverrides?: AdapterOverrides;
  }) {
    this._store = options.store;
    this._storage = options.storage;
    this._callbacks = options.callbacks;
    this._getHeader = options.getHeader;
    this._adapterOverrides = options.adapterOverrides;
  }

  // --- Accessors ---

  get config(): SyncConfig | null {
    return this._config;
  }

  get mismatchInfo(): VaultMismatchInfo | null {
    return this._mismatchInfo;
  }

  get engine(): SyncEngine | null {
    return this._engine;
  }

  // --- Lifecycle ---

  async initAfterUnlock(): Promise<SyncConfig> {
    const dek = this._store.getState().getDEK();
    const config = await this._loadConfig(dek);
    this._config = config;
    this._mismatchInfo = null;
    this._callbacks.onConfigChanged(config);

    if (config.provider === 'none' || !config.masterPassword) return config;

    try {
      await this._setupUrlPrefix(config);
      await this._createAndStartEngine(config, true);
    } catch (err) {
      console.error(
        '[SyncLifecycle] init failed:',
        err instanceof Error ? err.stack || err.message : err,
      );
    }

    return config;
  }

  async saveConfig(config: SyncConfig): Promise<void> {
    const dek = this._store.getState().getDEK();
    const encrypted = encryptSyncConfig(config, dek);
    await this._storage.saveSyncConfigFile(encrypted);
    this._config = config;
    this._mismatchInfo = null;
    this._callbacks.onConfigChanged(config);

    this._teardownEngine();

    if (config.provider !== 'none' && config.masterPassword) {
      await this._setupUrlPrefix(config);
      await this._createAndStartEngine(config, false);
    } else {
      await this._storage.setSyncUrlPrefix?.(null);
    }
  }

  teardown(): void {
    this._teardownEngine();
    this._config = null;
    this._mismatchInfo = null;
  }

  // --- Sync Operations ---

  async triggerSync(): Promise<{ lastSynced: string | null; error: string | null }> {
    if (this._mismatchInfo) {
      return {
        lastSynced: null,
        error: 'Remote vault mismatch — resolve it before syncing',
      };
    }
    if (!this._engine) return { lastSynced: null, error: 'No sync engine' };
    try {
      await this._engine.sync();
      // If the sync surfaced a new mismatch, report it rather than claiming success.
      if (this._mismatchInfo) {
        return {
          lastSynced: null,
          error: 'Remote vault mismatch — resolve it before syncing',
        };
      }
      const now = new Date().toISOString();
      return { lastSynced: now, error: null };
    } catch (e) {
      return { lastSynced: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  getStatus(): { isSyncing: boolean } {
    return { isSyncing: this._engine?.isSyncing() ?? false };
  }

  recordTombstone(id: string): void {
    this._engine?.recordTombstone(id);
  }

  // --- Validation ---

  async validateMasterPassword(password: string): Promise<boolean> {
    const header = this._getHeader();
    if (!header) return false;
    try {
      const dek = await unlockVault(header, password);
      dek.fill(0);
      return true;
    } catch {
      return false;
    }
  }

  // --- Mismatch Resolution ---

  async clearMismatch(): Promise<void> {
    this._teardownEngine();
    this._mismatchInfo = null;
    const dek = this._store.getState().getDEK();
    const config: SyncConfig = { provider: 'none' };
    const encrypted = encryptSyncConfig(config, dek);
    await this._storage.saveSyncConfigFile(encrypted);
    this._config = config;
    await this._storage.setSyncUrlPrefix?.(null);
    this._callbacks.onConfigChanged(config);
    this._callbacks.onMismatchCleared();
  }

  async replaceRemote(): Promise<{ success: boolean; error?: string }> {
    try {
      const config = this._config;
      if (!config || config.provider === 'none' || !config.masterPassword)
        return { success: false, error: 'No sync configured or master password missing' };

      const adapter = createAdapterFromConfig(config, this._adapterOverrides);
      if (!adapter) return { success: false, error: 'Could not create adapter' };

      const header = this._getHeader();
      if (!header) return { success: false, error: 'Vault header not available' };
      const syncSalt = generateSyncSalt();
      const mek = await deriveMEK(config.masterPassword, syncSalt, header.argon2Params);
      const vaultHeaderBytes = serializeVaultHeader(header);

      await deleteCloudVault(adapter, mek, syncSalt, vaultHeaderBytes, header.argon2Params);

      this._teardownEngine();
      await this._createEngine(config, mek, syncSalt, vaultHeaderBytes, header.argon2Params, true);

      this._mismatchInfo = null;
      this._callbacks.onMismatchCleared();
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async replaceLocal(): Promise<{ success: boolean; error?: string }> {
    const config = this._config;
    if (!config || config.provider === 'none' || !config.masterPassword)
      return { success: false, error: 'No sync configured or master password missing' };
    const result = await this.restoreFromCloud(config, config.masterPassword);
    if (result.success) {
      this._mismatchInfo = null;
      this._callbacks.onMismatchCleared();
    }
    return result;
  }

  async mergeVaults(): Promise<{
    success: boolean;
    error?: string;
    added?: number;
    updated?: number;
  }> {
    try {
      const config = this._config;
      if (!config || config.provider === 'none' || !config.masterPassword)
        return { success: false, error: 'No sync configured or master password missing' };

      const adapter = createAdapterFromConfig(config, this._adapterOverrides);
      if (!adapter) return { success: false, error: 'Could not create adapter' };

      // 1. Download and decrypt remote vault
      const restoreResult = await restoreFromCloudCore(adapter, config.masterPassword);

      // 2. Decrypt remote items with Zod validation
      const remoteHeader = restoreResult.header;
      const remoteDEK = await unlockVault(remoteHeader, config.masterPassword);
      let remoteItems: VaultItem[];
      try {
        remoteItems = await pMap(restoreResult.encryptedItems, async (encBytes) => {
          const plainBytes = decrypt(encBytes, remoteDEK);
          const parsed = JSON.parse(new TextDecoder().decode(plainBytes));
          return VaultItemSchema.parse(parsed);
        });
      } finally {
        remoteDEK.fill(0);
      }

      // 3. Merge with local items (LWW)
      const localItems = this._store.getState().items;
      const { merged, added, updated } = mergeItemSets(localItems, remoteItems);

      // 4. Update store
      this._store.setState({ items: merged });

      // 5. Persist all merged items
      await this._storage.deleteAllItems();
      await pMap(merged, async (item) => {
        const encBytes = this._store.getState().encryptItem(item);
        await this._storage.saveEncryptedItem(
          item.id,
          item.type,
          toBase64(encBytes),
          item.createdAt,
          item.updatedAt,
        );
      });

      // 6. Wipe remote and recreate engine with fresh salt (same as replaceRemote)
      // The merged items are now local — the engine will upload them on initial sync.
      this._teardownEngine();
      const header = this._getHeader();
      if (!header) return { success: false, error: 'Vault header not available after merge' };
      const syncSalt = generateSyncSalt();
      const mek = await deriveMEK(config.masterPassword, syncSalt, header.argon2Params);
      const vaultHeaderBytes = serializeVaultHeader(header);
      await deleteCloudVault(adapter, mek, syncSalt, vaultHeaderBytes, header.argon2Params);
      await this._createEngine(config, mek, syncSalt, vaultHeaderBytes, header.argon2Params, true);

      this._mismatchInfo = null;
      this._callbacks.onItemsChanged();
      this._callbacks.onMismatchCleared();

      return { success: true, added, updated };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // --- Restore ---
  // NOTE: restoreFromCloud saves the header and items to platform storage,
  // but does NOT replace the in-memory vault store or create a sync engine.
  // The caller (platform vault context) must:
  //   1. Re-create and unlock the vault store with the restored header/items
  //   2. Call initAfterUnlock() to set up the sync engine

  async restoreFromCloud(
    config: SyncConfig,
    masterPassword: string,
    onProgress?: (event: RestoreProgressEvent) => void,
  ): Promise<{ success: boolean; error?: string; itemCount?: number }> {
    try {
      const adapter = createAdapterFromConfig(config, this._adapterOverrides);
      if (!adapter) return { success: false, error: 'Could not create adapter' };

      await this._setupUrlPrefix(config);

      // 1. Download and decrypt
      const result = await restoreFromCloudCore(adapter, masterPassword, onProgress);

      // 2. Save vault header
      const headerBytes = serializeVaultHeader(result.header);
      await this._storage.saveVaultHeader(toBase64(headerBytes));
      await this._storage.setVaultSetupComplete(true);

      // 3. Delete old items and save new ones
      await this._storage.deleteAllItems();
      const dek = await unlockVault(result.header, masterPassword);
      try {
        let importedCount = 0;
        const importTotal = result.encryptedItems.length;
        await pMap(result.encryptedItems, async (encBytes) => {
          const plainBytes = decrypt(encBytes, dek);
          const item = VaultItemSchema.parse(JSON.parse(new TextDecoder().decode(plainBytes)));
          await this._storage.saveEncryptedItem(
            item.id,
            item.type,
            toBase64(encBytes),
            item.createdAt,
            item.updatedAt,
          );
          importedCount++;
          onProgress?.({ phase: 'importing', completed: importedCount, total: importTotal });
        });
        const itemCount = result.encryptedItems.length;

        // 4. Save config with master password
        const configWithPassword: SyncConfig = { ...config, masterPassword };
        const encrypted = encryptSyncConfig(configWithPassword, dek);
        await this._storage.saveSyncConfigFile(encrypted);
        this._config = configWithPassword;
        this._callbacks.onConfigChanged(configWithPassword);

        return { success: true, itemCount };
      } finally {
        dek.fill(0);
      }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // --- Private Helpers ---

  private async _loadConfig(dek: Uint8Array): Promise<SyncConfig> {
    const data = await this._storage.loadSyncConfigFile();
    if (!data) return DEFAULT_SYNC_CONFIG;
    try {
      return decryptSyncConfig(data, dek);
    } catch {
      return DEFAULT_SYNC_CONFIG;
    }
  }

  // No unsafe casting — header access is via the injected getHeader callback

  private _teardownEngine(): void {
    if (this._disconnect) {
      this._disconnect();
      this._disconnect = null;
    }
    if (this._engine) {
      this._engine.stopPeriodicSync();
      this._engine = null;
    }
  }

  private async _setupUrlPrefix(config: SyncConfig): Promise<void> {
    const urlPrefix = config.provider === 'webdav' && config.webdav ? config.webdav.url : null;
    await this._storage.setSyncUrlPrefix?.(urlPrefix);
  }

  private async _createAndStartEngine(config: SyncConfig, withInitialSync: boolean): Promise<void> {
    const header = this._getHeader();
    if (!header) throw new Error('Vault header not available — cannot create sync engine');
    const vaultHeaderBytes = serializeVaultHeader(header);

    const mekResult = await deriveMEKFromAdapter(
      createAdapterFromConfig(config, this._adapterOverrides)!,
      config.masterPassword!,
      header.argon2Params,
    );

    await this._createEngine(
      config,
      mekResult.mek,
      mekResult.syncSalt,
      vaultHeaderBytes,
      header.argon2Params,
      withInitialSync,
    );
  }

  private async _createEngine(
    config: SyncConfig,
    mek: Uint8Array,
    syncSalt: Uint8Array,
    vaultHeaderBytes: Uint8Array,
    argon2Params: import('../crypto/constants.js').Argon2Params,
    withInitialSync: boolean,
  ): Promise<void> {
    const handleMismatch = (info: VaultMismatchInfo) => {
      // Keep the engine alive — we only flag the mismatch. triggerSync() and
      // periodic sync both check _mismatchInfo and bail out early, which
      // prevents the engine from re-detecting the same mismatch on every tick
      // and avoids the stale "No sync engine" error on subsequent manual syncs.
      this._mismatchInfo = info;
      // Stop the periodic timer so we don't spam the mismatch callback.
      this._engine?.stopPeriodicSync();
      this._callbacks.onMismatch(info);
    };

    const engine = createSyncEngineFromConfig(
      config,
      this._store,
      mek,
      syncSalt,
      vaultHeaderBytes,
      argon2Params,
      handleMismatch,
      this._adapterOverrides,
    );

    if (engine) {
      this._engine = engine;
      if (withInitialSync) {
        this._disconnect = initSyncEngine(engine, this._store);
      } else {
        this._disconnect = connectSyncEngine(this._store, engine);
      }
      engine.startPeriodicSync(60_000);
    }
  }
}
