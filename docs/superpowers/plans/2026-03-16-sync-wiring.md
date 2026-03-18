# Sync Wiring Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing core SyncEngine and cloud adapters (WebDAV, Google Drive, iCloud) into all platforms (desktop, mobile, extension) with encrypted sync config persistence, auto-sync on item changes, and immediate sync on unlock.

**Architecture:** A new `SyncConfig` model in core defines the provider + credentials shape. Each platform loads/saves this as an encrypted `sync-config.bin` file using the vault DEK. On unlock, the vault context creates a `SyncEngine` with the appropriate adapter, runs an immediate sync, and wires `connectSyncEngine()` for auto-sync. Item deletions call `recordTombstone()` to propagate. Google OAuth is abstracted behind a per-platform `GoogleAuthProvider` interface.

**Tech Stack:** TypeScript, Zustand (vanilla store), XChaCha20-Poly1305 encryption, Vitest, platform APIs (Tauri fs, expo-file-system, browser.storage.local, chrome.identity, browser.identity)

**Spec:** `docs/superpowers/specs/2026-03-16-sync-wiring-design.md`

---

## File Structure

### New files

| File                                         | Responsibility                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/sync/sync-config.ts`      | `SyncConfig` type, `SyncProvider` type, `encryptSyncConfig()`, `decryptSyncConfig()`, `createAdapterFromConfig()`, `getAvailableProviders()` |
| `packages/core/src/sync/sync-config.test.ts` | Tests for config encryption, adapter factory, provider availability                                                                          |
| `apps/desktop/src/lib/sync.ts`               | Desktop sync wiring: `initSync()`, `teardownSync()`, `saveSyncConfigFile()`, `loadSyncConfigFile()`                                          |
| `apps/mobile/lib/sync.ts`                    | Mobile sync wiring: same functions, using expo-file-system                                                                                   |
| `apps/extension/src/background/sync.ts`      | Extension sync wiring: engine lifecycle, migration from old config format                                                                    |
| `apps/extension/src/lib/google-auth.ts`      | Extension Google OAuth: `createExtensionGoogleAuth()` with Chrome/Firefox/Safari detection                                                   |
| `apps/desktop/src/lib/google-auth.ts`        | Desktop Google OAuth: `createDesktopGoogleAuth()` using localhost callback                                                                   |
| `apps/mobile/lib/google-auth.ts`             | Mobile Google OAuth: `createMobileGoogleAuth()` using expo-auth-session                                                                      |

### Modified files

| File                                               | Changes                                                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/sync/index.ts`                  | Export new `sync-config.ts` types and functions                                                                                              |
| `apps/desktop/src/lib/vault-context.tsx`           | Add `syncConfig`, `syncStatus`, `saveSyncConfig` to context; wire engine on unlock; call `recordTombstone` on delete; teardown on lock/reset |
| `apps/mobile/lib/vault-context.tsx`                | Same changes as desktop                                                                                                                      |
| `apps/extension/src/background/message-handler.ts` | Replace TRIGGER_SYNC stub; update CONFIGURE_SYNC, DISCONNECT_SYNC, RESET_VAULT                                                               |
| `apps/extension/src/background/storage.ts`         | Add `saveSyncConfigEncrypted()`, `loadSyncConfigEncrypted()`, migration from old format                                                      |
| `apps/extension/src/lib/messages.ts`               | Update `SyncConfig` type to use core's nested shape; update `BackgroundMessage` response types                                               |

---

## Chunk 1: Core SyncConfig Model

### Task 1: SyncConfig types, encryption helpers, adapter factory

**Files:**

- Create: `packages/core/src/sync/sync-config.ts`
- Create: `packages/core/src/sync/sync-config.test.ts`
- Modify: `packages/core/src/sync/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/sync/sync-config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  encryptSyncConfig,
  decryptSyncConfig,
  createAdapterFromConfig,
  getAvailableProviders,
  DEFAULT_SYNC_CONFIG,
} from './sync-config.js';
import type { SyncConfig } from './sync-config.js';
import { randomBytes } from '@noble/hashes/utils';

describe('SyncConfig encryption', () => {
  const dek = randomBytes(32);

  it('should round-trip encrypt/decrypt a WebDAV config', () => {
    const config: SyncConfig = {
      provider: 'webdav',
      webdav: { url: 'https://dav.example.com', username: 'user', password: 'pass' },
    };
    const encrypted = encryptSyncConfig(config, dek);
    const decrypted = decryptSyncConfig(encrypted, dek);
    expect(decrypted).toEqual(config);
  });

  it('should round-trip encrypt/decrypt a Google Drive config', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: 'token-123' },
    };
    const encrypted = encryptSyncConfig(config, dek);
    const decrypted = decryptSyncConfig(encrypted, dek);
    expect(decrypted).toEqual(config);
  });

  it('should round-trip encrypt/decrypt a none config', () => {
    const encrypted = encryptSyncConfig(DEFAULT_SYNC_CONFIG, dek);
    const decrypted = decryptSyncConfig(encrypted, dek);
    expect(decrypted).toEqual(DEFAULT_SYNC_CONFIG);
  });

  it('should produce different ciphertext for same config (random nonce)', () => {
    const config: SyncConfig = { provider: 'none' };
    const a = encryptSyncConfig(config, dek);
    const b = encryptSyncConfig(config, dek);
    expect(a).not.toEqual(b);
  });

  it('should throw on tampered ciphertext', () => {
    const config: SyncConfig = { provider: 'none' };
    const encrypted = encryptSyncConfig(config, dek);
    encrypted[0] ^= 0xff; // tamper
    expect(() => decryptSyncConfig(encrypted, dek)).toThrow();
  });
});

describe('createAdapterFromConfig', () => {
  it('should return null for provider none', () => {
    const adapter = createAdapterFromConfig({ provider: 'none' }, {});
    expect(adapter).toBeNull();
  });

  it('should return WebDavAdapter for webdav provider', () => {
    const config: SyncConfig = {
      provider: 'webdav',
      webdav: { url: 'https://dav.example.com', username: 'u', password: 'p' },
    };
    const adapter = createAdapterFromConfig(config, {});
    expect(adapter).not.toBeNull();
    expect(adapter!.constructor.name).toBe('WebDavAdapter');
  });

  it('should return GoogleDriveAdapter for google-drive provider', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: 'tok' },
    };
    const getAccessToken = async (_rt: string) => 'access-token';
    const adapter = createAdapterFromConfig(config, { getAccessToken });
    expect(adapter).not.toBeNull();
    expect(adapter!.constructor.name).toBe('GoogleDriveAdapter');
  });

  it('should use getChromeAccessToken for __chrome_managed__ sentinel', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: '__chrome_managed__' },
    };
    const getChromeAccessToken = async () => 'chrome-token';
    const adapter = createAdapterFromConfig(config, { getChromeAccessToken });
    expect(adapter).not.toBeNull();
  });

  it('should return ICloudAdapter for icloud provider', () => {
    const config: SyncConfig = {
      provider: 'icloud',
      icloud: { containerPath: '/icloud/keykeykey' },
    };
    const mockFs = {
      readFile: async () => '',
      writeFile: async () => {},
      deleteFile: async () => {},
      listFiles: async () => [],
      exists: async () => false,
      mkdir: async () => {},
    };
    const adapter = createAdapterFromConfig(config, { icloudFs: mockFs });
    expect(adapter).not.toBeNull();
    expect(adapter!.constructor.name).toBe('ICloudAdapter');
  });
});

describe('getAvailableProviders', () => {
  it('should always include none, webdav, google-drive', () => {
    const providers = getAvailableProviders('windows');
    expect(providers).toContain('none');
    expect(providers).toContain('webdav');
    expect(providers).toContain('google-drive');
    expect(providers).not.toContain('icloud');
  });

  it('should include icloud on ios', () => {
    expect(getAvailableProviders('ios')).toContain('icloud');
  });

  it('should include icloud on macos', () => {
    expect(getAvailableProviders('macos')).toContain('icloud');
  });

  it('should include icloud on safari', () => {
    expect(getAvailableProviders('safari')).toContain('icloud');
  });

  it('should not include icloud on android', () => {
    expect(getAvailableProviders('android')).not.toContain('icloud');
  });

  it('should not include icloud on chrome', () => {
    expect(getAvailableProviders('chrome')).not.toContain('icloud');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/sync-config.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement sync-config.ts**

Create `packages/core/src/sync/sync-config.ts`:

```typescript
import { encrypt, decrypt } from '../crypto/encryption.js';
import { WebDavAdapter } from './webdav-adapter.js';
import { GoogleDriveAdapter } from './google-drive-adapter.js';
import { ICloudAdapter } from './icloud-adapter.js';
import type { ISyncAdapter } from './types.js';
import type { ICloudFs } from './icloud-adapter.js';

export type SyncProvider = 'none' | 'webdav' | 'google-drive' | 'icloud';

export interface SyncConfig {
  provider: SyncProvider;
  webdav?: { url: string; username: string; password: string };
  googleDrive?: { refreshToken: string };
  icloud?: { containerPath: string };
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = { provider: 'none' };

const APPLE_PLATFORMS = ['ios', 'macos', 'safari'];

/**
 * Encrypt a SyncConfig with the vault DEK.
 * Uses the same XChaCha20-Poly1305 as vault items.
 */
export function encryptSyncConfig(config: SyncConfig, dek: Uint8Array): Uint8Array {
  const json = JSON.stringify(config);
  return encrypt(new TextEncoder().encode(json), dek);
}

/**
 * Decrypt a SyncConfig blob with the vault DEK.
 * Returns the parsed SyncConfig.
 */
export function decryptSyncConfig(data: Uint8Array, dek: Uint8Array): SyncConfig {
  const plainBytes = decrypt(data, dek);
  return JSON.parse(new TextDecoder().decode(plainBytes)) as SyncConfig;
}

export interface AdapterPlatformCallbacks {
  getAccessToken?: (refreshToken: string) => Promise<string>;
  getChromeAccessToken?: () => Promise<string>;
  icloudFs?: ICloudFs;
}

/**
 * Create the appropriate ISyncAdapter from a SyncConfig.
 * Returns null for provider 'none'.
 */
export function createAdapterFromConfig(
  config: SyncConfig,
  platform: AdapterPlatformCallbacks,
): ISyncAdapter | null {
  switch (config.provider) {
    case 'none':
      return null;
    case 'webdav':
      return new WebDavAdapter(config.webdav!);
    case 'google-drive': {
      const refreshToken = config.googleDrive!.refreshToken;
      const getToken =
        refreshToken === '__chrome_managed__' && platform.getChromeAccessToken
          ? platform.getChromeAccessToken
          : () => platform.getAccessToken!(refreshToken);
      return new GoogleDriveAdapter({ getAccessToken: getToken });
    }
    case 'icloud':
      return new ICloudAdapter({
        containerPath: config.icloud!.containerPath,
        fs: platform.icloudFs!,
      });
  }
}

/**
 * Get the list of available sync providers for a given platform.
 * iCloud is only available on Apple platforms (ios, macos, safari).
 */
export function getAvailableProviders(platform: string): SyncProvider[] {
  const providers: SyncProvider[] = ['none', 'webdav', 'google-drive'];
  if (APPLE_PLATFORMS.includes(platform)) {
    providers.push('icloud');
  }
  return providers;
}
```

- [ ] **Step 4: Update index.ts exports**

Add to `packages/core/src/sync/index.ts`:

```typescript
export {
  encryptSyncConfig,
  decryptSyncConfig,
  createAdapterFromConfig,
  getAvailableProviders,
  DEFAULT_SYNC_CONFIG,
} from './sync-config.js';
export type { SyncConfig, SyncProvider, AdapterPlatformCallbacks } from './sync-config.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/sync-config.test.ts`
Expected: PASS (all tests)

- [ ] **Step 6: Run all core tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync/sync-config.ts packages/core/src/sync/sync-config.test.ts packages/core/src/sync/index.ts
git commit -m "feat(sync): add SyncConfig model with encryption, adapter factory, and provider availability"
```

---

## Chunk 2: Desktop Vault Context Integration

### Task 2: Desktop sync wiring

**Files:**

- Create: `apps/desktop/src/lib/sync.ts`
- Modify: `apps/desktop/src/lib/vault-context.tsx`

- [ ] **Step 1: Create desktop sync helper module**

Create `apps/desktop/src/lib/sync.ts`:

```typescript
import {
  SyncEngine,
  connectSyncEngine,
  createAdapterFromConfig,
  encryptSyncConfig,
  decryptSyncConfig,
  DEFAULT_SYNC_CONFIG,
} from '@keykeykey/core/sync';
import type { SyncConfig, SyncableStore, AdapterPlatformCallbacks } from '@keykeykey/core/sync';
import type { VaultItem } from '@keykeykey/core';

// Tauri fs functions for sync config persistence
async function saveSyncConfigFile(data: Uint8Array): Promise<void> {
  const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  await writeFile('sync-config.bin', data, { baseDir: BaseDirectory.AppData });
}

async function loadSyncConfigFile(): Promise<Uint8Array | null> {
  try {
    const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    return await readFile('sync-config.bin', { baseDir: BaseDirectory.AppData });
  } catch {
    return null; // File doesn't exist
  }
}

async function deleteSyncConfigFile(): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await remove('sync-config.bin', { baseDir: BaseDirectory.AppData });
  } catch {
    // File may not exist
  }
}

export interface SyncState {
  engine: SyncEngine | null;
  disconnect: (() => void) | null;
  config: SyncConfig;
  status: { isSyncing: boolean; lastSynced: string | null; error: string | null };
}

/**
 * Load and decrypt sync config after vault unlock.
 */
export async function loadSyncConfig(dek: Uint8Array): Promise<SyncConfig> {
  const data = await loadSyncConfigFile();
  if (!data) return DEFAULT_SYNC_CONFIG;
  try {
    return decryptSyncConfig(data, dek);
  } catch {
    return DEFAULT_SYNC_CONFIG; // Corrupted config, reset to default
  }
}

/**
 * Save and encrypt sync config.
 */
export async function saveSyncConfig(config: SyncConfig, dek: Uint8Array): Promise<void> {
  const encrypted = encryptSyncConfig(config, dek);
  await saveSyncConfigFile(encrypted);
}

/**
 * Delete sync config file (used during vault reset).
 */
export async function clearSyncConfigData(): Promise<void> {
  await deleteSyncConfigFile();
}

/**
 * Initialize the sync engine from a config.
 * Returns null if provider is 'none'.
 */
export function createSyncEngine(
  config: SyncConfig,
  store: SyncableStore,
  platformCallbacks: AdapterPlatformCallbacks,
  onVaultReplaced: () => void,
): SyncEngine | null {
  const adapter = createAdapterFromConfig(config, platformCallbacks);
  if (!adapter) return null;

  return new SyncEngine({
    adapter,
    store,
    onVaultReplaced,
  });
}

/**
 * Start sync: run immediate sync + wire auto-sync.
 * Returns disconnect function.
 */
export async function startSync(engine: SyncEngine, store: SyncableStore): Promise<() => void> {
  // Fire-and-forget initial sync — don't block unlock
  engine.sync().catch((err) => {
    console.warn('Initial sync failed:', err instanceof Error ? err.message : err);
  });

  // Wire auto-sync on item changes
  return connectSyncEngine(store, engine);
}
```

- [ ] **Step 2: Update desktop vault-context.tsx**

Modify `apps/desktop/src/lib/vault-context.tsx`:

Add imports at the top:

```typescript
import type { SyncConfig } from '@keykeykey/core/sync';
import type { SyncableStore } from '@keykeykey/core/sync';
import {
  loadSyncConfig as loadSyncConfigFromFile,
  saveSyncConfig as saveSyncConfigToFile,
  clearSyncConfigData,
  createSyncEngine,
  startSync,
} from './sync';
```

Add to `VaultContextType`:

```typescript
syncConfig: SyncConfig | null;
syncStatus: {
  isSyncing: boolean;
  lastSynced: string | null;
  error: string | null;
}
saveSyncConfig: (config: SyncConfig) => Promise<void>;
```

Add state and refs inside `VaultProvider`:

```typescript
const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
const [syncStatus, setSyncStatus] = useState({
  isSyncing: false,
  lastSynced: null as string | null,
  error: null as string | null,
});
const syncEngineRef = useRef<SyncEngine | null>(null);
const syncDisconnectRef = useRef<(() => void) | null>(null);
```

Add `SyncableStore` adapter:

```typescript
const syncableStore: SyncableStore = useMemo(
  () => ({
    getState: () => storeRef.current.getState(),
    setState: (partial) => storeRef.current.setState(partial),
    getVaultId: () => storeRef.current.getState().header?.vaultId ?? '',
  }),
  [],
);
```

Update the `unlock` function to load sync config and initialize engine after unlock:

```typescript
const unlock = useCallback(
  async (masterPassword: string) => {
    const storedItems = await loadAllEncryptedItems();
    const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
    await storeRef.current.getState().unlock(masterPassword, encryptedArrays);
    syncItems();
    setStatus('unlocked');

    // Load and initialize sync
    const dek = storeRef.current.getState().getDEK();
    const config = await loadSyncConfigFromFile(dek);
    setSyncConfig(config);

    if (config.provider !== 'none') {
      const engine = createSyncEngine(config, syncableStore, {}, () => {
        lock(); // onVaultReplaced: force lock
      });
      if (engine) {
        syncEngineRef.current = engine;
        const disconnect = await startSync(engine, syncableStore);
        syncDisconnectRef.current = disconnect;
      }
    }
  },
  [syncItems, syncableStore, lock],
);
```

Update `lock` to teardown sync:

```typescript
const lock = useCallback(() => {
  // Teardown sync
  syncDisconnectRef.current?.();
  syncDisconnectRef.current = null;
  syncEngineRef.current = null;
  setSyncConfig(null);
  setSyncStatus({ isSyncing: false, lastSynced: null, error: null });

  storeRef.current.getState().lock();
  setStatus('locked');
}, []);
```

Add `saveSyncConfig` function:

```typescript
const saveSyncConfigAction = useCallback(
  async (config: SyncConfig) => {
    const dek = storeRef.current.getState().getDEK();
    await saveSyncConfigToFile(config, dek);
    setSyncConfig(config);

    // Teardown old engine
    syncDisconnectRef.current?.();
    syncDisconnectRef.current = null;
    syncEngineRef.current = null;

    // Create new engine if provider is not 'none'
    if (config.provider !== 'none') {
      const engine = createSyncEngine(config, syncableStore, {}, () => {
        lock();
      });
      if (engine) {
        syncEngineRef.current = engine;
        const disconnect = await startSync(engine, syncableStore);
        syncDisconnectRef.current = disconnect;
      }
    }
  },
  [syncableStore, lock],
);
```

Update `removeItem` to call `recordTombstone`:

```typescript
const removeItem = useCallback(async (id: string) => {
  storeRef.current.getState().deleteItem(id);
  await deleteEncryptedItem(id);
  syncEngineRef.current?.recordTombstone(id);
}, []);
```

Update `resetVault` to cleanup sync:

```typescript
// Inside resetVault, before existing cleanup:
syncDisconnectRef.current?.();
syncDisconnectRef.current = null;
syncEngineRef.current = null;
setSyncConfig(null);
await clearSyncConfigData();
```

Add to context value:

```typescript
syncConfig,
syncStatus,
saveSyncConfig: saveSyncConfigAction,
```

- [ ] **Step 3: Run desktop tests**

Run: `pnpm --filter @keykeykey/desktop test`
Expected: PASS (existing tests should still pass — sync is additive)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/sync.ts apps/desktop/src/lib/vault-context.tsx
git commit -m "feat(desktop): wire SyncEngine into vault context with auto-sync and tombstones"
```

---

## Chunk 3: Mobile Vault Context Integration

### Task 3: Mobile sync wiring

**Files:**

- Create: `apps/mobile/lib/sync.ts`
- Modify: `apps/mobile/lib/vault-context.tsx`

- [ ] **Step 1: Create mobile sync helper module**

Create `apps/mobile/lib/sync.ts` — same structure as desktop but using expo-file-system:

```typescript
import {
  SyncEngine,
  connectSyncEngine,
  createAdapterFromConfig,
  encryptSyncConfig,
  decryptSyncConfig,
  DEFAULT_SYNC_CONFIG,
} from '@keykeykey/core/sync';
import type { SyncConfig, SyncableStore, AdapterPlatformCallbacks } from '@keykeykey/core/sync';
import * as FileSystem from 'expo-file-system';

const SYNC_CONFIG_PATH = `${FileSystem.documentDirectory}sync-config.bin`;

async function saveSyncConfigFile(data: Uint8Array): Promise<void> {
  const base64 = btoa(String.fromCharCode(...data));
  await FileSystem.writeAsStringAsync(SYNC_CONFIG_PATH, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

async function loadSyncConfigFile(): Promise<Uint8Array | null> {
  const info = await FileSystem.getInfoAsync(SYNC_CONFIG_PATH);
  if (!info.exists) return null;
  const base64 = await FileSystem.readAsStringAsync(SYNC_CONFIG_PATH, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deleteSyncConfigFile(): Promise<void> {
  try {
    await FileSystem.deleteAsync(SYNC_CONFIG_PATH, { idempotent: true });
  } catch {
    // File may not exist
  }
}

export async function loadSyncConfig(dek: Uint8Array): Promise<SyncConfig> {
  const data = await loadSyncConfigFile();
  if (!data) return DEFAULT_SYNC_CONFIG;
  try {
    return decryptSyncConfig(data, dek);
  } catch {
    return DEFAULT_SYNC_CONFIG;
  }
}

export async function saveSyncConfig(config: SyncConfig, dek: Uint8Array): Promise<void> {
  const encrypted = encryptSyncConfig(config, dek);
  await saveSyncConfigFile(encrypted);
}

export async function clearSyncConfigData(): Promise<void> {
  await deleteSyncConfigFile();
}

export function createSyncEngineMobile(
  config: SyncConfig,
  store: SyncableStore,
  platformCallbacks: AdapterPlatformCallbacks,
  onVaultReplaced: () => void,
): SyncEngine | null {
  const adapter = createAdapterFromConfig(config, platformCallbacks);
  if (!adapter) return null;
  return new SyncEngine({ adapter, store, onVaultReplaced });
}

export async function startSync(engine: SyncEngine, store: SyncableStore): Promise<() => void> {
  engine.sync().catch((err) => {
    console.warn('Initial sync failed:', err instanceof Error ? err.message : err);
  });
  return connectSyncEngine(store, engine);
}
```

- [ ] **Step 2: Update mobile vault-context.tsx**

Apply the same changes as desktop (Task 2 Step 2) but adapted for mobile:

- Import from `./sync` instead of `../lib/sync`
- Use `createSyncEngineMobile` instead of `createSyncEngine`
- Same `SyncableStore` adapter pattern
- Same lifecycle changes: unlock loads config + initializes engine, lock tears down, removeItem calls recordTombstone, resetVault cleans up

The changes are structurally identical to desktop — same state additions (`syncConfig`, `syncStatus`, `saveSyncConfig`), same lifecycle hooks.

- [ ] **Step 3: Run mobile tests**

Run: `pnpm --filter @keykeykey/mobile test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/sync.ts apps/mobile/lib/vault-context.tsx
git commit -m "feat(mobile): wire SyncEngine into vault context with auto-sync and tombstones"
```

---

## Chunk 4: Extension Integration

### Task 4: Extension sync wiring + config migration

**Files:**

- Create: `apps/extension/src/background/sync.ts`
- Modify: `apps/extension/src/background/message-handler.ts`
- Modify: `apps/extension/src/background/storage.ts`
- Modify: `apps/extension/src/lib/messages.ts`

- [ ] **Step 1: Update messages.ts to use core SyncConfig**

In `apps/extension/src/lib/messages.ts`, replace the existing `SyncConfig` and `SyncProvider` types:

```typescript
// Replace local types with core types
import type { SyncConfig, SyncProvider } from '@keykeykey/core/sync';
export type { SyncConfig, SyncProvider };
```

Remove the old `SyncConfig` and `SyncProvider` type definitions. Update `BackgroundMessage` to use the new nested config shape:

```typescript
| { type: 'CONFIGURE_SYNC'; config: SyncConfig }
```

Update `SyncStatus`:

```typescript
export interface SyncStatus {
  provider: SyncProvider;
  lastSynced: string | null;
  isSyncing: boolean;
  error: string | null;
}
```

- [ ] **Step 2: Update storage.ts with encrypted config + migration**

In `apps/extension/src/background/storage.ts`:

Add new encrypted storage functions:

```typescript
import { encryptSyncConfig, decryptSyncConfig, DEFAULT_SYNC_CONFIG } from '@keykeykey/core/sync';
import type { SyncConfig } from '@keykeykey/core/sync';

const KEY_SYNC_CONFIG_ENCRYPTED = 'sync_config_encrypted';

export async function saveSyncConfigEncrypted(config: SyncConfig, dek: Uint8Array): Promise<void> {
  const encrypted = encryptSyncConfig(config, dek);
  const base64 = toBase64(encrypted);
  await browser.storage.local.set({ [KEY_SYNC_CONFIG_ENCRYPTED]: base64 });
}

export async function loadSyncConfigEncrypted(dek: Uint8Array): Promise<SyncConfig> {
  const result = await browser.storage.local.get(KEY_SYNC_CONFIG_ENCRYPTED);
  const base64 = result[KEY_SYNC_CONFIG_ENCRYPTED];
  if (!base64 || typeof base64 !== 'string') return DEFAULT_SYNC_CONFIG;
  try {
    const data = fromBase64(base64);
    return decryptSyncConfig(data, dek);
  } catch {
    return DEFAULT_SYNC_CONFIG;
  }
}

/**
 * Migrate old unencrypted flat SyncConfig to new encrypted nested format.
 * Called once on first unlock after update.
 */
export async function migrateSyncConfig(dek: Uint8Array): Promise<SyncConfig> {
  // Check for new encrypted format first
  const encrypted = await loadSyncConfigEncrypted(dek);
  if (encrypted.provider !== 'none') return encrypted;

  // Check for old unencrypted flat format
  const result = await browser.storage.local.get(KEY_SYNC_CONFIG);
  const old = result[KEY_SYNC_CONFIG];
  if (!old || typeof old !== 'object' || old.provider === 'none') {
    return DEFAULT_SYNC_CONFIG;
  }

  // Convert flat to nested
  const config: SyncConfig = { provider: old.provider };
  if (old.provider === 'webdav') {
    config.webdav = {
      url: old.webdavUrl ?? '',
      username: old.webdavUsername ?? '',
      password: old.webdavPassword ?? '', // may be encrypted with old scheme
    };
  }

  // Save in new format and delete old
  await saveSyncConfigEncrypted(config, dek);
  await browser.storage.local.remove(KEY_SYNC_CONFIG);

  return config;
}
```

- [ ] **Step 3: Create extension sync module**

Create `apps/extension/src/background/sync.ts`:

```typescript
import { SyncEngine, connectSyncEngine, createAdapterFromConfig } from '@keykeykey/core/sync';
import type { SyncConfig, SyncableStore, AdapterPlatformCallbacks } from '@keykeykey/core/sync';
import { saveSyncConfigEncrypted, migrateSyncConfig } from './storage';

let engine: SyncEngine | null = null;
let disconnect: (() => void) | null = null;
let lastSynced: string | null = null;
let syncError: string | null = null;

export function getSyncStatus() {
  return {
    isSyncing: engine?.isSyncing() ?? false,
    lastSynced,
    error: syncError,
  };
}

export async function initSync(
  store: SyncableStore,
  dek: Uint8Array,
  platformCallbacks: AdapterPlatformCallbacks,
  onVaultReplaced: () => void,
): Promise<SyncConfig> {
  const config = await migrateSyncConfig(dek);

  if (config.provider !== 'none') {
    const adapter = createAdapterFromConfig(config, platformCallbacks);
    if (adapter) {
      engine = new SyncEngine({ adapter, store, onVaultReplaced });

      // Fire-and-forget initial sync
      engine
        .sync()
        .then((result) => {
          lastSynced = new Date().toISOString();
          syncError = null;
        })
        .catch((err) => {
          syncError = err instanceof Error ? err.message : String(err);
        });

      disconnect = connectSyncEngine(store, engine);
    }
  }

  return config;
}

export async function triggerSync(): Promise<{ ok: boolean; error?: string }> {
  if (!engine) return { ok: false, error: 'Sync not configured' };
  try {
    await engine.sync();
    lastSynced = new Date().toISOString();
    syncError = null;
    return { ok: true };
  } catch (err) {
    syncError = err instanceof Error ? err.message : String(err);
    return { ok: false, error: syncError };
  }
}

export async function configureSync(
  config: SyncConfig,
  store: SyncableStore,
  dek: Uint8Array,
  platformCallbacks: AdapterPlatformCallbacks,
  onVaultReplaced: () => void,
): Promise<void> {
  // Teardown old
  teardownSync();

  // Save new config
  await saveSyncConfigEncrypted(config, dek);

  // Initialize new engine if not 'none'
  if (config.provider !== 'none') {
    const adapter = createAdapterFromConfig(config, platformCallbacks);
    if (adapter) {
      engine = new SyncEngine({ adapter, store, onVaultReplaced });
      engine
        .sync()
        .then(() => {
          lastSynced = new Date().toISOString();
          syncError = null;
        })
        .catch((err) => {
          syncError = err instanceof Error ? err.message : String(err);
        });
      disconnect = connectSyncEngine(store, engine);
    }
  }
}

export function teardownSync(): void {
  disconnect?.();
  disconnect = null;
  engine = null;
  lastSynced = null;
  syncError = null;
}

export function recordTombstone(id: string): void {
  engine?.recordTombstone(id);
}
```

- [ ] **Step 4: Update message-handler.ts**

Replace the sync message handlers in `apps/extension/src/background/message-handler.ts`:

```typescript
// Add import at top:
import { initSync, triggerSync, configureSync, teardownSync, getSyncStatus, recordTombstone } from './sync';

// Replace CONFIGURE_SYNC handler:
case 'CONFIGURE_SYNC': {
  const dek = store.getState().getDEK();
  const syncableStore: SyncableStore = {
    getState: () => store.getState(),
    setState: (partial) => store.setState(partial),
    getVaultId: () => store.getState().header?.vaultId ?? '',
  };
  await configureSync(message.config, syncableStore, dek, {}, () => {
    store.getState().lock();
    headerBase64 = null;
  });
  return { ok: true };
}

// Replace TRIGGER_SYNC handler:
case 'TRIGGER_SYNC': {
  return await triggerSync();
}

// Replace GET_SYNC_STATUS handler:
case 'GET_SYNC_STATUS': {
  const config = /* loaded during unlock */ { provider: 'none' as const };
  const status = getSyncStatus();
  return { provider: config.provider, ...status };
}

// Replace DISCONNECT_SYNC handler:
case 'DISCONNECT_SYNC': {
  teardownSync();
  const dek = store.getState().getDEK();
  await saveSyncConfigEncrypted({ provider: 'none' }, dek);
  return { ok: true };
}
```

Also update the `DELETE_ITEM` handler to call `recordTombstone`:

```typescript
// In DELETE_ITEM handler, after deleting from store:
recordTombstone(message.id);
```

And in `RESET_VAULT` handler, add teardown:

```typescript
// In RESET_VAULT handler, before clearing data:
teardownSync();
```

Wire `initSync` into the unlock flow — in the `UNLOCK` handler, after successful unlock:

```typescript
const dek = store.getState().getDEK();
const syncableStore: SyncableStore = {
  getState: () => store.getState(),
  setState: (partial) => store.setState(partial),
  getVaultId: () => store.getState().header?.vaultId ?? '',
};
const syncConfig = await initSync(syncableStore, dek, {}, () => {
  store.getState().lock();
  headerBase64 = null;
});
```

- [ ] **Step 5: Run extension tests**

Run: `pnpm --filter @keykeykey/extension test`
Expected: PASS (may need to update tests that mock sync messages)

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/background/sync.ts apps/extension/src/background/message-handler.ts apps/extension/src/background/storage.ts apps/extension/src/lib/messages.ts
git commit -m "feat(extension): wire SyncEngine with real handlers, config migration, and tombstones"
```

---

## Chunk 5: Google OAuth AuthProviders

### Task 5: Extension Google OAuth with browser detection

**Files:**

- Create: `apps/extension/src/lib/google-auth.ts`

- [ ] **Step 1: Implement extension Google auth**

Create `apps/extension/src/lib/google-auth.ts`:

```typescript
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

type Browser = 'chrome' | 'firefox' | 'safari';

export function detectBrowser(): Browser {
  if (typeof chrome !== 'undefined' && chrome.identity?.getAuthToken) return 'chrome';
  if (navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome'))
    return 'safari';
  return 'firefox';
}

export interface GoogleAuthProvider {
  authenticate(): Promise<{ refreshToken: string }>;
  getAccessToken(refreshToken: string): Promise<string>;
}

export function createExtensionGoogleAuth(): GoogleAuthProvider {
  const browser = detectBrowser();

  if (browser === 'chrome') {
    return {
      authenticate: async () => {
        // Chrome manages tokens internally
        await new Promise<string>((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(token!);
          });
        });
        return { refreshToken: '__chrome_managed__' };
      },
      getAccessToken: async () => {
        return new Promise<string>((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: false }, (token) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(token!);
          });
        });
      },
    };
  }

  // Firefox and Safari use launchWebAuthFlow
  return {
    authenticate: async () => {
      const redirectUrl = globalThis.browser?.identity?.getRedirectURL?.() ?? '';
      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUrl);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', SCOPES);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');

      const responseUrl = await globalThis.browser.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true,
      });

      const code = new URL(responseUrl).searchParams.get('code');
      if (!code) throw new Error('No auth code received');

      // Exchange code for tokens
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          redirect_uri: redirectUrl,
          grant_type: 'authorization_code',
        }),
      });
      const tokens = (await tokenRes.json()) as { refresh_token: string };
      return { refreshToken: tokens.refresh_token };
    },
    getAccessToken: async (refreshToken: string) => {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: GOOGLE_CLIENT_ID,
          grant_type: 'refresh_token',
        }),
      });
      const data = (await res.json()) as { access_token: string };
      return data.access_token;
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/extension/src/lib/google-auth.ts
git commit -m "feat(extension): add Google OAuth with Chrome/Firefox/Safari detection"
```

### Task 6: Desktop and Mobile Google OAuth (stubs)

**Files:**

- Create: `apps/desktop/src/lib/google-auth.ts`
- Create: `apps/mobile/lib/google-auth.ts`

- [ ] **Step 1: Create desktop Google auth stub**

Create `apps/desktop/src/lib/google-auth.ts`:

```typescript
import type { GoogleAuthProvider } from './google-auth-types';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

export interface GoogleAuthProvider {
  authenticate(): Promise<{ refreshToken: string }>;
  getAccessToken(refreshToken: string): Promise<string>;
}

export function createDesktopGoogleAuth(): GoogleAuthProvider {
  return {
    authenticate: async () => {
      // Open system browser for OAuth consent
      const { open } = await import('@tauri-apps/plugin-shell');
      const redirectUri = 'http://localhost:9876/oauth/callback';
      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', SCOPES);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');

      await open(authUrl.toString());

      // TODO: Start local HTTP server to capture callback with auth code
      // For now, this is a placeholder — the full OAuth callback server
      // will be implemented when the sync configuration UI is built (sub-project 2)
      throw new Error('Desktop Google OAuth not yet implemented — configure via WebDAV');
    },
    getAccessToken: async (refreshToken: string) => {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: GOOGLE_CLIENT_ID,
          grant_type: 'refresh_token',
        }),
      });
      const data = (await res.json()) as { access_token: string };
      return data.access_token;
    },
  };
}
```

- [ ] **Step 2: Create mobile Google auth stub**

Create `apps/mobile/lib/google-auth.ts`:

```typescript
export interface GoogleAuthProvider {
  authenticate(): Promise<{ refreshToken: string }>;
  getAccessToken(refreshToken: string): Promise<string>;
}

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function createMobileGoogleAuth(): GoogleAuthProvider {
  return {
    authenticate: async () => {
      // TODO: Implement with expo-auth-session when sync config UI is built (sub-project 2)
      throw new Error('Mobile Google OAuth not yet implemented — configure via WebDAV');
    },
    getAccessToken: async (refreshToken: string) => {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: GOOGLE_CLIENT_ID,
          grant_type: 'refresh_token',
        }),
      });
      const data = (await res.json()) as { access_token: string };
      return data.access_token;
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/lib/google-auth.ts apps/mobile/lib/google-auth.ts
git commit -m "feat: add Google OAuth stubs for desktop and mobile (refresh token exchange works, authenticate() deferred to sub-project 2)"
```

---

## Chunk 6: Final Verification

### Task 7: Build, test, format, and verify

- [ ] **Step 1: Build shared packages**

```bash
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
```

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: all packages pass.

- [ ] **Step 3: Run format**

```bash
pnpm format
pnpm format:check
```

- [ ] **Step 4: Run lint**

```bash
pnpm lint
```

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: formatting and lint fixes"
```
