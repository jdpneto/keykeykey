# Cross-Platform Sync Parity Design

## Goal

Bring mobile and extension sync functionality to parity with desktop, while extracting shared sync orchestration logic into a core `SyncLifecycle` class to eliminate code duplication across three platforms.

## Current State

**Desktop (fully working):** Sync settings with WebDAV + master password, restore from cloud wizard, vault mismatch resolution (merge / replace local / replace remote), CORS bypass via Tauri fetch proxy.

**Mobile (partial):** Basic sync settings screen with WebDAV + master password. `initSyncAfterUnlock` and `saveSyncConfigAction` work but are hand-rolled. Missing: restore from cloud, vault mismatch UI/resolution, `vaultMismatchInfo` not exposed in context.

**Extension (broken against current core API):** Sync config + engine lifecycle in background worker. Inline sync UI in SettingsScreen. The extension's `sync.ts` creates `SyncEngine` with the old `{ adapter, store, onVaultReplaced }` signature, but the current `SyncEngineOptions` requires `mek`, `syncSalt`, `vaultHeaderBytes`, `argon2Params`, and uses `onVaultMismatch`. This means the extension cannot perform MEK-based vault blob encryption — it is fundamentally incompatible with the current core sync API. Additionally missing: master password in config, restore from cloud, vault mismatch UI/resolution.

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
  /** Load the vault header (base64-encoded). Returns null if not found. */
  loadVaultHeader(): Promise<string | null>;
  /** Mark vault setup as complete (or incomplete after reset). */
  setVaultSetupComplete(complete: boolean): Promise<void>;
  /** Optional: Set the allowed URL prefix for CORS proxy (desktop only). */
  setSyncUrlPrefix?(prefix: string | null): Promise<void>;
}
```

**Note on `saveEncryptedItem` signature:** The extension currently stores items as simple `(id, blob)` pairs in `browser.storage.local`. The 5-parameter signature requires the extension to change its storage format to store `{ encrypted_data, type, createdAt, updatedAt }` objects per item. This is needed because merge/restore operations require the metadata. The migration is straightforward since existing items can be wrapped with default metadata on first read.

**Note on individual item deletion:** `deleteEncryptedItem(id)` is intentionally omitted from `PlatformStorage`. Individual item CRUD (`addItem`, `updateItem`, `removeItem`) remains the responsibility of the platform's vault context, which already handles per-item persistence. `SyncLifecycle` only handles bulk operations (merge, restore, reset) via `deleteAllItems` + `saveEncryptedItem`.

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

- **`initAfterUnlock`**: Loads encrypted config via `storage.loadSyncConfigFile()` → decrypts with DEK from store → calls `deriveMEKFromAdapter` → creates engine via `createSyncEngineFromConfig` → calls `initSyncEngine` (fires immediate sync). Calls `callbacks.onConfigChanged(config)`. **Error handling:** Does not throw — catches errors internally and logs a warning. Sync failure must never prevent vault unlock.

- **`saveConfig`**: Encrypts config → `storage.saveSyncConfigFile()` → teardown old engine → if provider != 'none' and masterPassword present: derive MEK → create engine → **`connectSyncEngine`** (no immediate sync, unlike `initAfterUnlock`). This deliberate difference avoids a race condition where the caller expects to trigger sync manually after saving. Calls `callbacks.onConfigChanged(config)`.

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

Remove `vaultReplaced: boolean` from `VaultContextType` — it is superseded by `vaultMismatchInfo` which provides richer information (whether restore is possible, remote item count, etc.).

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

**Behavioral change:** The current extension locks the vault on vault mismatch (`onVaultReplaced` calls `store.getState().lock()`). With `SyncLifecycle`, the extension will match desktop behavior: stay unlocked during mismatch so the user can interact with the mismatch resolution UI in the popup. The `onVaultMismatch` callback stores mismatch info without locking.

```typescript
let lifecycle: SyncLifecycle | null = null;

export function createSyncLifecycle(store: SyncableStore): SyncLifecycle {
  lifecycle = new SyncLifecycle({
    store,
    storage: extensionPlatformStorage,
    platformCallbacks: {},
    callbacks: {
      /* state tracking for getSyncStatus */
    },
  });
  return lifecycle;
}
```

`SyncLifecycle` imports `toBase64`/`fromBase64` from `@keykeykey/core/utils` internally — no injection needed.

#### `apps/extension/src/background/message-handler.ts`

Update existing handlers and add new ones:

| Message                    | Handler                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `CONFIGURE_SYNC`           | `lifecycle.saveConfig(config)` — config now includes `masterPassword` |
| `TRIGGER_SYNC`             | `lifecycle.triggerSync()`                                             |
| `DISCONNECT_SYNC`          | `lifecycle.saveConfig({ provider: 'none' })` + `lifecycle.teardown()` |
| `GET_SYNC_STATUS`          | `lifecycle.getStatus()` + config provider                             |
| `VALIDATE_MASTER_PASSWORD` | `lifecycle.validateMasterPassword(password)`                          |
| `RESTORE_FROM_CLOUD`       | `lifecycle.restoreFromCloud(config, masterPassword)`                  |
| `GET_MISMATCH_INFO`        | Return `lifecycle.mismatchInfo`                                       |
| `CLEAR_MISMATCH`           | `lifecycle.clearMismatch()`                                           |
| `REPLACE_REMOTE`           | `lifecycle.replaceRemote()`                                           |
| `REPLACE_LOCAL`            | `lifecycle.replaceLocal()`                                            |
| `MERGE_VAULTS`             | `lifecycle.mergeVaults()`                                             |
| `UNLOCK` / `UNLOCK_PIN`    | Call `lifecycle.initAfterUnlock()` after vault unlock                 |
| `LOCK` / `RESET_VAULT`     | Call `lifecycle.teardown()`                                           |

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
  subtitle={
    syncStatus.provider === 'none' ? 'Not configured' : `Connected via ${syncStatus.provider}`
  }
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

Create `PlatformStorage` implementation using existing `browser.storage.local` helpers. Update `saveEncryptedItem` to store `{ encrypted_data, type, createdAt, updatedAt }` objects instead of bare strings. Remove `migrateSyncConfig` (lifecycle's `initAfterUnlock` handles migration via the core `decryptSyncConfig` fallback).

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

### Platform Storage Implementations

- Lightweight integration tests for each `PlatformStorage` implementation to verify save/load/delete round-trips work with the platform's actual storage API

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
- All vault items are encrypted with the DEK before being stored in any platform storage (Tauri fs, expo-file-system, `browser.storage.local`). The sync config containing the master password is additionally encrypted with the DEK. At-rest encryption depends on OS-level disk encryption (FileVault, BitLocker, etc.) — the app does not rely on platform storage being encrypted by default.
- No new attack surface — this is a refactor of existing working patterns

## Known Limitations

- **Non-atomic remote replace:** `mergeVaults` and `replaceRemote` delete the remote vault before pushing the new state. If the process crashes between delete and push, the remote vault is lost. This is inherited from the current desktop implementation and is acceptable for v1.
- **Mismatch resolution works identically for all providers:** WebDAV, Google Drive, and iCloud all use the same vault blob format and MEK derivation. No provider-specific mismatch handling is needed.
