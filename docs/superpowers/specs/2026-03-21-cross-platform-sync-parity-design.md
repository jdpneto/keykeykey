# Cross-Platform Sync Parity Design

## Goal

Bring mobile and extension sync functionality to parity with desktop, while extracting shared sync orchestration logic into a core `SyncLifecycle` class to eliminate code duplication across three platforms.

## Current State

**Desktop (fully working):** Sync settings with WebDAV + master password, restore from cloud wizard, vault mismatch resolution (merge / replace local / replace remote), CORS bypass via Tauri fetch proxy.

**Mobile (partial):** Basic sync settings screen with WebDAV + master password. `initSyncAfterUnlock` and `saveSyncConfigAction` work but are hand-rolled. Missing: restore from cloud, vault mismatch UI/resolution, `vaultMismatchInfo` not exposed in context.

**Extension (outdated):** Sync config + engine lifecycle in background worker. Inline sync UI in SettingsScreen. Missing: master password in config, MEK derivation, restore from cloud, vault mismatch UI/resolution.

## Architecture

### Core: `SyncLifecycle` Class

A platform-agnostic class in `packages/core/src/sync/sync-lifecycle.ts` that encapsulates all sync orchestration logic. Each platform provides a `PlatformStorage` implementation for I/O and wires the lifecycle into their state management (React context or background worker).

#### `PlatformStorage` Interface

```typescript
export interface PlatformStorage {
  /** Load encrypted sync config blob. Returns null if not found. */
  loadSyncConfigFile(): Promise<Uint8Array | null>;
  /** Save encrypted sync config blob. */
  saveSyncConfigFile(data: Uint8Array): Promise<void>;
  /** Delete sync config file. */
  deleteSyncConfigFile(): Promise<void>;
  /** Save an encrypted vault item to local storage. */
  saveEncryptedItem(
    id: string,
    type: string,
    encryptedBase64: string,
    createdAt: string,
    updatedAt: string,
  ): Promise<void>;
  /** Load all encrypted vault items from local storage. */
  loadAllEncryptedItems(): Promise<Array<{ id: string; encrypted_data: string }>>;
  /** Delete all vault items from local storage. */
  deleteAllItems(): Promise<void>;
  /** Save the vault header (base64-encoded). */
  saveVaultHeader(headerBase64: string): Promise<void>;
  /** Optional: Set the allowed URL prefix for CORS proxy (desktop only). */
  setSyncUrlPrefix?(prefix: string | null): Promise<void>;
}
```

#### `SyncLifecycleCallbacks` Interface

```typescript
export interface SyncLifecycleCallbacks {
  /** Called when sync config changes (so platform can update UI state). */
  onConfigChanged(config: SyncConfig): void;
  /** Called when a vault mismatch is detected during sync. */
  onMismatch(info: VaultMismatchInfo): void;
  /** Called when mismatch is cleared. */
  onMismatchCleared(): void;
  /** Called when vault items change (after merge/restore — platform should re-read store). */
  onItemsChanged(): void;
}
```

#### `SyncLifecycle` Class

```typescript
export class SyncLifecycle {
  constructor(options: {
    store: SyncableStore;
    storage: PlatformStorage;
    platformCallbacks: AdapterPlatformCallbacks;
    callbacks: SyncLifecycleCallbacks;
    toBase64: (bytes: Uint8Array) => string;
    fromBase64: (str: string) => Uint8Array;
  });

  // --- Lifecycle ---

  /** Load config, derive MEK, create engine, auto-sync. Called after every unlock. */
  async initAfterUnlock(): Promise<SyncConfig>;

  /** Save new config, teardown old engine, create new engine. */
  async saveConfig(config: SyncConfig): Promise<void>;

  /** Disconnect engine, null refs. Called on lock/reset. */
  teardown(): void;

  // --- Sync Operations ---

  /** Manually trigger sync. */
  async triggerSync(): Promise<{ lastSynced: string | null; error: string | null }>;

  /** Returns { isSyncing: boolean }. */
  getStatus(): { isSyncing: boolean };

  /** Record a tombstone for a deleted item. */
  recordTombstone(id: string): void;

  // --- Validation ---

  /** Validate master password against vault header. */
  async validateMasterPassword(password: string): Promise<boolean>;

  // --- Mismatch Resolution ---

  /** Clear mismatch, save provider:'none', teardown. */
  async clearMismatch(): Promise<void>;

  /** Delete remote vault, push local. */
  async replaceRemote(): Promise<{ success: boolean; error?: string }>;

  /** Download remote vault, replace local entirely. */
  async replaceLocal(): Promise<{ success: boolean; error?: string }>;

  /** Download remote, LWW merge with local, persist, push merged. */
  async mergeVaults(): Promise<{
    success: boolean;
    error?: string;
    added?: number;
    updated?: number;
  }>;

  // --- Restore ---

  /** Restore vault from cloud (used during setup). */
  async restoreFromCloud(
    config: SyncConfig,
    masterPassword: string,
  ): Promise<{ success: boolean; error?: string; itemCount?: number }>;

  // --- Accessors ---

  get config(): SyncConfig | null;
  get mismatchInfo(): VaultMismatchInfo | null;
  get engine(): SyncEngine | null;
}
```

#### Internal Implementation

Each method follows the same pattern as the current desktop `vault-context.tsx` implementation, but without React hooks:

- **`initAfterUnlock`**: Loads encrypted config via `storage.loadSyncConfigFile()` → decrypts with DEK from store → calls `deriveMEKFromAdapter` → creates engine via `createSyncEngineFromConfig` → calls `initSyncEngine`. Calls `callbacks.onConfigChanged(config)`.

- **`saveConfig`**: Encrypts config → `storage.saveSyncConfigFile()` → teardown old engine → if provider != 'none' and masterPassword present: derive MEK → create engine → `connectSyncEngine`. Calls `callbacks.onConfigChanged(config)`.

- **`replaceRemote`**: Reads `masterPassword` from stored config → `generateSyncSalt()` → `deriveMEK()` → `deleteCloudVault()` → creates new engine → `initSyncEngine`. Uses `storage.setSyncUrlPrefix?.()` if available.

- **`mergeVaults`**: Reads `masterPassword` from config → `restoreFromCloudCore(adapter, masterPassword)` → creates temporary store → unlocks with remote header → `mergeItemSets(localItems, remoteItems)` → `store.setState({items: merged})` → persists all items via `storage.saveEncryptedItem()` → regenerates MEK → creates new engine. Calls `callbacks.onItemsChanged()`.

- **`replaceLocal`**: Delegates to `restoreFromCloud(this.config, this.config.masterPassword)`. Calls `callbacks.onMismatchCleared()`.

- **`restoreFromCloud`**: `restoreFromCloudCore(adapter, masterPassword)` → saves header via `storage.saveVaultHeader()` → deletes old items → saves new items → creates new store state → derives MEK → creates engine. Saves config with `masterPassword` included.

### Mobile Changes

#### `apps/mobile/lib/vault-context.tsx`

Replace ~200 lines of hand-rolled sync logic with `SyncLifecycle` delegation:

```typescript
// In VaultProvider:
const lifecycleRef = useRef<SyncLifecycle | null>(null);

// After store creation, create lifecycle with PlatformStorage using expo-file-system
// All sync context methods delegate:
const saveSyncConfig = useCallback(async (config: SyncConfig) => {
  await lifecycleRef.current?.saveConfig(config);
}, []);
```

Add to `VaultContextType`:
- `vaultMismatchInfo: VaultMismatchInfo | null`
- `clearVaultMismatch: () => Promise<void>`
- `replaceRemoteVault: () => Promise<{ success: boolean; error?: string }>`
- `mergeRemoteVault: () => Promise<{ success: boolean; error?: string; added?: number; updated?: number }>`
- `replaceLocalVault: () => Promise<{ success: boolean; error?: string }>`
- `restoreFromCloud: (config: SyncConfig, masterPassword: string) => Promise<{ success: boolean; error?: string; itemCount?: number }>`

#### `apps/mobile/lib/sync.ts`

Simplify to just the `PlatformStorage` implementation (~30 lines using `expo-file-system` + `FileSystem.documentDirectory`) and re-exports.

#### `apps/mobile/app/settings/sync.tsx`

Add vault mismatch dialog matching desktop. When `vaultMismatchInfo != null`, show a modal with:
- Title: "Remote Vault Detected" (canRestore) or "Incompatible Remote Vault" (!canRestore)
- Description with remote item count
- Buttons: Merge Vaults / Replace Local with Remote (if canRestore) / Replace Remote with Local / Cancel
- Loading states for each operation

#### New `apps/mobile/app/restore.tsx`

Multi-step restore wizard (Expo Router stack screen):
1. **Provider step**: WebDAV URL, username, password fields + "Next" button
2. **Password step**: Master password field + "Restore Vault" button
3. **Restoring step**: ActivityIndicator with "Downloading and decrypting your vault..."
4. **Success step**: Item count + "Go to Vault" button (navigates to tabs)

Error handling: connection errors → provider step, auth errors → password step.

#### `apps/mobile/app/setup.tsx`

Enable "Restore from Cloud" button → `router.push('/restore')`. Remove "Coming soon" text.

#### `apps/mobile/app/_layout.tsx`

Add `<Stack.Screen name="restore" />`.

### Extension Changes

#### `apps/extension/src/background/sync.ts`

Replace hand-rolled engine lifecycle with `SyncLifecycle`. The background worker holds the lifecycle instance. `PlatformStorage` implementation uses `browser.storage.local` for config and item persistence.

```typescript
let lifecycle: SyncLifecycle | null = null;

export function createSyncLifecycle(store: SyncableStore): SyncLifecycle {
  lifecycle = new SyncLifecycle({
    store,
    storage: extensionPlatformStorage,
    platformCallbacks: {},
    callbacks: { /* state tracking for getSyncStatus */ },
    toBase64, fromBase64,
  });
  return lifecycle;
}
```

#### `apps/extension/src/background/message-handler.ts`

Update existing handlers and add new ones:

| Message | Handler |
|---------|---------|
| `CONFIGURE_SYNC` | `lifecycle.saveConfig(config)` — config now includes `masterPassword` |
| `TRIGGER_SYNC` | `lifecycle.triggerSync()` |
| `DISCONNECT_SYNC` | `lifecycle.saveConfig({ provider: 'none' })` + `lifecycle.teardown()` |
| `GET_SYNC_STATUS` | `lifecycle.getStatus()` + config provider |
| `VALIDATE_MASTER_PASSWORD` | `lifecycle.validateMasterPassword(password)` |
| `RESTORE_FROM_CLOUD` | `lifecycle.restoreFromCloud(config, masterPassword)` |
| `GET_MISMATCH_INFO` | Return `lifecycle.mismatchInfo` |
| `CLEAR_MISMATCH` | `lifecycle.clearMismatch()` |
| `REPLACE_REMOTE` | `lifecycle.replaceRemote()` |
| `REPLACE_LOCAL` | `lifecycle.replaceLocal()` |
| `MERGE_VAULTS` | `lifecycle.mergeVaults()` |
| `UNLOCK` / `UNLOCK_PIN` | Call `lifecycle.initAfterUnlock()` after vault unlock |
| `LOCK` / `RESET_VAULT` | Call `lifecycle.teardown()` |

#### `apps/extension/src/lib/messages.ts`

Add message types:

```typescript
| { type: 'VALIDATE_MASTER_PASSWORD'; password: string }
| { type: 'RESTORE_FROM_CLOUD'; config: SyncConfig; masterPassword: string }
| { type: 'GET_MISMATCH_INFO' }
| { type: 'CLEAR_MISMATCH' }
| { type: 'REPLACE_REMOTE' }
| { type: 'REPLACE_LOCAL' }
| { type: 'MERGE_VAULTS' }
```

#### `apps/extension/src/popup/screens/SettingsScreen.tsx`

Remove inline sync section (~120 lines). Replace with a single row:

```tsx
<SettingRow
  icon="cloud-outline"
  label="Cloud Sync"
  subtitle={syncStatus.provider === 'none' ? 'Not configured' : `Connected via ${syncStatus.provider}`}
  onClick={() => navigate('sync-settings')}
/>
```

#### New `apps/extension/src/popup/screens/SyncSettingsScreen.tsx`

Dedicated sync screen matching desktop layout:
- Back button + "Cloud Sync" header
- Provider picker (select dropdown)
- WebDAV credential fields (shown when webdav selected, not connected)
- Master password field (shown when webdav selected, not connected)
- Connect / Disconnect / Sync Now buttons
- Sync status display (last synced, errors)
- Vault mismatch dialog (same 3 options as desktop/mobile)

All operations send messages to background and display results.

#### New `apps/extension/src/popup/screens/RestoreScreen.tsx`

Multi-step wizard matching desktop/mobile:
1. Provider + credentials
2. Master password
3. Restoring spinner
4. Success with item count

Sends `RESTORE_FROM_CLOUD` message to background. Error routing: connection errors → step 1, auth errors → step 2.

#### `apps/extension/src/popup/screens/SetupScreen.tsx`

Enable "Restore from Cloud" button → `navigate('restore')`.

#### `apps/extension/src/popup/Popup.tsx`

Add screen states: `'sync-settings'`, `'restore'`.

#### `apps/extension/src/background/storage.ts`

Create `PlatformStorage` implementation using existing `browser.storage.local` helpers. Remove `migrateSyncConfig` (lifecycle's `initAfterUnlock` handles migration via the core `decryptSyncConfig` fallback).

### Desktop Refactor

#### `apps/desktop/src/lib/vault-context.tsx`

Replace ~300 lines of sync orchestration with `SyncLifecycle` delegation. Create `PlatformStorage` using existing Tauri fs helpers from `sync.ts`. All sync context methods become one-liner delegates.

No changes to `VaultContextType` — the public API stays identical.

#### `apps/desktop/src/lib/sync.ts`

Keep fetch proxy (`installFetchProxy`, `setSyncUrlPrefix`). Move config persistence functions into a `createDesktopPlatformStorage()` factory. Remove re-exported engine lifecycle functions.

#### No UI changes

`SyncSettingsScreen.tsx`, `RestoreScreen.tsx`, `SetupScreen.tsx`, `SettingsScreen.tsx` stay unchanged — they call the same context methods.

## Testing Strategy

### Core
- Unit tests for `SyncLifecycle` using `MemoryAdapter` and mock `PlatformStorage`
- Cover: init, save config, trigger sync, validate password, all 3 mismatch resolutions, restore, teardown
- Existing core tests unchanged

### Desktop
- Existing UI tests unchanged (same context API)
- Minor mock updates if vault-context construction changes

### Mobile
- Update `sync-settings.test.tsx` for mismatch dialog
- New `restore.test.tsx` for restore screen
- Update existing test mocks for new context fields

### Extension
- New `SyncSettingsScreen.test.tsx`
- New `RestoreScreen.test.tsx`
- Update `message-handler` tests for new message types
- Update `SettingsScreen.test.tsx` (sync section → navigation row)

## Implementation Order

1. Core `SyncLifecycle` + tests
2. Desktop refactor to use `SyncLifecycle` (validates API against working code)
3. Mobile: vault context refactor + restore screen + mismatch UI
4. Extension: background sync refactor + new screens + message types
5. Final verification (all tests, lint, format, build)

## Security Considerations

- Master password stored in encrypted SyncConfig (encrypted with vault DEK) — same as current desktop approach
- MEK derived on-demand from config, not held in long-lived refs
- `SyncLifecycle.teardown()` called on lock/reset to ensure engine cleanup
- Extension's `PlatformStorage` uses `browser.storage.local` which is encrypted at rest by the browser
- No new attack surface — this is a refactor of existing working patterns
