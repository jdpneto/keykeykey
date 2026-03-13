# Vault Sync Design

Cross-device vault synchronization via BYOC (Bring Your Own Cloud) providers with per-item bidirectional sync, tombstone-based deletion tracking, and LWW conflict resolution.

## Context

The existing sync module provides `ISyncAdapter` (storage interface), `SyncManifest` (per-item timestamps + hashes), `mergeManifests()` with Last-Write-Wins resolution, and a `MemoryAdapter` for testing. What's missing is the sync engine, real cloud adapters, and deletion tracking.

### Decisions

| Decision | Choice |
|----------|--------|
| Cloud providers | Google Drive + iCloud + WebDAV (all three at launch) |
| Conflict resolution | Per-item LWW (existing `mergeManifests()`) |
| Deletion tracking | Tombstones with 30-day garbage collection |
| Sync trigger | On every change (debounced 2s) + on unlock + on foreground |
| Cloud file layout | One encrypted file per item + manifest file |
| Sync logic location | `SyncEngine` class in `packages/core/sync/` |

## 1. Sync Engine

A `SyncEngine` class in `packages/core/sync/sync-engine.ts` orchestrates bidirectional sync given any `ISyncAdapter` and the vault store.

### Sync Cycle

1. **Fetch remote state** — read remote manifest (do not modify the store yet).
2. **Diff** — compare local manifest against remote manifest to determine: items to pull (newer remotely), items to push (newer locally or missing remotely), tombstones to propagate.
3. **Apply remote changes** — download items that are newer remotely, decrypt, and update the store. Mark these updates as sync-originated (see sync-loop guard below).
4. **Merge manifests** — call `mergeManifests(local, remote)` (extended with tombstone awareness) to produce the merged manifest.
5. **Push local changes** — encrypt and upload items that are newer locally or missing remotely.
6. **Commit** — write the merged manifest to the adapter. This is the commit point. If any prior step fails, the local manifest is not updated, and the next sync retries the full cycle. For adapters that support it (WebDAV, iCloud filesystem), use write-to-temp-then-rename for crash safety. Google Drive API file updates are atomic at the API level.

### Partial Failure Semantics

The merged manifest is written only after all uploads succeed (step 6). If the sync fails mid-cycle (e.g., network error during push), the local manifest remains unchanged. On the next sync, the engine re-diffs and retries. Items already pulled into the store in step 3 will appear as local items in the next diff, which is correct — they'll be detected as already-in-sync via hash comparison and skipped.

### Interface

```typescript
interface SyncEngineOptions {
  adapter: ISyncAdapter;
  store: VaultStore;
  onConflictResolved?: (winner: VaultItem, loser: VaultItem) => void; // observability hook (logging/telemetry), not influential
  tombstoneMaxAgeDays?: number; // default: 30
}

class SyncEngine {
  constructor(options: SyncEngineOptions);
  sync(): Promise<SyncResult>;
  scheduleSync(): void;          // debounced (2s), respects backoff, queues one follow-up if in-flight
  isSyncing(): boolean;
}

interface SyncResult {
  pulled: number;
  pushed: number;
  deleted: number;
  conflicts: number;
}
```

### Concurrency

A mutex prevents overlapping sync cycles. If a sync is running, `scheduleSync()` queues exactly one follow-up sync that fires after the current one completes.

## 2. Tombstone Tracking

### Manifest Changes

```typescript
interface SyncManifest {
  version: number;
  lastModified: string;
  items: Record<string, SyncItemMeta>;
  tombstones: Record<string, TombstoneEntry>;  // new
}

interface TombstoneEntry {
  deletedAt: string;  // ISO 8601
}
```

### Behavior

- `deleteItem(id)` causes the sync engine to add `tombstones[id] = { deletedAt: now }` to the local manifest and remove the item from `manifest.items`.
- During merge, if one side has a tombstone and the other has the item:
  - `tombstone.deletedAt > item.updatedAt` → deletion wins, propagate tombstone.
  - `item.updatedAt > tombstone.deletedAt` → item survives, discard tombstone.
- If both sides have a tombstone for the same item, keep the one with the later `deletedAt`.
- Tombstones older than 30 days are garbage-collected during merge.
- The adapter's `deleteItem(id)` is called to clean up the cloud file when a tombstone propagates.

### Merge Function Changes

The existing `mergeManifests(local, remote)` is extended (not replaced) to handle tombstones. The function signature stays the same but the implementation adds:

```
mergeManifests(local, remote):
  merged.items = {}
  merged.tombstones = {}

  allIds = union(keys(local.items), keys(remote.items),
                 keys(local.tombstones), keys(remote.tombstones))

  for each id in allIds:
    localItem  = local.items[id]       // may be undefined
    remoteItem = remote.items[id]      // may be undefined
    localTomb  = local.tombstones[id]  // may be undefined
    remoteTomb = remote.tombstones[id] // may be undefined

    // Case 1: Both sides have the item, no tombstones
    if localItem AND remoteItem AND !localTomb AND !remoteTomb:
      merged.items[id] = pick later updatedAt (existing LWW)

    // Case 2: One side has item, other side has tombstone
    else if (localItem AND remoteTomb):
      if localItem.updatedAt > remoteTomb.deletedAt:
        merged.items[id] = localItem         // item updated after deletion, survives
      else:
        merged.tombstones[id] = remoteTomb   // deletion wins

    else if (remoteItem AND localTomb):
      if remoteItem.updatedAt > localTomb.deletedAt:
        merged.items[id] = remoteItem        // item updated after deletion, survives
      else:
        merged.tombstones[id] = localTomb    // deletion wins

    // Case 3: Both sides have tombstones
    else if (localTomb AND remoteTomb):
      merged.tombstones[id] = pick later deletedAt

    // Case 4: Item on one side only, no tombstones
    else if (localItem AND !remoteTomb):
      merged.items[id] = localItem
    else if (remoteItem AND !localTomb):
      merged.items[id] = remoteItem

    // Case 5: Tombstone on one side only, no item on other
    else if (localTomb AND !remoteItem):
      merged.tombstones[id] = localTomb
    else if (remoteTomb AND !localItem):
      merged.tombstones[id] = remoteTomb

  // Garbage-collect tombstones older than 30 days
  for each id in merged.tombstones:
    if age(merged.tombstones[id].deletedAt) > 30 days:
      delete merged.tombstones[id]

  merged.version = max(local.version, remote.version)
  merged.lastModified = now
  return merged
```

**Known limitation — long-offline devices:** If a device stays offline for 31+ days, its tombstones will have been garbage-collected from the other device's manifest. When it comes back online, the deleted item (still present on the offline device) will be re-synced as if new. This is an inherent trade-off of tombstone-based deletion with expiry. For a personal credential manager, 30 days is a generous window.

### Manifest Version Migration

The manifest `version` is bumped from 1 to 2 when tombstones are added. When the engine reads a version 1 manifest, it treats the missing `tombstones` field as an empty object (`{}`). Old code encountering a version 2 manifest will ignore the unknown `tombstones` field (it only reads `items`), so forward compatibility is safe.

### Store Integration

The vault store's `deleteItem()` stays unchanged (removes from state). The sync engine wraps it to record the tombstone in the manifest before triggering sync.

## 3. Cloud Adapters

Each adapter implements `ISyncAdapter`. All data passing through adapters is already encrypted — adapters never see plaintext.

### Cloud File Layout (all providers)

```
keykeykey/
  header.bin             # vault header (encrypted KEK-wrapped DEK, salts, argon2 params)
  manifest.json          # SyncManifest (not encrypted — contains only IDs, timestamps, hashes)
  items/
    <uuid-1>.bin         # encrypted vault item (XChaCha20-Poly1305 ciphertext)
    <uuid-2>.bin
```

The vault header is uploaded on vault creation and after master password changes. It is downloaded during "Restore from Cloud" to enable DEK derivation on a new device. The manifest is not encrypted because it contains no sensitive data (item IDs are UUIDs, timestamps and hashes reveal no content).

### Google Drive Adapter (`google-drive-adapter.ts`)

- Google Drive REST API v3.
- Files stored in `appDataFolder` scope (hidden from user's Drive).
- Accepts `getAccessToken: () => Promise<string>` — platform handles OAuth, adapter stays platform-agnostic.

### iCloud Adapter (`icloud-adapter.ts`)

- Uses iCloud Drive via platform-native filesystem APIs.
- Mobile (iOS only): `expo-file-system` writing to the iCloud container (Expo config plugin entitlements). Not available on Android.
- Desktop (macOS only): Rust reads/writes `~/Library/Mobile Documents/` via Tauri commands. Not available on Windows/Linux.
- Extension (Safari on macOS only): Can access iCloud via the same filesystem path. Not available in Chrome/Firefox extensions.
- Adapter constructor throws `SyncAdapterUnsupportedError` with a clear message on unsupported platform/app combinations.

### WebDAV Adapter (`webdav-adapter.ts`)

- Standard HTTP: `GET`, `PUT`, `DELETE`, `MKCOL`, `PROPFIND`.
- User configures server URL + credentials (basic auth or bearer token).
- Works on all platforms, no platform-specific code.
- `ping(): Promise<boolean>` for connection testing.

### Adapter Construction

```typescript
const adapter = new GoogleDriveAdapter({ getAccessToken });
const adapter = new ICloudAdapter({ containerPath });
const adapter = new WebDavAdapter({ url, username, password });
```

## 4. Sync Triggers & Store Integration

### When Sync Fires

- **On unlock** — after vault is decrypted, pull latest from cloud immediately.
- **On item change** — after any `addItem`, `updateItem`, or `deleteItem`, trigger `scheduleSync()` (2s debounce to batch rapid edits like imports).
- **On app foreground** — mobile/desktop fire sync when returning from background (only if unlocked).

### Store Wiring

```typescript
function connectSyncEngine(store: VaultStore, engine: SyncEngine) {
  store.subscribe((state, prevState) => {
    if (
      state.items !== prevState.items &&
      state.status === 'unlocked' &&
      !engine.isSyncing()  // sync-loop guard: ignore store mutations caused by sync itself
    ) {
      engine.scheduleSync();
    }
  });
}
```

### Sync-Loop Guard

Store mutations caused by the sync engine (pulling remote items) must not re-trigger `scheduleSync()`. The `isSyncing()` check prevents this. The engine sets an internal flag before modifying the store during pull, and clears it after.

### Error Handling

- **Network failure:** Sync silently fails. Consecutive failures use exponential backoff: 2s → 4s → 8s → ... capped at 5 minutes. Backoff resets on a successful sync. User-initiated changes (add/update/delete) bypass the backoff and trigger an immediate sync attempt — if the network is back, sync resumes; if not, the backoff restarts from 2s.
- **Auth expiry:** Adapter throws `SyncAuthError`. App layer catches and prompts re-authentication. Sync is paused until re-auth completes.
- **Corrupt remote item:** Skip it, log a warning (matches existing store decrypt behavior).

## 5. Sync Configuration & Persistence

### Config Model

```typescript
interface SyncConfig {
  provider: 'google-drive' | 'icloud' | 'webdav' | 'none';
  enabled: boolean;
  webdav?: {
    url: string;
    username: string;
    password: string;  // stored in platform secure storage
  };
}
```

### Platform Storage

| Platform | Storage |
|----------|---------|
| Mobile | `expo-secure-store` |
| Desktop | Tauri stronghold / OS keyring |
| Extension (Chrome) | `chrome.storage.local` (WebDAV creds encrypted with DEK; only accessible when vault is unlocked) |
| Extension (Firefox) | `browser.storage.local` (same, `browser.*` namespace) |
| Extension (Safari) | `browser.storage.local` (same, WebExtensions API) |

### First Launch Flow

Two paths on first launch:

1. **New vault** — create master password → optionally configure cloud provider → empty vault.
2. **Restore from cloud** — pick cloud provider → authenticate → download vault header + encrypted items → enter master password → derive DEK → decrypt → local store populated.

Onboarding screen:

```
Welcome to KeyKeyKey
  [Create New Vault]
  [Restore from Cloud]  ← picks provider, downloads, asks for master password
```

### Ongoing Sync

After initial setup (either path), adapter config is persisted locally. On every subsequent unlock, sync engine is reconstructed from saved config and pulls latest automatically.

## 6. Testing Strategy

### Unit Tests (Vitest)

- **SyncEngine:** Full sync cycle using `MemoryAdapter` — two engine instances simulating two devices.
- **Tombstones:** Deletion propagation, LWW vs tombstone resolution, 30-day GC.
- **Debounce/queue:** `scheduleSync()` batches rapid changes, mutex prevents concurrent syncs, queued follow-up fires correctly.
- **Error handling:** Network failures, `SyncAuthError`, corrupt remote items — verify graceful degradation.

### Adapter Integration Tests

- **WebDAV:** `webdav-server` npm package in-process, full sync cycles.
- **Google Drive:** MSW mocks for REST API — file CRUD, `appDataFolder`, token refresh.
- **iCloud:** Mock filesystem I/O layer.

### Conflict Simulation (extend `sync-conflict.test.ts`)

- Tombstone scenarios: delete on A + update on B, delete on both, delete + re-create.
- Multi-device churn: 3+ devices with interleaved operations.
- First sync from cloud: empty local + populated remote → full restore.

### Clock Skew

LWW relies on device clocks. If a device clock is significantly off, it may consistently "win" or "lose" conflicts incorrectly. This is a known LWW limitation. The spec does not attempt to solve clock skew (e.g., via vector clocks or NTP checks) — the simplicity of LWW is worth the trade-off for a personal credential manager where multi-device concurrent edits to the same item are rare.

### Coverage Target

100% statement/line, 90% branch — matching core's standard for sync engine and adapters.

## 7. Implementation Notes

### Hash Algorithm

`SyncItemMeta.hash` uses SHA-256 of the encrypted item bytes, stored as a hex string. The hash is computed after encryption and before upload. During diff, if two manifests have the same hash for an item, the item is skipped even if timestamps differ (avoids unnecessary downloads/uploads).
