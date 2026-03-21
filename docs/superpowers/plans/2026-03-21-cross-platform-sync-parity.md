# Cross-Platform Sync Parity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared sync orchestration into a core `SyncLifecycle` class, refactor desktop to use it, then bring mobile and extension to full sync parity (restore from cloud, vault mismatch resolution).

**Architecture:** A `SyncLifecycle` class in `packages/core/src/sync/sync-lifecycle.ts` encapsulates all sync orchestration (init, config, mismatch resolution, restore). Each platform provides a `PlatformStorage` implementation for I/O (~30 lines). Desktop is refactored first to validate the API, then mobile and extension are completed.

**Tech Stack:** TypeScript, Zustand, Vitest (core/desktop/extension), Jest (mobile), XChaCha20-Poly1305, Argon2id, React, React Native (Expo), browser extension Manifest V3

**Spec:** `docs/superpowers/specs/2026-03-21-cross-platform-sync-parity-design.md`

---

## File Structure

### New files

| File | Responsibility |
| ---- | -------------- |
| `packages/core/src/sync/sync-lifecycle.ts` | `PlatformStorage` interface, `SyncLifecycleCallbacks` interface, `SyncLifecycle` class |
| `packages/core/src/sync/sync-lifecycle.test.ts` | Tests for SyncLifecycle using MemoryAdapter + mock PlatformStorage |
| `apps/mobile/app/restore.tsx` | Mobile restore-from-cloud wizard (Expo Router stack screen) |
| `apps/mobile/__tests__/screens/restore.test.tsx` | Mobile restore screen tests |
| `apps/extension/src/popup/screens/SyncSettingsScreen.tsx` | Extension dedicated sync settings screen |
| `apps/extension/src/popup/screens/RestoreScreen.tsx` | Extension restore-from-cloud wizard |

### Modified files

| File | Changes |
| ---- | ------- |
| `packages/core/src/sync/index.ts` | Export `SyncLifecycle`, `PlatformStorage`, `SyncLifecycleCallbacks` |
| `apps/desktop/src/lib/vault-context.tsx` | Replace ~300 lines of sync orchestration with `SyncLifecycle` delegation |
| `apps/desktop/src/lib/sync.ts` | Extract `createDesktopPlatformStorage()`, remove re-exported lifecycle functions |
| `apps/mobile/lib/vault-context.tsx` | Replace sync logic with `SyncLifecycle` delegation, add mismatch resolution methods, remove `vaultReplaced` |
| `apps/mobile/lib/sync.ts` | Extract `createMobilePlatformStorage()`, simplify |
| `apps/mobile/app/settings/sync.tsx` | Add vault mismatch dialog |
| `apps/mobile/app/setup.tsx` | Enable "Restore from Cloud" button |
| `apps/mobile/app/_layout.tsx` | Add `restore` stack screen |
| `apps/mobile/__tests__/screens/sync-settings.test.tsx` | Update for mismatch dialog |
| `apps/extension/src/background/sync.ts` | Replace with `SyncLifecycle`-based module |
| `apps/extension/src/background/message-handler.ts` | Update sync handlers, add new message handlers |
| `apps/extension/src/background/storage.ts` | Add `createExtensionPlatformStorage()`, update item storage format |
| `apps/extension/src/lib/messages.ts` | Add new message types |
| `apps/extension/src/popup/Popup.tsx` | Add `sync-settings` and `restore` screen states |
| `apps/extension/src/popup/screens/SettingsScreen.tsx` | Replace inline sync UI with navigation row |
| `apps/extension/src/popup/screens/SetupScreen.tsx` | Enable restore button |

---

## Chunk 1: Core SyncLifecycle

### Task 1: Implement PlatformStorage interface and SyncLifecycle class

**Files:**

- Create: `packages/core/src/sync/sync-lifecycle.ts`
- Modify: `packages/core/src/sync/index.ts`

- [ ] **Step 1: Create sync-lifecycle.ts with interfaces and class**

Create `packages/core/src/sync/sync-lifecycle.ts`:

```typescript
import {
  encryptSyncConfig,
  decryptSyncConfig,
  createAdapterFromConfig,
  createSyncEngineFromConfig,
  initSyncEngine,
  deriveMEKFromAdapter,
  DEFAULT_SYNC_CONFIG,
} from './sync-config.js';
import type { SyncConfig, AdapterPlatformCallbacks } from './sync-config.js';
import { connectSyncEngine } from './connect.js';
import { restoreFromCloud as restoreFromCloudCore } from './restore.js';
import { deleteCloudVault } from './delete-cloud-vault.js';
import { mergeItemSets } from './merge.js';
import { generateSyncSalt, deriveMEK } from './vault-blob.js';
import { encrypt, decrypt } from '../crypto/encryption.js';
import { SyncEngine } from './sync-engine.js';
import type { SyncableStore, VaultMismatchInfo } from './sync-engine.js';
import { unlockVault, serializeVaultHeader, deserializeVaultHeader } from '../crypto/vault-header.js';
import type { VaultHeader } from '../crypto/vault-header.js';
import { toBase64, fromBase64 } from '../utils/base64.js';
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
// SyncLifecycle Class
// ---------------------------------------------------------------------------

export class SyncLifecycle {
  private _store: SyncableStore;
  private _storage: PlatformStorage;
  private _platformCallbacks: AdapterPlatformCallbacks;
  private _callbacks: SyncLifecycleCallbacks;
  private _getHeader: () => VaultHeader | null;
  private _engine: SyncEngine | null = null;
  private _disconnect: (() => void) | null = null;
  private _config: SyncConfig | null = null;
  private _mismatchInfo: VaultMismatchInfo | null = null;

  constructor(options: {
    store: SyncableStore;
    storage: PlatformStorage;
    platformCallbacks: AdapterPlatformCallbacks;
    callbacks: SyncLifecycleCallbacks;
    /** Provide access to the vault header without extending SyncableStore. */
    getHeader: () => VaultHeader | null;
  }) {
    this._store = options.store;
    this._storage = options.storage;
    this._platformCallbacks = options.platformCallbacks;
    this._callbacks = options.callbacks;
    this._getHeader = options.getHeader;
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
      console.warn(
        'Sync init failed:',
        err instanceof Error ? err.message : err,
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
    if (!this._engine) return { lastSynced: null, error: 'No sync engine' };
    try {
      await this._engine.sync();
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
      await unlockVault(header, password);
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

      const adapter = createAdapterFromConfig(config, this._platformCallbacks);
      if (!adapter) return { success: false, error: 'Could not create adapter' };

      const header = this._getHeader()!;
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

      const adapter = createAdapterFromConfig(config, this._platformCallbacks);
      if (!adapter) return { success: false, error: 'Could not create adapter' };

      // 1. Download and decrypt remote vault
      const restoreResult = await restoreFromCloudCore(adapter, config.masterPassword);

      // 2. Decrypt remote items with Zod validation
      const remoteHeader = restoreResult.header;
      const remoteDEK = await unlockVault(remoteHeader, config.masterPassword);
      const remoteItems: VaultItem[] = restoreResult.encryptedItems.map((encBytes) => {
        const plainBytes = decrypt(encBytes, remoteDEK);
        const parsed = JSON.parse(new TextDecoder().decode(plainBytes));
        return VaultItemSchema.parse(parsed);
      });

      // 3. Merge with local items (LWW)
      const localItems = this._store.getState().items;
      const { merged, added, updated } = mergeItemSets(localItems, remoteItems);

      // 4. Update store
      this._store.setState({ items: merged });

      // 5. Persist all merged items
      await this._storage.deleteAllItems();
      for (const item of merged) {
        const encBytes = this._store.getState().encryptItem(item);
        await this._storage.saveEncryptedItem(
          item.id,
          item.type,
          toBase64(encBytes),
          item.createdAt,
          item.updatedAt,
        );
      }

      // 6. Recreate engine with new salt
      this._teardownEngine();
      const header = this._getHeader()!;
      const syncSalt = generateSyncSalt();
      const mek = await deriveMEK(config.masterPassword, syncSalt, header.argon2Params);
      const vaultHeaderBytes = serializeVaultHeader(header);
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
  ): Promise<{ success: boolean; error?: string; itemCount?: number }> {
    try {
      const adapter = createAdapterFromConfig(config, this._platformCallbacks);
      if (!adapter) return { success: false, error: 'Could not create adapter' };

      await this._setupUrlPrefix(config);

      // 1. Download and decrypt
      const result = await restoreFromCloudCore(adapter, masterPassword);

      // 2. Save vault header
      const headerBytes = serializeVaultHeader(result.header);
      await this._storage.saveVaultHeader(toBase64(headerBytes));
      await this._storage.setVaultSetupComplete(true);

      // 3. Delete old items and save new ones
      await this._storage.deleteAllItems();
      const dek = await unlockVault(result.header, masterPassword);
      let itemCount = 0;
      for (const encBytes of result.encryptedItems) {
        const plainBytes = decrypt(encBytes, dek);
        const item = VaultItemSchema.parse(JSON.parse(new TextDecoder().decode(plainBytes)));
        await this._storage.saveEncryptedItem(
          item.id,
          item.type,
          toBase64(encBytes),
          item.createdAt,
          item.updatedAt,
        );
        itemCount++;
      }

      // 4. Save config with master password
      const configWithPassword: SyncConfig = { ...config, masterPassword };
      const configDek = dek; // Use the restored vault's DEK
      const encrypted = encryptSyncConfig(configWithPassword, configDek);
      await this._storage.saveSyncConfigFile(encrypted);
      this._config = configWithPassword;
      this._callbacks.onConfigChanged(configWithPassword);

      return { success: true, itemCount };
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
    this._disconnect?.();
    this._disconnect = null;
    this._engine = null;
  }

  private async _setupUrlPrefix(config: SyncConfig): Promise<void> {
    const urlPrefix = config.provider === 'webdav' && config.webdav ? config.webdav.url : null;
    await this._storage.setSyncUrlPrefix?.(urlPrefix);
  }

  private async _createAndStartEngine(config: SyncConfig, withInitialSync: boolean): Promise<void> {
    const header = this._getHeader()!;
    const vaultHeaderBytes = serializeVaultHeader(header);

    const mekResult = await deriveMEKFromAdapter(
      createAdapterFromConfig(config, this._platformCallbacks)!,
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
      this._teardownEngine();
      this._mismatchInfo = info;
      this._callbacks.onMismatch(info);
    };

    const engine = createSyncEngineFromConfig(
      config,
      this._store,
      this._platformCallbacks,
      mek,
      syncSalt,
      vaultHeaderBytes,
      argon2Params,
      handleMismatch,
    );

    if (engine) {
      this._engine = engine;
      if (withInitialSync) {
        this._disconnect = initSyncEngine(engine, this._store as Parameters<typeof initSyncEngine>[1]);
      } else {
        this._disconnect = connectSyncEngine(this._store as Parameters<typeof connectSyncEngine>[0], engine);
      }
    }
  }
}
```

- [ ] **Step 2: Export from index.ts**

Add to `packages/core/src/sync/index.ts`:

```typescript
export { SyncLifecycle } from './sync-lifecycle.js';
export type { PlatformStorage, SyncLifecycleCallbacks } from './sync-lifecycle.js';
```

- [ ] **Step 3: Build core to verify compilation**

Run: `pnpm --filter @keykeykey/core build`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sync/sync-lifecycle.ts packages/core/src/sync/index.ts
git commit -m "feat(sync): add SyncLifecycle class with PlatformStorage interface"
```

---

### Task 2: SyncLifecycle tests

**Files:**

- Create: `packages/core/src/sync/sync-lifecycle.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/sync/sync-lifecycle.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncLifecycle } from './sync-lifecycle.js';
import type { PlatformStorage, SyncLifecycleCallbacks } from './sync-lifecycle.js';
import type { SyncableStore } from './sync-engine.js';
import type { SyncConfig } from './sync-config.js';
import { DEFAULT_SYNC_CONFIG, encryptSyncConfig } from './sync-config.js';
import { randomBytes } from '@noble/hashes/utils';
import { createVaultHeader, unlockVault, serializeVaultHeader } from '../crypto/vault-header.js';
import { toBase64 } from '../utils/base64.js';

// Lightweight Argon2 params for tests
const TEST_PARAMS = { t: 1, m: 8192, p: 1, dkLen: 32 };
const TEST_PASSWORD = 'test-password-123';

function createMockStorage(): PlatformStorage {
  const files = new Map<string, Uint8Array>();
  const items = new Map<string, { id: string; encrypted_data: string; type: string; createdAt: string; updatedAt: string }>();
  let headerB64: string | null = null;
  let setupComplete = false;

  return {
    loadSyncConfigFile: vi.fn(async () => files.get('sync-config') ?? null),
    saveSyncConfigFile: vi.fn(async (data: Uint8Array) => { files.set('sync-config', data); }),
    deleteSyncConfigFile: vi.fn(async () => { files.delete('sync-config'); }),
    saveEncryptedItem: vi.fn(async (id, type, encryptedBase64, createdAt, updatedAt) => {
      items.set(id, { id, encrypted_data: encryptedBase64, type, createdAt, updatedAt });
    }),
    loadAllEncryptedItems: vi.fn(async () => Array.from(items.values())),
    deleteAllItems: vi.fn(async () => { items.clear(); }),
    saveVaultHeader: vi.fn(async (b64: string) => { headerB64 = b64; }),
    loadVaultHeader: vi.fn(async () => headerB64),
    setVaultSetupComplete: vi.fn(async (c: boolean) => { setupComplete = c; }),
  };
}

function createMockCallbacks(): SyncLifecycleCallbacks {
  return {
    onConfigChanged: vi.fn(),
    onMismatch: vi.fn(),
    onMismatchCleared: vi.fn(),
    onItemsChanged: vi.fn(),
  };
}

async function createTestVaultStore() {
  const recoveryKey = randomBytes(32);
  const { header, dek } = await createVaultHeader(TEST_PASSWORD, recoveryKey, TEST_PARAMS);
  const items: import('../models/vault-item.js').VaultItem[] = [];

  const store: SyncableStore & { subscribe: Function } = {
    getState: () => ({
      status: 'unlocked' as const,
      items,
      header,
      encryptItem: (item: import('../models/vault-item.js').VaultItem) => {
        const { encrypt } = require('../crypto/encryption.js');
        return encrypt(new TextEncoder().encode(JSON.stringify(item)), dek);
      },
      getDEK: () => dek,
    }),
    setState: (partial: Partial<{ items: import('../models/vault-item.js').VaultItem[] }>) => {
      if (partial.items) items.length = 0, items.push(...partial.items);
    },
    getVaultId: () => header.vaultId,
    subscribe: () => () => {},
  };

  return { store, header, dek };
}

describe('SyncLifecycle', () => {
  let storage: PlatformStorage;
  let callbacks: SyncLifecycleCallbacks;

  beforeEach(() => {
    storage = createMockStorage();
    callbacks = createMockCallbacks();
  });

  describe('initAfterUnlock', () => {
    it('should return DEFAULT_SYNC_CONFIG when no config file exists', async () => {
      const { store } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store, storage, platformCallbacks: {}, callbacks,
        getHeader: () => store.getState().header,
      });
      const config = await lifecycle.initAfterUnlock();
      expect(config).toEqual(DEFAULT_SYNC_CONFIG);
      expect(callbacks.onConfigChanged).toHaveBeenCalledWith(DEFAULT_SYNC_CONFIG);
      expect(lifecycle.engine).toBeNull();
    });

    it('should load and decrypt saved config', async () => {
      const { store, dek } = await createTestVaultStore();
      const savedConfig: SyncConfig = {
        provider: 'webdav',
        masterPassword: TEST_PASSWORD,
        webdav: { url: 'https://dav.example.com', username: 'u', password: 'p' },
      };
      const encrypted = encryptSyncConfig(savedConfig, dek);
      await storage.saveSyncConfigFile(encrypted);

      const lifecycle = new SyncLifecycle({
        store, storage, platformCallbacks: {}, callbacks,
        getHeader: () => store.getState().header,
      });
      const config = await lifecycle.initAfterUnlock();
      expect(config).toEqual(savedConfig);
    });

    it('should return DEFAULT_SYNC_CONFIG on corrupted config', async () => {
      const { store } = await createTestVaultStore();
      await storage.saveSyncConfigFile(new Uint8Array([1, 2, 3]));

      const lifecycle = new SyncLifecycle({
        store, storage, platformCallbacks: {}, callbacks,
        getHeader: () => store.getState().header,
      });
      const config = await lifecycle.initAfterUnlock();
      expect(config).toEqual(DEFAULT_SYNC_CONFIG);
    });
  });

  describe('saveConfig', () => {
    it('should persist encrypted config', async () => {
      const { store, dek } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store, storage, platformCallbacks: {}, callbacks,
        getHeader: () => store.getState().header,
      });
      await lifecycle.initAfterUnlock();

      const config: SyncConfig = { provider: 'webdav', masterPassword: TEST_PASSWORD, webdav: { url: 'https://x.com', username: 'u', password: 'p' } };
      await lifecycle.saveConfig(config);

      expect(storage.saveSyncConfigFile).toHaveBeenCalled();
      expect(lifecycle.config).toEqual(config);
      expect(callbacks.onConfigChanged).toHaveBeenCalledWith(config);
    });

    it('should teardown engine when saving provider none', async () => {
      const { store } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store, storage, platformCallbacks: {}, callbacks,
        getHeader: () => store.getState().header,
      });
      await lifecycle.initAfterUnlock();
      await lifecycle.saveConfig({ provider: 'none' });
      expect(lifecycle.engine).toBeNull();
    });
  });

  describe('teardown', () => {
    it('should null out engine and config', async () => {
      const { store } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store, storage, platformCallbacks: {}, callbacks,
        getHeader: () => store.getState().header,
      });
      await lifecycle.initAfterUnlock();
      lifecycle.teardown();
      expect(lifecycle.engine).toBeNull();
      expect(lifecycle.config).toBeNull();
    });
  });

  describe('triggerSync', () => {
    it('should return error when no engine', async () => {
      const { store } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store, storage, platformCallbacks: {}, callbacks,
        getHeader: () => store.getState().header,
      });
      const result = await lifecycle.triggerSync();
      expect(result.error).toBe('No sync engine');
    });
  });

  describe('getStatus', () => {
    it('should return isSyncing false when no engine', async () => {
      const { store } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store, storage, platformCallbacks: {}, callbacks,
        getHeader: () => store.getState().header,
      });
      expect(lifecycle.getStatus()).toEqual({ isSyncing: false });
    });
  });

  describe('validateMasterPassword', () => {
    it('should return true for correct password', async () => {
      const { store } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store, storage, platformCallbacks: {}, callbacks,
        getHeader: () => store.getState().header,
      });
      await lifecycle.initAfterUnlock();
      const valid = await lifecycle.validateMasterPassword(TEST_PASSWORD);
      expect(valid).toBe(true);
    });

    it('should return false for wrong password', async () => {
      const { store } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store, storage, platformCallbacks: {}, callbacks,
        getHeader: () => store.getState().header,
      });
      await lifecycle.initAfterUnlock();
      const valid = await lifecycle.validateMasterPassword('wrong-password');
      expect(valid).toBe(false);
    });
  });

  describe('clearMismatch', () => {
    it('should reset config to none and call callbacks', async () => {
      const { store } = await createTestVaultStore();
      const lifecycle = new SyncLifecycle({
        store, storage, platformCallbacks: {}, callbacks,
        getHeader: () => store.getState().header,
      });
      await lifecycle.initAfterUnlock();
      await lifecycle.clearMismatch();
      expect(lifecycle.config).toEqual({ provider: 'none' });
      expect(lifecycle.mismatchInfo).toBeNull();
      expect(callbacks.onMismatchCleared).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/sync-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 3: Run all core tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sync/sync-lifecycle.test.ts
git commit -m "test(sync): add SyncLifecycle unit tests"
```

---

## Chunk 2: Desktop Refactor

### Task 3: Refactor desktop to use SyncLifecycle

**Files:**

- Modify: `apps/desktop/src/lib/sync.ts`
- Modify: `apps/desktop/src/lib/vault-context.tsx`

- [ ] **Step 1: Add createDesktopPlatformStorage to sync.ts**

In `apps/desktop/src/lib/sync.ts`, add a factory function that creates the `PlatformStorage` implementation using the existing Tauri fs helpers. Keep the fetch proxy functions (`installFetchProxy`, `setSyncUrlPrefix`) as-is. Remove the re-exports of `createSyncEngineFromConfig`, `initSyncEngine`, `connectSyncEngine` since they're now handled by `SyncLifecycle`.

Add this function:

```typescript
import type { PlatformStorage } from '@keykeykey/core/sync';

export function createDesktopPlatformStorage(): PlatformStorage {
  return {
    loadSyncConfigFile: async () => {
      try {
        const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
        return await readFile('sync-config.bin', { baseDir: BaseDirectory.AppData });
      } catch {
        return null;
      }
    },
    saveSyncConfigFile: async (data: Uint8Array) => {
      const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await writeFile('sync-config.bin', data, { baseDir: BaseDirectory.AppData });
    },
    deleteSyncConfigFile: async () => {
      try {
        const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
        await remove('sync-config.bin', { baseDir: BaseDirectory.AppData });
      } catch { /* file may not exist */ }
    },
    saveEncryptedItem: async (id, type, encryptedBase64, createdAt, updatedAt) => {
      await saveEncryptedItem(id, type, encryptedBase64, createdAt, updatedAt);
    },
    loadAllEncryptedItems: async () => {
      return await loadAllEncryptedItems();
    },
    deleteAllItems: async () => {
      await deleteAllEncryptedItems();
    },
    saveVaultHeader: async (headerBase64: string) => {
      await saveVaultHeaderToStorage(headerBase64);
    },
    loadVaultHeader: async () => {
      return await loadVaultHeaderFromStorage();
    },
    setVaultSetupComplete: async (complete: boolean) => {
      await setVaultSetupComplete(complete);
    },
    setSyncUrlPrefix: async (prefix: string | null) => {
      await setSyncUrlPrefix(prefix);
    },
  };
}
```

Note: The exact names of the imported Tauri storage functions (`saveEncryptedItem`, `loadAllEncryptedItems`, `deleteAllEncryptedItems`, `saveVaultHeaderToStorage`, `loadVaultHeaderFromStorage`, `setVaultSetupComplete`) must match the existing functions in `vault-context.tsx`. Read the existing vault-context to get the exact function names and imports, then wire them into the PlatformStorage.

- [ ] **Step 2: Refactor vault-context.tsx to use SyncLifecycle**

In `apps/desktop/src/lib/vault-context.tsx`:

1. Import `SyncLifecycle` from `@keykeykey/core/sync`
2. Import `createDesktopPlatformStorage` from `./sync`
3. Replace `syncEngineRef`, `syncDisconnectRef` with a single `lifecycleRef = useRef<SyncLifecycle | null>(null)`
4. Create the lifecycle after store creation:

```typescript
const lifecycleRef = useRef<SyncLifecycle | null>(null);

// Create lifecycle once after store is initialized
useEffect(() => {
  if (storeRef.current && !lifecycleRef.current) {
    lifecycleRef.current = new SyncLifecycle({
      store: syncableStore,
      storage: createDesktopPlatformStorage(),
      platformCallbacks: {},
      callbacks: {
        onConfigChanged: (config) => setSyncConfig(config),
        onMismatch: (info) => setVaultMismatchInfo(info),
        onMismatchCleared: () => setVaultMismatchInfo(null),
        onItemsChanged: () => syncItems(),
      },
      getHeader: () => storeRef.current.getState().header ?? null,
    });
  }
}, [syncableStore, syncItems]);
```

5. Replace all sync methods with one-liner delegates:

```typescript
const initSyncAfterUnlock = useCallback(async () => {
  await lifecycleRef.current?.initAfterUnlock();
}, []);

const saveSyncConfigAction = useCallback(async (config: SyncConfig) => {
  await lifecycleRef.current?.saveConfig(config);
}, []);

const triggerSync = useCallback(async () => {
  return lifecycleRef.current?.triggerSync() ?? { lastSynced: null, error: 'No lifecycle' };
}, []);

const getSyncStatus = useCallback(() => {
  return lifecycleRef.current?.getStatus() ?? { isSyncing: false };
}, []);

const validateMasterPassword = useCallback(async (password: string) => {
  return lifecycleRef.current?.validateMasterPassword(password) ?? false;
}, []);

const clearVaultMismatch = useCallback(async () => {
  await lifecycleRef.current?.clearMismatch();
}, []);

const replaceRemoteVault = useCallback(async () => {
  return lifecycleRef.current?.replaceRemote() ?? { success: false, error: 'No lifecycle' };
}, []);

const mergeRemoteVault = useCallback(async () => {
  return lifecycleRef.current?.mergeVaults() ?? { success: false, error: 'No lifecycle' };
}, []);

const replaceLocalVault = useCallback(async () => {
  return lifecycleRef.current?.replaceLocal() ?? { success: false, error: 'No lifecycle' };
}, []);

const restoreFromCloudAction = useCallback(async (config: SyncConfig, masterPassword: string) => {
  const result = await lifecycleRef.current?.restoreFromCloud(config, masterPassword);
  if (!result?.success) return result ?? { success: false, error: 'No lifecycle' };
  // restoreFromCloud saves to storage but doesn't update the in-memory store.
  // Re-create and unlock the store, then init sync engine.
  // (Replicate the existing desktop restoreFromCloudAction pattern:
  //  create new store → load header → unlock → syncItems → initSyncAfterUnlock)
  await initialize(); // re-reads header and items from storage
  return result;
}, [initialize]);
```

6. Update `lock` to call `lifecycleRef.current?.teardown()`
7. Update `resetVault` to call `lifecycleRef.current?.teardown()` and `storage.deleteSyncConfigFile()`
8. Update `removeItem` to call `lifecycleRef.current?.recordTombstone(id)`
9. Remove all the old `initSyncAfterUnlock`, `saveSyncConfigAction`, `handleVaultMismatch`, `clearVaultMismatch`, `replaceRemoteVault`, `mergeRemoteVault`, `replaceLocalVault`, `restoreFromCloudAction` implementations (~300 lines)
10. Remove unused imports (`deriveMEK`, `generateSyncSalt`, `createAdapterFromConfig`, `deriveMEKFromAdapter`, `restoreFromCloud`, `deleteCloudVault`, `mergeItemSets`, `createSyncEngineFromConfig`, `initSyncEngine`, `connectSyncEngine`, `readPreambleFromBlob`, `validateArgon2Params`, `PREAMBLE_SIZE`, `SyncEngine`)

- [ ] **Step 3: Build desktop**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/desktop build`
Expected: BUILD SUCCESS

- [ ] **Step 4: Run desktop tests**

Run: `pnpm --filter @keykeykey/desktop test`
Expected: PASS (same public API — tests should pass without changes)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/sync.ts apps/desktop/src/lib/vault-context.tsx
git commit -m "refactor(desktop): replace sync orchestration with SyncLifecycle delegation"
```

---

## Chunk 3: Mobile Completion

### Task 4: Refactor mobile vault-context to use SyncLifecycle

**Files:**

- Modify: `apps/mobile/lib/sync.ts`
- Modify: `apps/mobile/lib/vault-context.tsx`

- [ ] **Step 1: Add createMobilePlatformStorage to sync.ts**

Replace the content of `apps/mobile/lib/sync.ts` with:

```typescript
import {
  encryptSyncConfig,
  decryptSyncConfig,
  DEFAULT_SYNC_CONFIG,
} from '@keykeykey/core/sync';
import type { PlatformStorage, SyncConfig } from '@keykeykey/core/sync';
import * as FileSystem from 'expo-file-system';

const SYNC_CONFIG_PATH = `${FileSystem.documentDirectory}sync-config.bin`;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createMobilePlatformStorage(
  saveEncryptedItem: (id: string, type: string, enc: string, createdAt: string, updatedAt: string) => Promise<void>,
  loadAllEncryptedItems: () => Promise<Array<{ id: string; encrypted_data: string }>>,
  deleteAllItems: () => Promise<void>,
  saveVaultHeader: (b64: string) => Promise<void>,
  loadVaultHeader: () => Promise<string | null>,
  setVaultSetupComplete: (complete: boolean) => Promise<void>,
): PlatformStorage {
  return {
    loadSyncConfigFile: async () => {
      const info = await FileSystem.getInfoAsync(SYNC_CONFIG_PATH);
      if (!info.exists) return null;
      const b64 = await FileSystem.readAsStringAsync(SYNC_CONFIG_PATH, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return base64ToUint8(b64);
    },
    saveSyncConfigFile: async (data: Uint8Array) => {
      await FileSystem.writeAsStringAsync(SYNC_CONFIG_PATH, uint8ToBase64(data), {
        encoding: FileSystem.EncodingType.Base64,
      });
    },
    deleteSyncConfigFile: async () => {
      try {
        await FileSystem.deleteAsync(SYNC_CONFIG_PATH, { idempotent: true });
      } catch { /* may not exist */ }
    },
    saveEncryptedItem,
    loadAllEncryptedItems,
    deleteAllItems,
    saveVaultHeader,
    loadVaultHeader,
    setVaultSetupComplete,
  };
}
```

- [ ] **Step 2: Refactor mobile vault-context.tsx**

Apply the same pattern as desktop (Task 3 Step 2):

1. Import `SyncLifecycle` and `createMobilePlatformStorage`
2. Replace sync engine refs with `lifecycleRef`
3. Create lifecycle with callbacks that update React state
4. Replace all sync methods with one-liner delegates
5. Remove `vaultReplaced` state — replace with `vaultMismatchInfo`
6. Add new context methods: `clearVaultMismatch`, `replaceRemoteVault`, `mergeRemoteVault`, `replaceLocalVault`, `restoreFromCloud`
7. Update `VaultContextType` to include the new methods and remove `vaultReplaced`
8. Update `lock` and `resetVault` to call `lifecycle.teardown()`
9. Update `removeItem` to call `lifecycle.recordTombstone(id)`

- [ ] **Step 3: Build and test**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/mobile test`
Expected: Some tests may fail due to `vaultReplaced` removal — update mocks in next step.

- [ ] **Step 4: Update mobile test mocks**

In `apps/mobile/__tests__/screens/sync-settings.test.tsx` and `apps/mobile/__tests__/screens/settings.test.tsx`, update `useVault` mock to:
- Remove `vaultReplaced`
- Add `vaultMismatchInfo: null`, `clearVaultMismatch: jest.fn()`, `replaceRemoteVault: jest.fn()`, `mergeRemoteVault: jest.fn()`, `replaceLocalVault: jest.fn()`, `restoreFromCloud: jest.fn()`

- [ ] **Step 5: Run all mobile tests**

Run: `pnpm --filter @keykeykey/mobile test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/sync.ts apps/mobile/lib/vault-context.tsx apps/mobile/__tests__/
git commit -m "refactor(mobile): replace sync logic with SyncLifecycle, add mismatch resolution methods"
```

---

### Task 5: Mobile restore screen

**Files:**

- Create: `apps/mobile/app/restore.tsx`
- Modify: `apps/mobile/app/setup.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Add restore route to _layout.tsx**

In `apps/mobile/app/_layout.tsx`, add after the existing `Stack.Screen` entries:

```tsx
<Stack.Screen
  name="restore"
  options={{ presentation: 'card', animation: 'slide_from_right', headerShown: false }}
/>
```

- [ ] **Step 2: Create restore.tsx**

Create `apps/mobile/app/restore.tsx` — a multi-step restore wizard. Follow the same flow as desktop's `RestoreScreen.tsx` but with React Native components:

```tsx
import { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';
import type { SyncConfig } from '@keykeykey/core/sync';

type Step = 'provider' | 'password' | 'restoring' | 'success';

export default function RestoreScreen() {
  const { theme: t } = useTheme();
  const router = useRouter();
  const { restoreFromCloud } = useVault();

  const [step, setStep] = useState<Step>('provider');
  const [error, setError] = useState<string | null>(null);

  // Provider fields
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');

  // Password field
  const [masterPassword, setMasterPassword] = useState('');
  const [itemCount, setItemCount] = useState(0);

  const canProceedProvider =
    webdavUrl.trim() !== '' && webdavUsername.trim() !== '' && webdavPassword.trim() !== '';

  const handleRestore = async () => {
    setStep('restoring');
    setError(null);

    const config: SyncConfig = {
      provider: 'webdav',
      webdav: { url: webdavUrl.trim(), username: webdavUsername.trim(), password: webdavPassword },
    };

    // Yield to let spinner render
    await new Promise((r) => setTimeout(r, 50));

    const result = await restoreFromCloud(config, masterPassword);

    if (result.success) {
      setItemCount(result.itemCount ?? 0);
      setStep('success');
    } else {
      const err = result.error ?? 'Unknown error';
      const isConnectionError =
        /network|fetch|ECONNREFUSED|URL not allowed|No vault data found/i.test(err);
      setError(err);
      setStep(isConnectionError ? 'provider' : 'password');
    }
  };

  const handleBack = () => {
    if (step === 'password') {
      setStep('provider');
      setError(null);
    } else {
      router.back();
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <View style={styles.container}>
        {/* Header */}
        {(step === 'provider' || step === 'password') && (
          <View style={styles.header}>
            <Pressable onPress={handleBack} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={t.colors.text} />
            </Pressable>
            <Text style={[styles.title, { color: t.colors.text }]}>Restore from Cloud</Text>
          </View>
        )}

        {/* Error */}
        {error && (
          <View style={[styles.errorBox, { backgroundColor: t.colors.errorLight }]}>
            <Ionicons name="alert-circle" size={18} color={t.colors.error} />
            <Text style={[styles.errorText, { color: t.colors.error }]}>{error}</Text>
          </View>
        )}

        {/* Step: Provider */}
        {step === 'provider' && (
          <View style={styles.form}>
            <TextInput label="WebDAV URL" value={webdavUrl} onChangeText={setWebdavUrl}
              placeholder="https://dav.example.com/remote.php/dav/files/user/" />
            <TextInput label="Username" value={webdavUsername} onChangeText={setWebdavUsername}
              placeholder="Username" />
            <TextInput label="Password" value={webdavPassword} onChangeText={setWebdavPassword}
              placeholder="Password" isPassword />
            <Button title="Next" onPress={() => { setError(null); setStep('password'); }}
              disabled={!canProceedProvider} />
          </View>
        )}

        {/* Step: Password */}
        {step === 'password' && (
          <View style={styles.form}>
            <Text style={[styles.description, { color: t.colors.textSecondary }]}>
              Enter the master password for the vault stored on the cloud.
            </Text>
            <TextInput label="Master Password" value={masterPassword} onChangeText={setMasterPassword}
              placeholder="Enter your vault master password" isPassword />
            <Button title="Restore Vault" onPress={handleRestore}
              disabled={masterPassword.trim() === ''} />
          </View>
        )}

        {/* Step: Restoring */}
        {step === 'restoring' && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={t.colors.primary} />
            <Text style={[styles.statusText, { color: t.colors.textSecondary }]}>
              Downloading and decrypting your vault...
            </Text>
          </View>
        )}

        {/* Step: Success */}
        {step === 'success' && (
          <View style={styles.centered}>
            <Ionicons name="checkmark-circle" size={48} color={t.colors.success} />
            <Text style={[styles.successTitle, { color: t.colors.text }]}>Vault Restored</Text>
            <Text style={[styles.statusText, { color: t.colors.textSecondary }]}>
              {itemCount} item{itemCount === 1 ? '' : 's'} restored from cloud.
            </Text>
            <Button title="Go to Vault" onPress={() => router.replace('/(tabs)')} />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  backButton: { padding: 4 },
  title: { fontSize: 24, fontWeight: '700' },
  form: { gap: 16 },
  description: { fontSize: 14, marginBottom: 8 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, marginBottom: 16 },
  errorText: { fontSize: 14, flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  statusText: { fontSize: 16, textAlign: 'center' },
  successTitle: { fontSize: 20, fontWeight: '600' },
});
```

- [ ] **Step 3: Enable restore button in setup.tsx**

In `apps/mobile/app/setup.tsx`, find the disabled "Restore from Cloud" button and its "Coming soon" text. Replace with:

```tsx
<View style={{ marginTop: 16 }}>
  <Button
    title="Restore from Cloud"
    variant="secondary"
    onPress={() => router.push('/restore')}
  />
</View>
```

Remove the "Coming soon" `<Text>` element. Ensure `router` is available from `useRouter()`.

- [ ] **Step 4: Build and verify**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/mobile test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/restore.tsx apps/mobile/app/setup.tsx apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): add Restore from Cloud screen and enable setup button"
```

---

### Task 6: Mobile mismatch dialog in sync settings

**Files:**

- Modify: `apps/mobile/app/settings/sync.tsx`

- [ ] **Step 1: Add mismatch dialog**

In `apps/mobile/app/settings/sync.tsx`:

1. Add `vaultMismatchInfo`, `clearVaultMismatch`, `replaceRemoteVault`, `mergeRemoteVault`, `replaceLocalVault` to the `useVault()` destructuring
2. Add state for loading: `merging`, `replacingLocal`, `replacingRemote`
3. Add handler functions matching desktop's pattern
4. Add mismatch modal UI at the bottom of the component (using React Native `Modal` or overlay `View`):

```tsx
{/* Vault Mismatch Dialog */}
{vaultMismatchInfo != null && (
  <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
    <View style={[styles.dialog, { backgroundColor: t.colors.surface }]}>
      <Ionicons name="alert-triangle" size={32} color={t.colors.warning} />
      <Text style={[styles.dialogTitle, { color: t.colors.text }]}>
        {vaultMismatchInfo.canRestore ? 'Remote Vault Detected' : 'Incompatible Remote Vault'}
      </Text>
      <Text style={[styles.dialogDescription, { color: t.colors.textSecondary }]}>
        {vaultMismatchInfo.canRestore
          ? `The remote server has a vault with ${vaultMismatchInfo.remoteItemCount} item${vaultMismatchInfo.remoteItemCount === 1 ? '' : 's'}. Choose how to resolve:`
          : 'The remote server has vault data encrypted with a different password.'}
      </Text>

      {vaultMismatchInfo.canRestore && (
        <>
          <Button title={merging ? 'Merging...' : 'Merge Vaults'} onPress={handleMismatchMerge}
            loading={merging} disabled={merging || replacingLocal || replacingRemote} />
          <Button title={replacingLocal ? 'Replacing...' : 'Replace Local with Remote'}
            onPress={handleMismatchReplaceLocal} variant="secondary"
            loading={replacingLocal} disabled={merging || replacingLocal || replacingRemote} />
        </>
      )}
      <Button title={replacingRemote ? 'Replacing...' : 'Replace Remote with Local'}
        onPress={handleMismatchReplace} variant="danger"
        loading={replacingRemote} disabled={merging || replacingLocal || replacingRemote} />
      <Button title="Cancel" onPress={handleMismatchCancel} variant="secondary"
        disabled={merging || replacingLocal || replacingRemote} />
    </View>
  </View>
)}
```

Add styles for `overlay`, `dialog`, `dialogTitle`, `dialogDescription`.

- [ ] **Step 2: Run mobile tests**

Run: `pnpm --filter @keykeykey/mobile test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/settings/sync.tsx
git commit -m "feat(mobile): add vault mismatch resolution dialog to sync settings"
```

---

### Task 7: Mobile tests for new screens

**Files:**

- Modify: `apps/mobile/__tests__/screens/sync-settings.test.tsx`
- Create: `apps/mobile/__tests__/screens/restore.test.tsx`

- [ ] **Step 1: Add mismatch tests to sync-settings.test.tsx**

Add these tests to the existing describe block:

```typescript
it('shows mismatch dialog when vaultMismatchInfo is set', () => {
  mockVaultState.vaultMismatchInfo = {
    localVaultId: 'local-1',
    remoteVaultId: 'remote-1',
    canRestore: true,
    remoteItemCount: 5,
    remoteVaultHeader: null,
  };
  const { getByText } = render(<SyncSettingsScreen />);
  expect(getByText('Remote Vault Detected')).toBeTruthy();
  expect(getByText(/5 items/)).toBeTruthy();
  expect(getByText('Merge Vaults')).toBeTruthy();
  expect(getByText('Replace Local with Remote')).toBeTruthy();
  expect(getByText('Replace Remote with Local')).toBeTruthy();
  expect(getByText('Cancel')).toBeTruthy();
});

it('calls clearVaultMismatch on Cancel', async () => {
  mockVaultState.vaultMismatchInfo = {
    localVaultId: 'l', remoteVaultId: 'r', canRestore: true, remoteItemCount: 3, remoteVaultHeader: null,
  };
  const { getByText } = render(<SyncSettingsScreen />);
  fireEvent.press(getByText('Cancel'));
  await waitFor(() => {
    expect(mockVaultState.clearVaultMismatch).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Create restore screen test**

Create `apps/mobile/__tests__/screens/restore.test.tsx` with basic tests:
- Renders provider step with WebDAV fields
- Next button disabled until fields filled
- Shows password step after Next
- Back button returns to provider step

- [ ] **Step 3: Run all mobile tests**

Run: `pnpm --filter @keykeykey/mobile test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/__tests__/screens/sync-settings.test.tsx apps/mobile/__tests__/screens/restore.test.tsx
git commit -m "test(mobile): add mismatch dialog and restore screen tests"
```

---

## Chunk 4: Extension Completion

### Task 8: Update extension message types

**Files:**

- Modify: `apps/extension/src/lib/messages.ts`

- [ ] **Step 1: Add new message types**

In `apps/extension/src/lib/messages.ts`, add to the `BackgroundMessage` union type:

```typescript
| { type: 'VALIDATE_MASTER_PASSWORD'; password: string }
| { type: 'RESTORE_FROM_CLOUD'; config: SyncConfig; masterPassword: string }
| { type: 'GET_MISMATCH_INFO' }
| { type: 'CLEAR_MISMATCH' }
| { type: 'REPLACE_REMOTE' }
| { type: 'REPLACE_LOCAL' }
| { type: 'MERGE_VAULTS' }
```

Import `SyncConfig` from `@keykeykey/core/sync` if not already imported.

- [ ] **Step 2: Commit**

```bash
git add apps/extension/src/lib/messages.ts
git commit -m "feat(extension): add sync message types for mismatch resolution and restore"
```

---

### Task 9: Refactor extension background sync

**Files:**

- Modify: `apps/extension/src/background/storage.ts`
- Modify: `apps/extension/src/background/sync.ts`
- Modify: `apps/extension/src/background/message-handler.ts`

- [ ] **Step 1: Add PlatformStorage to storage.ts**

In `apps/extension/src/background/storage.ts`, add:

```typescript
import type { PlatformStorage } from '@keykeykey/core/sync';

export function createExtensionPlatformStorage(): PlatformStorage {
  return {
    loadSyncConfigFile: async () => {
      const result = await browser.storage.local.get('sync_config_encrypted');
      const b64 = result.sync_config_encrypted;
      if (!b64 || typeof b64 !== 'string') return null;
      return fromBase64(b64);
    },
    saveSyncConfigFile: async (data: Uint8Array) => {
      await browser.storage.local.set({ sync_config_encrypted: toBase64(data) });
    },
    deleteSyncConfigFile: async () => {
      await browser.storage.local.remove(['sync_config_encrypted', 'sync_config']);
    },
    saveEncryptedItem: async (id, type, encryptedBase64, createdAt, updatedAt) => {
      await browser.storage.local.set({
        [`item_${id}`]: { encrypted_data: encryptedBase64, type, createdAt, updatedAt },
      });
    },
    loadAllEncryptedItems: async () => {
      const all = await browser.storage.local.get(null);
      const items: Array<{ id: string; encrypted_data: string }> = [];
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith('item_') && value && typeof value === 'object' && 'encrypted_data' in value) {
          items.push({ id: key.slice(5), encrypted_data: (value as { encrypted_data: string }).encrypted_data });
        }
      }
      return items;
    },
    deleteAllItems: async () => {
      const all = await browser.storage.local.get(null);
      const itemKeys = Object.keys(all).filter((k) => k.startsWith('item_'));
      if (itemKeys.length > 0) await browser.storage.local.remove(itemKeys);
    },
    saveVaultHeader: async (headerBase64: string) => {
      await browser.storage.local.set({ vault_header: headerBase64 });
    },
    loadVaultHeader: async () => {
      const result = await browser.storage.local.get('vault_header');
      return result.vault_header ?? null;
    },
    setVaultSetupComplete: async (complete: boolean) => {
      await browser.storage.local.set({ vault_setup_complete: complete });
    },
  };
}
```

Note: Check how the extension currently stores items (`saveEncryptedItem` in `storage.ts`). The key format must match what existing code uses. If it uses `item_${id}` keys with bare string values, update `loadAllEncryptedItems` to handle both old format (bare string) and new format (object with metadata).

- [ ] **Step 2: Rewrite sync.ts with SyncLifecycle**

Replace `apps/extension/src/background/sync.ts` with:

```typescript
import { SyncLifecycle } from '@keykeykey/core/sync';
import type { SyncConfig, SyncableStore, PlatformStorage } from '@keykeykey/core/sync';
import type { VaultMismatchInfo } from '@keykeykey/core/sync';
import { createExtensionPlatformStorage } from './storage.js';

let lifecycle: SyncLifecycle | null = null;
let currentConfig: SyncConfig | null = null;
let mismatchInfo: VaultMismatchInfo | null = null;

export interface SyncCompatibleStore extends SyncableStore {
  subscribe: (
    listener: (
      state: { status: string; items: unknown[] },
      prevState: { status: string; items: unknown[] },
    ) => void,
  ) => () => void;
}

export function getLifecycle(): SyncLifecycle | null {
  return lifecycle;
}

export function initLifecycle(store: SyncCompatibleStore): SyncLifecycle {
  lifecycle = new SyncLifecycle({
    store,
    storage: createExtensionPlatformStorage(),
    platformCallbacks: {},
    callbacks: {
      onConfigChanged: (config) => { currentConfig = config; },
      onMismatch: (info) => { mismatchInfo = info; },
      onMismatchCleared: () => { mismatchInfo = null; },
      onItemsChanged: () => { /* items are re-read from store on GET_ITEMS */ },
    },
  });
  return lifecycle;
}

export function getSyncStatus() {
  const status = lifecycle?.getStatus() ?? { isSyncing: false };
  return {
    provider: currentConfig?.provider ?? 'none',
    isSyncing: status.isSyncing,
    lastSynced: null as string | null,
    error: null as string | null,
  };
}

export function getMismatchInfo(): VaultMismatchInfo | null {
  return mismatchInfo;
}

export function teardownLifecycle(): void {
  lifecycle?.teardown();
  lifecycle = null;
  currentConfig = null;
  mismatchInfo = null;
}
```

- [ ] **Step 3: Update message-handler.ts**

In `apps/extension/src/background/message-handler.ts`:

1. Replace imports from `./sync.js`:

```typescript
import { initLifecycle, getLifecycle, getSyncStatus, getMismatchInfo, teardownLifecycle } from './sync.js';
```

2. In the `UNLOCK` handler, after `store.getState().unlock(...)`:

```typescript
const lc = initLifecycle(syncableStore);
await lc.initAfterUnlock();
```

3. In the `UNLOCK_PIN` handler, same pattern.

4. Replace sync message handlers:

```typescript
case 'GET_SYNC_STATUS':
  return getSyncStatus();

case 'CONFIGURE_SYNC': {
  const lc = getLifecycle();
  if (!lc) return { error: 'Vault locked' };
  await lc.saveConfig(message.config);
  return { ok: true };
}

case 'TRIGGER_SYNC': {
  const lc = getLifecycle();
  if (!lc) return { ok: false, error: 'Vault locked' };
  return await lc.triggerSync();
}

case 'DISCONNECT_SYNC': {
  const lc = getLifecycle();
  if (!lc) return { error: 'Vault locked' };
  await lc.saveConfig({ provider: 'none' });
  return { ok: true };
}

case 'VALIDATE_MASTER_PASSWORD': {
  const lc = getLifecycle();
  if (!lc) return { error: 'Vault locked' };
  const valid = await lc.validateMasterPassword(message.password);
  return { valid };
}

case 'RESTORE_FROM_CLOUD': {
  const lc = getLifecycle() ?? initLifecycle(syncableStore);
  return await lc.restoreFromCloud(message.config, message.masterPassword);
}

case 'GET_MISMATCH_INFO':
  return { mismatchInfo: getMismatchInfo() };

case 'CLEAR_MISMATCH': {
  const lc = getLifecycle();
  if (!lc) return { error: 'Vault locked' };
  await lc.clearMismatch();
  return { ok: true };
}

case 'REPLACE_REMOTE': {
  const lc = getLifecycle();
  if (!lc) return { success: false, error: 'Vault locked' };
  return await lc.replaceRemote();
}

case 'REPLACE_LOCAL': {
  const lc = getLifecycle();
  if (!lc) return { success: false, error: 'Vault locked' };
  return await lc.replaceLocal();
}

case 'MERGE_VAULTS': {
  const lc = getLifecycle();
  if (!lc) return { success: false, error: 'Vault locked' };
  return await lc.mergeVaults();
}
```

5. In `LOCK` handler: call `teardownLifecycle()`
6. In `RESET_VAULT` handler: call `teardownLifecycle()`
7. In `DELETE_ITEM` handler: call `getLifecycle()?.recordTombstone(message.id)`

- [ ] **Step 4: Build extension**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/extension build`
Expected: BUILD SUCCESS

- [ ] **Step 5: Run extension tests**

Run: `pnpm --filter @keykeykey/extension test`
Expected: Some tests may fail due to changed sync module — fix in next step.

- [ ] **Step 6: Update extension tests**

Update any test mocks that reference the old `sync.ts` exports (`initSync`, `configureSync`, `triggerSync`, `teardownSync`, `getSyncStatus`, `recordTombstone`) to use the new `initLifecycle`, `getLifecycle`, etc.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/background/sync.ts apps/extension/src/background/message-handler.ts apps/extension/src/background/storage.ts
git commit -m "feat(extension): replace sync module with SyncLifecycle, add mismatch and restore handlers"
```

---

### Task 10: Extension SyncSettingsScreen and RestoreScreen

**Files:**

- Create: `apps/extension/src/popup/screens/SyncSettingsScreen.tsx`
- Create: `apps/extension/src/popup/screens/RestoreScreen.tsx`
- Modify: `apps/extension/src/popup/screens/SettingsScreen.tsx`
- Modify: `apps/extension/src/popup/screens/SetupScreen.tsx`
- Modify: `apps/extension/src/popup/Popup.tsx`

- [ ] **Step 1: Create SyncSettingsScreen.tsx**

Create `apps/extension/src/popup/screens/SyncSettingsScreen.tsx` following the desktop `SyncSettingsScreen.tsx` layout but adapted for extension popup:

- Back button + "Cloud Sync" header
- Provider select (none, webdav, google-drive disabled, icloud disabled)
- WebDAV fields (URL, username, password) + master password field
- Connect / Disconnect / Sync Now buttons
- Sync status display
- Vault mismatch dialog (same 3-option pattern)
- All operations via `sendMessage()` to background
- Uses inline styles with the extension's theme pattern (read existing SettingsScreen for style patterns)

Key communication patterns:

```typescript
// Load sync status on mount
useEffect(() => {
  sendMessage({ type: 'GET_SYNC_STATUS' }).then(setSyncStatus);
  sendMessage({ type: 'GET_MISMATCH_INFO' }).then((r) => setMismatchInfo(r.mismatchInfo));
}, []);

// Connect
const handleConnect = async () => {
  const valid = await sendMessage({ type: 'VALIDATE_MASTER_PASSWORD', password: masterPassword });
  if (!valid.valid) { setSyncError('Incorrect master password'); return; }
  const config = { provider: 'webdav', masterPassword, webdav: { url, username, password } };
  await sendMessage({ type: 'CONFIGURE_SYNC', config });
  const result = await sendMessage({ type: 'TRIGGER_SYNC' });
  // update UI...
};
```

- [ ] **Step 2: Create RestoreScreen.tsx**

Create `apps/extension/src/popup/screens/RestoreScreen.tsx` following the mobile restore pattern but with HTML elements:

- Same 4-step flow: provider → password → restoring → success
- Uses `sendMessage({ type: 'RESTORE_FROM_CLOUD', config, masterPassword })`
- Uses the extension's inline style pattern

- [ ] **Step 3: Update SettingsScreen.tsx**

In `apps/extension/src/popup/screens/SettingsScreen.tsx`:

1. Remove the entire sync section (~120 lines, from "Cloud Sync" label through the sync buttons)
2. Replace with a single clickable row:

```tsx
{/* Cloud Sync */}
<div onClick={() => onNavigate('sync-settings')} style={{
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 0', cursor: 'pointer', borderBottom: `1px solid ${theme.colors.border}`,
}}>
  <div>
    <div style={{ fontSize: 14, color: theme.colors.text }}>Cloud Sync</div>
    <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
      {syncStatus?.provider === 'none' || !syncStatus?.provider
        ? 'Not configured'
        : `Connected via ${syncStatus.provider}`}
    </div>
  </div>
  <span style={{ color: theme.colors.textSecondary }}>›</span>
</div>
```

3. Keep loading `syncStatus` via `sendMessage({ type: 'GET_SYNC_STATUS' })` on mount for the subtitle.
4. Remove the sync-related state variables (`syncProvider`, `webdavUrl`, `webdavUsername`, `webdavPassword`, `syncing`).

- [ ] **Step 4: Update SetupScreen.tsx**

In `apps/extension/src/popup/screens/SetupScreen.tsx`, find any "Restore from Cloud" button. If it exists as a no-op, update it to call `onNavigate('restore')`. If it doesn't exist, add it after the "Create Vault" button:

```tsx
<button onClick={() => onNavigate('restore')} style={{
  width: '100%', padding: '12px', marginTop: 12,
  backgroundColor: theme.colors.surface,
  border: `1px solid ${theme.colors.border}`,
  borderRadius: 8, color: theme.colors.text,
  cursor: 'pointer', fontSize: 14,
}}>
  Restore from Cloud
</button>
```

- [ ] **Step 5: Update Popup.tsx**

In `apps/extension/src/popup/Popup.tsx`, add screen states and rendering:

```typescript
// In the screen state type or switch:
case 'sync-settings':
  return <SyncSettingsScreen onBack={() => setScreen('settings')} onNavigate={handleNavigate} />;
case 'restore':
  return <RestoreScreen onBack={() => setScreen('list')} onComplete={() => { setScreen('list'); refreshItems(); }} />;
```

Add imports for `SyncSettingsScreen` and `RestoreScreen`.

For `SetupScreen`, pass `onNavigate` so it can navigate to `'restore'`:

```typescript
// In the needs_setup case:
return <SetupScreen onComplete={handleSetupComplete} onNavigate={handleNavigate} />;
```

- [ ] **Step 6: Build extension**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/extension build`
Expected: BUILD SUCCESS

- [ ] **Step 7: Run extension tests**

Run: `pnpm --filter @keykeykey/extension test`
Expected: PASS (update SettingsScreen tests if they reference removed sync UI)

- [ ] **Step 8: Commit**

```bash
git add apps/extension/src/popup/screens/SyncSettingsScreen.tsx apps/extension/src/popup/screens/RestoreScreen.tsx apps/extension/src/popup/screens/SettingsScreen.tsx apps/extension/src/popup/screens/SetupScreen.tsx apps/extension/src/popup/Popup.tsx
git commit -m "feat(extension): add SyncSettingsScreen, RestoreScreen, and wire navigation"
```

---

## Chunk 5: Final Verification

### Task 11: Build, test, format, lint

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: BUILD SUCCESS

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 3: Format**

Run: `pnpm format && pnpm format:check`
Expected: All formatted

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 5: Run critical E2E tests**

Run: `cd e2e && npx playwright test --grep @critical`
Expected: PASS

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "chore: formatting and lint fixes"
```
