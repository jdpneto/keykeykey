# Sync Wiring: Connect SyncEngine to All Platforms

Wire the existing core SyncEngine and cloud adapters (WebDAV, Google Drive, iCloud) into all platforms (desktop, mobile, extension) with encrypted sync config persistence, auto-sync on item changes, immediate sync on unlock, and platform-specific Google OAuth.

## Decisions

| Decision            | Choice                                                                               |
| ------------------- | ------------------------------------------------------------------------------------ |
| Adapters to wire    | All three: WebDAV, Google Drive, iCloud                                              |
| Sync config storage | Separate encrypted file (`sync-config.bin`) using vault DEK                          |
| Sync triggers       | Auto-sync on every item change (2s debounce) + immediate sync on unlock              |
| Provider 'none'     | Explicit "Local only" option — no SyncEngine created                                 |
| iCloud availability | Apple platforms only (iOS, macOS, Safari) — filtered from provider list elsewhere    |
| Google OAuth        | Platform-specific `AuthProvider` abstraction per platform                            |
| Extension browsers  | Chrome (`getAuthToken`), Firefox (`launchWebAuthFlow`), Safari (`launchWebAuthFlow`) |

## 1. SyncConfig Model

New file in `packages/core/src/sync/sync-config.ts`:

```typescript
export type SyncProvider = 'none' | 'webdav' | 'google-drive' | 'icloud';

export interface SyncConfig {
  provider: SyncProvider;
  webdav?: { url: string; username: string; password: string };
  googleDrive?: { refreshToken: string };
  icloud?: { containerPath: string };
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = { provider: 'none' };
```

**Migration from extension's existing flat `SyncConfig`:** The extension currently defines a flat `SyncConfig` type in `apps/extension/src/lib/messages.ts` with `webdavUrl`, `webdavUsername`, `webdavPassword` fields, and stores it unencrypted in `browser.storage.local`. This type will be replaced by the core `SyncConfig` above. On first unlock after update, the migration path is:

1. Check for old unencrypted `sync_config` key in `browser.storage.local`
2. If found, convert flat fields to nested shape: `{ provider, webdav: { url: webdavUrl, username: webdavUsername, password: webdavPassword } }`
3. Encrypt with DEK and store as `sync-config.bin`
4. Delete old unencrypted `sync_config` key

All extension code importing `SyncConfig` from `messages.ts` will be updated to import from `@keykeykey/core/sync` instead.

### Encryption Helpers

```typescript
function encryptSyncConfig(config: SyncConfig, dek: Uint8Array): Uint8Array;
function decryptSyncConfig(data: Uint8Array, dek: Uint8Array): SyncConfig;
```

- Uses the same XChaCha20-Poly1305 encryption as vault items via the existing `encrypt`/`decrypt` functions.
- JSON-serializes the config, encrypts with the vault DEK.
- The entire config blob is encrypted — no per-field encryption. This supersedes the extension's previous approach of separately encrypting the WebDAV password. The whole-config encryption is sufficient since `sync-config.bin` can only be read when the vault is unlocked (DEK available).
- When no `sync-config.bin` exists, returns `DEFAULT_SYNC_CONFIG` (`{ provider: 'none' }`).

## 2. Platform Storage

Each platform provides two functions for persisting the encrypted sync config blob:

| Platform        | Storage                 | Functions                                                                           |
| --------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| Desktop (Tauri) | Tauri fs commands       | `saveSyncConfigFile(data: Uint8Array)` / `loadSyncConfigFile(): Uint8Array \| null` |
| Mobile (Expo)   | expo-file-system        | `saveSyncConfigFile(data: Uint8Array)` / `loadSyncConfigFile(): Uint8Array \| null` |
| Extension       | `browser.storage.local` | `saveSyncConfigFile(data: Uint8Array)` / `loadSyncConfigFile(): Uint8Array \| null` |

These are thin wrappers — they store/retrieve a binary blob. Encryption/decryption is handled by the core helpers above.

## 3. Vault Context Integration

Each platform's vault context gets three new additions:

### New State

- `syncConfig: SyncConfig | null` — current config (null until unlocked)
- `syncStatus: { isSyncing: boolean; lastSynced: string | null; error: string | null }`

### New Actions

- `saveSyncConfig(config: SyncConfig): Promise<void>` — encrypt, persist, reinitialize engine

### SyncableStore Adaptation

The `SyncEngine` constructor requires a `SyncableStore` interface with `getVaultId()`, `getState()`, and `setState()`. The Zustand vault store does not directly satisfy this. Each platform wraps its store ref:

```typescript
const syncableStore: SyncableStore = {
  getState: () => storeRef.current.getState(),
  setState: (partial) => storeRef.current.setState(partial),
  getVaultId: () => storeRef.current.getState().header?.vaultId ?? '',
  subscribe: (listener) => storeRef.current.subscribe(listener),
};
```

This adapter is created once in each platform's vault context and passed to `SyncEngine` and `connectSyncEngine()`.

### Tombstone Integration

When a user deletes an item, the sync engine must record a tombstone so the deletion propagates to other devices. Each platform's `removeItem` / `deleteItem` flow must call `engine.recordTombstone(id)` if a sync engine exists:

```typescript
function removeItem(id: string) {
  storeRef.current.getState().deleteItem(id);
  deleteEncryptedItem(id); // platform storage
  syncEngine?.recordTombstone(id); // propagate deletion on next sync
}
```

Without this, deleted items would reappear on the next sync from remote.

### Lifecycle

**On unlock:**

1. Decrypt vault items (existing)
2. Load and decrypt `sync-config.bin` → set `syncConfig` state
3. If `provider !== 'none'`: create adapter → create `SyncEngine` → run immediate `engine.sync()` (fire-and-forget — catch and log errors so unlock is never blocked by sync failures) → wire `connectSyncEngine()` for auto-sync on item changes. Store the disconnect function in a ref.

**On lock:**

1. Call disconnect function from `connectSyncEngine()` to unsubscribe
2. Destroy SyncEngine reference (set to null)
3. Clear `syncConfig` and `syncStatus` state

**On `saveSyncConfig()`:**

1. Encrypt config with DEK → write `sync-config.bin`
2. If provider changed:
   - Tear down old engine (disconnect, destroy)
   - If new provider !== 'none': create new adapter + engine → sync → connect
   - If new provider === 'none': no engine created

**On `resetVault()`:**

1. Tear down sync engine (disconnect, destroy)
2. Delete `sync-config.bin` from platform storage
3. Continue with existing vault reset flow

**On vault replaced (remote):**
The `SyncEngine` supports an `onVaultReplaced` callback for when another device replaces the vault. Each platform handles this by locking the vault and requiring re-authentication:

```typescript
const engine = new SyncEngine({
  adapter,
  store: syncableStore,
  onVaultReplaced: () => {
    lock(); // force lock — user must re-enter master password
  },
});
```

## 4. Adapter Factory

A shared function creates the right adapter from a `SyncConfig`:

```typescript
function createAdapterFromConfig(
  config: SyncConfig,
  platform: {
    getAccessToken?: (refreshToken: string) => Promise<string>;
    getChromeAccessToken?: () => Promise<string>; // Chrome-only, no refresh token needed
    icloudFs?: ICloudFs;
  },
): ISyncAdapter | null {
  switch (config.provider) {
    case 'none':
      return null;
    case 'webdav':
      return new WebDavAdapter(config.webdav!);
    case 'google-drive': {
      const refreshToken = config.googleDrive!.refreshToken;
      // Chrome manages tokens internally — use getChromeAccessToken if available
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
```

This lives in `packages/core/src/sync/` so all platforms share the adapter construction logic. Platform-specific callbacks (`getAccessToken`, `icloudFs`) are injected.

## 5. Google Drive OAuth — AuthProvider

Each platform implements:

```typescript
interface GoogleAuthProvider {
  authenticate(): Promise<{ refreshToken: string }>;
  getAccessToken(refreshToken: string): Promise<string>;
}
```

### Desktop (Tauri)

- `authenticate()`: Open system browser → Google OAuth consent → redirect to `http://localhost:<port>/callback` → Tauri captures auth code → exchange for tokens via Google token endpoint
- `getAccessToken()`: Use stored refresh token → POST to Google token endpoint → return access token

### Mobile (Expo)

- `authenticate()`: `expo-auth-session` OAuth flow → returns auth code → exchange for tokens
- `getAccessToken()`: Same refresh token exchange as desktop

### Extension — Chrome

- `authenticate()`: `chrome.identity.getAuthToken({ interactive: true })` → returns access token directly (Chrome manages tokens). Returns `{ refreshToken: '__chrome_managed__' }` as a sentinel — Chrome handles token lifecycle internally.
- `getAccessToken()`: `chrome.identity.getAuthToken({ interactive: false })` → returns cached/refreshed token. Ignores the `refreshToken` parameter.
- Note: Chrome handles refresh internally. The sentinel value `'__chrome_managed__'` in `SyncConfig.googleDrive.refreshToken` tells `createAdapterFromConfig` to use Chrome's identity API path.

### Extension — Firefox

- `authenticate()`: `browser.identity.launchWebAuthFlow({ url: oauthUrl, interactive: true })` → parse redirect URL for auth code → exchange for tokens
- `getAccessToken()`: POST refresh token to Google token endpoint

### Extension — Safari

- Same as Firefox — `browser.identity.launchWebAuthFlow()`

### Browser Detection

```typescript
function detectBrowser(): 'chrome' | 'firefox' | 'safari' {
  if (typeof chrome !== 'undefined' && chrome.identity?.getAuthToken) return 'chrome';
  if (navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome'))
    return 'safari';
  return 'firefox';
}
```

## 6. Extension Changes

The extension already has sync UI in Settings and message handlers. Changes:

### Background Worker

After vault unlock, the background worker:

1. Loads sync config from encrypted storage
2. If provider !== 'none': creates adapter + SyncEngine
3. Runs immediate sync
4. Wires auto-sync via `connectSyncEngine()`

### Message Handler Updates

Replace stubs with real implementations:

| Message           | Current                     | New                                                         |
| ----------------- | --------------------------- | ----------------------------------------------------------- |
| `CONFIGURE_SYNC`  | Saves config only           | Save config + create/destroy engine                         |
| `TRIGGER_SYNC`    | Returns `{ ok: true }` stub | Calls `engine.sync()`, returns `SyncResult`                 |
| `GET_SYNC_STATUS` | Returns static status       | Returns real `{ isSyncing, lastSynced, error }` from engine |
| `DISCONNECT_SYNC` | Clears config               | Destroy engine + clear config + set provider to 'none'      |

### Existing UI

The extension's SettingsScreen already has provider dropdown, WebDAV credential fields, "Sync Now" and "Disconnect" buttons. These already send the right messages — they just need the handlers to do real work.

## 7. Provider Availability

Provider list is filtered per platform at runtime:

```typescript
function getAvailableProviders(platform: string): SyncProvider[] {
  const providers: SyncProvider[] = ['none', 'webdav', 'google-drive'];
  if (['ios', 'macos', 'safari'].includes(platform)) {
    providers.push('icloud');
  }
  return providers;
}
```

Platform detection:

- Desktop: Tauri's `@tauri-apps/api/os` or `navigator.platform` for macOS detection (not `process.platform` which is unavailable in the webview)
- Mobile: `Platform.OS === 'ios'` from React Native
- Extension: `detectBrowser() === 'safari'`

## 8. Testing

### Core

- `encryptSyncConfig` / `decryptSyncConfig`: round-trip, missing file returns default
- `createAdapterFromConfig`: returns correct adapter type per provider, null for 'none'

### Platform Integration (per platform)

- Unlock → sync config loaded → engine created → `sync()` called
- Save new config → engine reinitialized with new adapter
- Save config with `provider: 'none'` → engine destroyed
- Lock → engine destroyed, state cleared
- No sync config file → defaults to `{ provider: 'none' }`, no engine
- Delete item → `recordTombstone(id)` called on engine → tombstone propagates on next sync
- Reset vault → engine destroyed, sync config deleted
- Vault replaced callback → vault locks, user re-authenticates

### Extension Migration

- Old unencrypted flat `SyncConfig` migrated to new encrypted nested format on first unlock
- Old `sync_config` key deleted from `browser.storage.local` after migration

### Extension Message Handlers

- `TRIGGER_SYNC` calls `engine.sync()` and returns result
- `CONFIGURE_SYNC` persists config and reinitializes engine
- `DISCONNECT_SYNC` destroys engine and clears config
- `GET_SYNC_STATUS` returns real engine state

### Google OAuth

- Mock `getAuthToken` / `launchWebAuthFlow` per browser
- Verify token exchange and refresh flow
- Verify browser detection returns correct value

## 9. Out of Scope

- Sync configuration UI for desktop and mobile (sub-project 2)
- "Restore from Cloud" onboarding flow (sub-project 3)
- iCloud filesystem implementation for each Apple platform (needs native modules)
- Google OAuth client ID registration and consent screen setup
