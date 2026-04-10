# Sync, Import & Auto-Sync Bug Fixes Design

**Date:** 2026-04-08
**Status:** Approved

Fixes four bugs from `current-bugs.md`:

1. CSV import doesn't sync imported items to cloud
2. No auto-sync on unlock or periodic sync
3. Extension import breaks when popup loses focus
4. Restore from cloud missing Dropbox/OneDrive shortcut buttons

---

## Bug #1: Import Doesn't Trigger Sync + Batch Uploads

### Problem

- Desktop `addItems()` persists items locally but doesn't explicitly call `triggerSync()`.
- The `connectSyncEngine` subscription in `connect.ts` has a `!engine.isSyncing()` guard — if initial sync is running when items are imported, the auto-sync subscription is suppressed.
- Even manual sync reportedly fails to push imported items.
- The sync engine push loop (`sync-engine.ts` lines 382-405) writes items sequentially — one `writeItem()` at a time.

### Fix

#### 1. Parallelize push in sync engine

**File:** `packages/core/src/sync/sync-engine.ts`

Replace the sequential push loop (lines 382-405) with batched parallel writes:

```typescript
// Collect items that need pushing
const itemsToPush: VaultItem[] = [];
for (const item of finalItems) {
  if (pulledIds.has(item.id)) continue;
  const remoteMeta = remote.items[item.id];
  if (!remoteMeta || item.updatedAt > remoteMeta.updatedAt) {
    itemsToPush.push(item);
  }
}

// Push 5 at a time
await pMap(
  itemsToPush,
  async (item) => {
    const encrypted = state.encryptItem(item);
    await this.adapter.writeItem(item.id, encrypted);
    merged.items[item.id] = {
      updatedAt: item.updatedAt,
      hash: hashBytes(encrypted),
    };
  },
  { concurrency: 5 },
);

pushed = itemsToPush.length;
```

Import `pMap` from `../utils/concurrency.js`.

#### 2. Explicit sync after import (all platforms)

- **Desktop** (`apps/desktop/src/lib/vault-context.tsx`): `addItems()` calls `await triggerSync()` after persisting items. Returns sync result alongside item IDs.
- **Extension** (`apps/extension/src/background/message-handler.ts`): The new `IMPORT_ITEMS` handler (see Bug #3) triggers sync after adding all items.
- **Mobile** (`apps/mobile`): Same pattern — explicit `triggerSync()` after bulk import.

#### 3. Spinner behavior

- **Import sync / manual "Sync Now":** Spinner visible, blocks UI until sync completes. Shows "Syncing to cloud..." after items are added locally.
- **Auto-sync (on unlock + periodic):** Silent background operation. Item list refreshes when sync completes via existing store subscription.

---

## Bug #2: Auto-Sync on Unlock + Periodic Sync

### Problem

No automatic sync on app start/unlock, and no periodic sync to detect changes from other devices.

### Fix

#### 1. New methods on `SyncEngine`

**File:** `packages/core/src/sync/sync-engine.ts`

```typescript
private periodicTimer: ReturnType<typeof setInterval> | null = null;

startPeriodicSync(intervalMs: number = 60_000): void {
  this.stopPeriodicSync();
  this.periodicTimer = setInterval(() => {
    if (!this._isSyncing) {
      void this.sync();
    }
  }, intervalMs);
}

stopPeriodicSync(): void {
  if (this.periodicTimer !== null) {
    clearInterval(this.periodicTimer);
    this.periodicTimer = null;
  }
}
```

Call `stopPeriodicSync()` from any existing teardown/cleanup path.

#### 2. On-unlock sync

Already handled by `initSyncEngine()` which calls `engine.sync()`. No change needed.

#### 3. Platform integration

- **Desktop + Mobile:** Call `engine.startPeriodicSync(60_000)` inside `_createEngine()` after engine creation. `setInterval` works reliably in these environments.
- **Extension (MV3):** `setInterval` is unreliable in service workers. Use `chrome.alarms.create('periodic-sync', { periodInMinutes: 1 })`. On alarm fire, call `TRIGGER_SYNC` via the message handler. The existing keepalive alarm already prevents worker termination while unlocked.

#### 4. UI refresh

- **Desktop:** The existing store subscription in `vault-context.tsx` (lines 158-168) already calls `setItems()` when `state.items` changes. Pulled items from periodic sync refresh the list automatically.
- **Extension:** Background already broadcasts `VAULT_CHANGED` to content scripts after sync. Popup reads items from background on mount.
- **Mobile:** Same pattern as desktop — store subscription updates UI.

---

## Bug #3: Extension Import Survives Popup Close

### Problem

Extension popup closes when user clicks outside. CSV import adds items one-by-one via `ADD_ITEM` messages. If popup closes mid-import, remaining items are lost.

### Fix — Bulk `IMPORT_ITEMS` message + background progress tracking

#### 1. New message types

**File:** `apps/extension/src/lib/messages.ts`

```typescript
| { type: 'IMPORT_ITEMS'; items: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[] }
| { type: 'GET_IMPORT_STATUS' }
| { type: 'CLEAR_IMPORT_STATUS' }
```

**Response types:**

- `IMPORT_ITEMS` → `{ ok: true }` (acknowledges receipt; work continues in background)
- `GET_IMPORT_STATUS` → `{ status: 'idle' | 'importing' | 'syncing' | 'done' | 'error'; imported: number; total: number; error?: string }`
- `CLEAR_IMPORT_STATUS` → `{ ok: true }`

#### 2. Background handler for `IMPORT_ITEMS`

**File:** `apps/extension/src/background/message-handler.ts`

Module-level state:

```typescript
let importState: {
  status: 'idle' | 'importing' | 'syncing' | 'done' | 'error';
  imported: number;
  total: number;
  error?: string;
} = { status: 'idle', imported: 0, total: 0 };
```

Handler logic:

1. Set `importState = { status: 'importing', imported: 0, total: items.length }`.
2. Return `{ ok: true }` immediately to the popup (async fire-and-forget for the actual work).
3. Process items: call `store.getState().addItems(items)` to add all items to the store at once.
4. Encrypt and persist each item to storage, updating `importState.imported` after each.
5. Set `importState.status = 'syncing'`.
6. Trigger sync and await it.
7. Set `importState.status = 'done'` (or `'error'` with message on failure).
8. Broadcast `VAULT_CHANGED` to content scripts.

#### 3. Popup ImportScreen changes

**File:** `apps/extension/src/popup/screens/ImportScreen.tsx`

- **On mount:** Call `GET_IMPORT_STATUS`. If status is `'importing'` or `'syncing'`, show progress UI instead of the import form.
- **After CSV parse + dedup:** Send single `IMPORT_ITEMS` message with all items.
- **Poll** `GET_IMPORT_STATUS` every 500ms to update progress display:
  - `'importing'` → "Importing 15/32..."
  - `'syncing'` → "Syncing to cloud..."
  - `'done'` → Show success screen, call `CLEAR_IMPORT_STATUS`
  - `'error'` → Show error, call `CLEAR_IMPORT_STATUS`
- **Popup close is safe:** Once `IMPORT_ITEMS` is sent, background owns the work. Reopened popup picks up via `GET_IMPORT_STATUS`.

---

## Bug #4: Persist OAuth Provider for Restore Button

### Problem

OAuth flow opens the browser, which closes the extension popup. When user re-opens popup after successful OAuth, they have to restart the restore flow. Only Google has a shortcut button (via `chrome.identity.getAuthToken`). Dropbox and OneDrive have no equivalent.

### Fix — `last_connected_provider` in `browser.storage.local`

#### 1. Storage key

New unencrypted key `last_connected_provider` in `browser.storage.local`:

```typescript
{
  provider: 'google-drive' | 'dropbox' | 'onedrive';
  timestamp: string;
}
```

Unencrypted because it contains no secrets — just which provider was used. Must be readable before vault unlock (setup screen reads it).

#### 2. Write on OAuth success

**File:** `apps/extension/src/background/message-handler.ts`

In `GOOGLE_OAUTH_CONNECT`, `DROPBOX_OAUTH_CONNECT`, and `ONEDRIVE_OAUTH_CONNECT` handlers, after successfully saving the sync config:

```typescript
await browser.storage.local.set({
  last_connected_provider: {
    provider: 'google-drive', // or 'dropbox' or 'onedrive'
    timestamp: new Date().toISOString(),
  },
});
```

#### 3. SetupScreen changes

**File:** `apps/extension/src/popup/screens/SetupScreen.tsx`

Replace the Google-only `chrome.identity.getAuthToken` check with:

```typescript
useEffect(() => {
  // Check for last connected provider first
  browser.storage.local.get('last_connected_provider').then((result) => {
    const data = result.last_connected_provider;
    if (data?.provider) {
      setRestoreProvider(data.provider);
      return;
    }
    // Fallback: check for cached Google token via Chrome identity API
    // (catches case where user signed into Google via Chrome but hasn't used KeyKeyKey)
    try {
      const identity = (globalThis as any).chrome?.identity;
      if (identity?.getAuthToken) {
        identity
          .getAuthToken({ interactive: false })
          .then((r: any) => {
            if (r?.token) setRestoreProvider('google-drive');
          })
          .catch(() => {});
      }
    } catch {}
  });
}, []);
```

Show a "Restore from [Provider Name]" button when `restoreProvider` is set:

- `google-drive` → "Restore from Google Drive"
- `dropbox` → "Restore from Dropbox"
- `onedrive` → "Restore from OneDrive"

Same styling as the current Google restore button. Click navigates to `restore:{provider}`.

#### 4. Clear after use

Clear `last_connected_provider` after:

- Successful vault restore (restore flow completed)
- Successful vault setup (user created new vault instead)
- `RESET_VAULT` (full reset)

#### 5. RestoreScreen initial provider

When the button is clicked, navigate to `restore:{provider}` which sets `initialProvider` on RestoreScreen, skipping the provider selection step — same as current Google flow.
