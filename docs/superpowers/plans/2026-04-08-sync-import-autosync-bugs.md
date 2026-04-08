# Sync, Import & Auto-Sync Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 bugs: import not syncing to cloud, no auto-sync, extension import breaking on popup close, missing Dropbox/OneDrive restore buttons.

**Architecture:** Changes span core sync engine (parallel push, periodic sync), extension background worker (bulk import handler, periodic alarm, provider persistence), extension popup (import progress polling, restore button), and desktop vault context (explicit sync after import).

**Tech Stack:** TypeScript, Vitest, Zustand, webextension-polyfill, chrome.alarms API

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/core/src/sync/sync-engine.ts` | Parallel push (pMap), periodic sync timer |
| Modify | `packages/core/src/sync/sync-engine.test.ts` | Tests for parallel push, periodic sync |
| Modify | `apps/extension/src/lib/messages.ts` | New message types: IMPORT_ITEMS, GET_IMPORT_STATUS, CLEAR_IMPORT_STATUS |
| Modify | `apps/extension/src/background/message-handler.ts` | IMPORT_ITEMS handler, import state, last_connected_provider writes |
| Modify | `apps/extension/src/background/index.ts` | Periodic sync alarm, IMPORT_ITEMS in post-processing |
| Modify | `apps/extension/src/background/sync.ts` | startPeriodicSyncAlarm / stopPeriodicSyncAlarm helpers |
| Modify | `apps/extension/src/popup/screens/ImportScreen.tsx` | Bulk import via IMPORT_ITEMS, poll GET_IMPORT_STATUS |
| Modify | `apps/extension/src/popup/screens/SetupScreen.tsx` | Read last_connected_provider, show provider-agnostic restore button |
| Modify | `apps/desktop/src/lib/vault-context.tsx` | Explicit triggerSync after addItems |
| Modify | `apps/desktop/src/screens/ImportScreen.tsx` | Show "Syncing..." spinner after import |

---

### Task 1: Parallelize sync engine push loop

**Files:**
- Modify: `packages/core/src/sync/sync-engine.ts:375-405`
- Modify: `packages/core/src/sync/sync-engine.test.ts`

- [ ] **Step 1: Write failing test — parallel push of multiple items**

Add to `packages/core/src/sync/sync-engine.test.ts`:

```typescript
it('should push multiple local items to empty remote', async () => {
  // Add 10 items
  for (let i = 0; i < 10; i++) {
    store.getState().addItem({
      type: 'credential',
      name: `Cred ${i}`,
      tags: [],
      favorite: false,
      username: `user${i}`,
      password: `pass${i}`,
    });
  }

  const result = await engine.sync();
  expect(result.pushed).toBe(10);
  expect(result.pulled).toBe(0);

  const { mek } = await ensureMek();
  const blob = await adapter.readVaultBlob();
  const decoded = decryptVaultBlob(blob!, mek);
  expect(Object.keys(decoded.manifest.items)).toHaveLength(10);
});

it('should write items via adapter concurrently during push', async () => {
  const writeOrder: string[] = [];
  const originalWriteItem = adapter.writeItem.bind(adapter);
  vi.spyOn(adapter, 'writeItem').mockImplementation(async (id, data) => {
    writeOrder.push(id);
    // Simulate async delay
    await new Promise((r) => setTimeout(r, 10));
    return originalWriteItem(id, data);
  });

  for (let i = 0; i < 6; i++) {
    store.getState().addItem({
      type: 'credential',
      name: `Cred ${i}`,
      tags: [],
      favorite: false,
      username: `user${i}`,
      password: `pass${i}`,
    });
  }

  const result = await engine.sync();
  expect(result.pushed).toBe(6);
  // All 6 items should have been written
  expect(writeOrder).toHaveLength(6);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- --run packages/core/src/sync/sync-engine.test.ts`

Expected: Tests pass (the sequential loop already handles multiple items). The key change is behavioral — we'll verify concurrency works after implementation.

- [ ] **Step 3: Replace sequential push loop with pMap**

In `packages/core/src/sync/sync-engine.ts`, add import at the top:

```typescript
import { pMap } from '../utils/concurrency.js';
```

Replace lines 375-405 (the push section) with:

```typescript
    // -----------------------------------------------------------------------
    // 6. Push: local items newer than remote (or missing from remote)
    // -----------------------------------------------------------------------
    const finalItems = this.store.getState().items;
    const pulledIds = new Set(itemsToPull.map((i) => i.id));

    const itemsToPush = finalItems.filter((item) => {
      if (pulledIds.has(item.id)) return false;
      const remoteMeta = remote.items[item.id];
      return !remoteMeta || item.updatedAt > remoteMeta.updatedAt;
    });

    await pMap(itemsToPush, async (item) => {
      // NOTE: `state` was captured at the start of _runSync, but encryptItem
      // reads the DEK from a closure (not from state.items), so it remains
      // valid even after the store has been mutated during pull.
      const encrypted = state.encryptItem(item);
      await this.adapter.writeItem(item.id, encrypted);

      // Update merged manifest entry with fresh hash
      merged.items[item.id] = {
        updatedAt: item.updatedAt,
        hash: hashBytes(encrypted),
      };
    }, 5);

    const pushed = itemsToPush.length;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- --run packages/core/src/sync/sync-engine.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync/sync-engine.ts packages/core/src/sync/sync-engine.test.ts
git commit -m "fix(sync): parallelize push loop with pMap concurrency 5"
```

---

### Task 2: Add periodic sync to SyncEngine

**Files:**
- Modify: `packages/core/src/sync/sync-engine.ts`
- Modify: `packages/core/src/sync/sync-engine.test.ts`

- [ ] **Step 1: Write failing tests for periodic sync**

Add to `packages/core/src/sync/sync-engine.test.ts`:

```typescript
describe('periodic sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call sync() at the configured interval', async () => {
    const syncSpy = vi.spyOn(engine, 'sync').mockResolvedValue({
      pushed: 0, pulled: 0, deleted: 0, conflicts: 0,
    });

    engine.startPeriodicSync(60_000);

    // Advance 60 seconds
    await vi.advanceTimersByTimeAsync(60_000);
    expect(syncSpy).toHaveBeenCalledTimes(1);

    // Advance another 60 seconds
    await vi.advanceTimersByTimeAsync(60_000);
    expect(syncSpy).toHaveBeenCalledTimes(2);

    engine.stopPeriodicSync();
  });

  it('should not call sync() if already syncing', async () => {
    vi.spyOn(engine, 'isSyncing').mockReturnValue(true);
    const syncSpy = vi.spyOn(engine, 'sync');

    engine.startPeriodicSync(60_000);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(syncSpy).not.toHaveBeenCalled();

    engine.stopPeriodicSync();
  });

  it('should stop periodic sync when stopPeriodicSync is called', async () => {
    const syncSpy = vi.spyOn(engine, 'sync').mockResolvedValue({
      pushed: 0, pulled: 0, deleted: 0, conflicts: 0,
    });

    engine.startPeriodicSync(60_000);
    engine.stopPeriodicSync();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('should replace previous periodic timer on restart', async () => {
    const syncSpy = vi.spyOn(engine, 'sync').mockResolvedValue({
      pushed: 0, pulled: 0, deleted: 0, conflicts: 0,
    });

    engine.startPeriodicSync(60_000);
    engine.startPeriodicSync(30_000);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(syncSpy).toHaveBeenCalledTimes(1);

    engine.stopPeriodicSync();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- --run packages/core/src/sync/sync-engine.test.ts`

Expected: FAIL — `engine.startPeriodicSync is not a function`

- [ ] **Step 3: Implement periodic sync methods**

In `packages/core/src/sync/sync-engine.ts`, add a new private field after `private backoffMs = 0;`:

```typescript
  /** Periodic sync interval handle. */
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
```

Add new public methods after `scheduleSync`:

```typescript
  /**
   * Start periodic background sync at the given interval.
   * Skips if a sync is already running.
   */
  startPeriodicSync(intervalMs: number = 60_000): void {
    this.stopPeriodicSync();
    this.periodicTimer = setInterval(() => {
      if (!this._isSyncing) {
        void this.sync();
      }
    }, intervalMs);
  }

  /**
   * Stop the periodic sync timer.
   */
  stopPeriodicSync(): void {
    if (this.periodicTimer !== null) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- --run packages/core/src/sync/sync-engine.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync/sync-engine.ts packages/core/src/sync/sync-engine.test.ts
git commit -m "feat(sync): add periodic sync timer to SyncEngine"
```

---

### Task 3: Wire periodic sync into SyncLifecycle + desktop/extension

**Files:**
- Modify: `packages/core/src/sync/sync-lifecycle.ts`
- Modify: `apps/extension/src/background/sync.ts`
- Modify: `apps/extension/src/background/index.ts`
- Modify: `apps/extension/src/background/auto-lock.ts`

- [ ] **Step 1: Start periodic sync in SyncLifecycle after engine creation**

In `packages/core/src/sync/sync-lifecycle.ts`, in the `_createEngine` method, after `this._disconnect = initSyncEngine(engine, this._store);` (line 466) and after `this._disconnect = connectSyncEngine(this._store, engine);` (line 468), add:

```typescript
      engine.startPeriodicSync(60_000);
```

So the block becomes:

```typescript
    if (engine) {
      this._engine = engine;
      if (withInitialSync) {
        this._disconnect = initSyncEngine(engine, this._store);
      } else {
        this._disconnect = connectSyncEngine(this._store, engine);
      }
      engine.startPeriodicSync(60_000);
    }
```

In the `_teardownEngine` method, add `this._engine.stopPeriodicSync()` before nulling the engine. Find the `_teardownEngine` method and update it:

```typescript
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
```

- [ ] **Step 2: Add periodic sync alarm for extension MV3**

In MV3 service workers, `setInterval` is unreliable because the worker can be terminated. The keepalive alarm already prevents this while the vault is unlocked, so `setInterval` inside the engine will work as long as the keepalive is running. No separate `chrome.alarms` needed — the existing keepalive alarm (every 25s) already ensures the service worker stays alive.

Verify this by checking that `AutoLockManager.start()` creates the keepalive alarm when the vault is unlocked. It does — see `auto-lock.ts` line 34.

No changes needed for this step. The core `setInterval`-based periodic sync will work in the extension because the keepalive alarm prevents worker termination.

- [ ] **Step 3: Run full core test suite**

Run: `pnpm --filter @keykeykey/core test -- --run`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sync/sync-lifecycle.ts
git commit -m "feat(sync): wire periodic sync into SyncLifecycle for all platforms"
```

---

### Task 4: Explicit sync after desktop import

**Files:**
- Modify: `apps/desktop/src/lib/vault-context.tsx:571-592`
- Modify: `apps/desktop/src/screens/ImportScreen.tsx:112-145`

- [ ] **Step 1: Add triggerSync call after addItems in vault context**

In `apps/desktop/src/lib/vault-context.tsx`, modify the `addItems` callback (around line 571) to call `triggerSync` after persisting:

```typescript
  const addItems = useCallback(
    async (itemsData: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<string[]> => {
      const ids = storeRef.current.getState().addItems(itemsData);
      const state = storeRef.current.getState();
      const addedItems = ids
        .map((id) => state.items.find((i: VaultItem) => i.id === id))
        .filter((item): item is VaultItem => item !== undefined);
      await pMap(addedItems, async (added) => {
        const encrypted = state.encryptItem(added);
        await saveEncryptedItem(
          added.id,
          added.type,
          toBase64(encrypted),
          added.createdAt,
          added.updatedAt,
        );
      });
      syncItems();

      // Trigger sync after import to push new items to cloud
      const lifecycle = lifecycleRef.current;
      if (lifecycle) {
        const result = await lifecycle.triggerSync();
        if (result.lastSynced) setLastSynced(result.lastSynced);
      }

      return ids;
    },
    [syncItems],
  );
```

- [ ] **Step 2: Show "Syncing..." state in desktop ImportScreen**

In `apps/desktop/src/screens/ImportScreen.tsx`, the `handleCsvImport` function currently sets `setImporting(true)` at the start and `false` at the end. The `addItems` call now includes sync, so the spinner will naturally cover the sync time. No UI changes needed — the existing "Importing..." spinner will cover both import and sync.

However, update the button text to reflect the phase. Add a `syncing` state:

In `apps/desktop/src/screens/ImportScreen.tsx`, add a state variable:

```typescript
const [syncing, setSyncing] = useState(false);
```

Update `handleCsvImport`:

```typescript
  const handleCsvImport = async () => {
    if (!csvParseResult || csvParseResult.items.length === 0) return;
    setImporting(true);
    setSyncing(false);
    setCsvError(null);
    try {
      let itemsToAdd = csvParseResult.items;
      let duplicateCount = 0;

      if (importMode === 'merge' && items.length > 0) {
        const tempItems: VaultItem[] = csvParseResult.items.map((item, i) => ({
          ...item,
          id: `temp-${i}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })) as VaultItem[];

        const mergeResult = findDuplicates(tempItems, items);
        duplicateCount = mergeResult.skipped.length;

        const importIds = new Set(mergeResult.toImport.map((it) => it.id));
        itemsToAdd = csvParseResult.items.filter((_, i) => importIds.has(`temp-${i}`));
      }

      setSyncing(true);
      await addItems(itemsToAdd);
      setSyncing(false);

      setSuccess({ count: itemsToAdd.length, duplicates: duplicateCount });
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      setSyncing(false);
    }
  };
```

Update the import button text to show syncing state (find the button that shows "Importing..." and update):

```typescript
{importing ? (syncing ? 'Syncing to cloud\u2026' : 'Importing\u2026') : `Import ${csvParseResult.items.length} items`}
```

- [ ] **Step 3: Run desktop tests**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/desktop test -- --run`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/vault-context.tsx apps/desktop/src/screens/ImportScreen.tsx
git commit -m "fix(desktop): trigger sync after CSV import with syncing spinner"
```

---

### Task 5: Add IMPORT_ITEMS, GET_IMPORT_STATUS, CLEAR_IMPORT_STATUS message types

**Files:**
- Modify: `apps/extension/src/lib/messages.ts`

- [ ] **Step 1: Add new message types to BackgroundMessage union**

In `apps/extension/src/lib/messages.ts`, add the three new message types to the `BackgroundMessage` union (before the closing semicolon at line 97):

```typescript
  | { type: 'IMPORT_ITEMS'; items: NewItemData[] }
  | { type: 'GET_IMPORT_STATUS' }
  | { type: 'CLEAR_IMPORT_STATUS' }
```

- [ ] **Step 2: Commit**

```bash
git add apps/extension/src/lib/messages.ts
git commit -m "feat(extension): add IMPORT_ITEMS, GET_IMPORT_STATUS, CLEAR_IMPORT_STATUS message types"
```

---

### Task 6: Implement IMPORT_ITEMS background handler

**Files:**
- Modify: `apps/extension/src/background/message-handler.ts`
- Modify: `apps/extension/src/background/index.ts`

- [ ] **Step 1: Add import state and handler to message-handler.ts**

In `apps/extension/src/background/message-handler.ts`, add module-level import state inside `createMessageHandler` (after line 71, after `let headerBase64: string | null = null;`):

```typescript
  // Import progress state (survives popup close)
  let importState: {
    status: 'idle' | 'importing' | 'syncing' | 'done' | 'error';
    imported: number;
    total: number;
    error?: string;
  } = { status: 'idle', imported: 0, total: 0 };
```

Add the three message handlers. Find the `case 'ADD_ITEM':` block and add the new cases before it:

```typescript
      case 'IMPORT_ITEMS': {
        if (sender?.tab) return { error: 'Not allowed from content scripts' };
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
        if (importState.status === 'importing' || importState.status === 'syncing') {
          return { error: 'Import already in progress' };
        }

        const importItems = message.items;
        importState = { status: 'importing', imported: 0, total: importItems.length };

        // Fire and forget — work continues after response
        (async () => {
          try {
            // Add all items to store at once
            const ids = store.getState().addItems(importItems);

            // Encrypt and persist each item
            const state = store.getState();
            for (const id of ids) {
              const item = state.items.find((i) => i.id === id);
              if (item) {
                const encrypted = state.encryptItem(item);
                await saveEncryptedItem(id, toBase64(encrypted));
                importState.imported++;
              }
            }

            // Sync to cloud
            importState.status = 'syncing';
            const lc = getLifecycle();
            if (lc) {
              const syncResult = await lc.triggerSync();
              if (syncResult.lastSynced) setLastSynced(syncResult.lastSynced);
              if (syncResult.error) setSyncError(syncResult.error);
            }

            importState.status = 'done';
          } catch (err) {
            importState = {
              status: 'error',
              imported: importState.imported,
              total: importState.total,
              error: err instanceof Error ? err.message : 'Import failed',
            };
          }
        })();

        return { ok: true };
      }

      case 'GET_IMPORT_STATUS': {
        return { ...importState };
      }

      case 'CLEAR_IMPORT_STATUS': {
        importState = { status: 'idle', imported: 0, total: 0 };
        return { ok: true };
      }
```

Note: `addItems` is a synchronous function on the store (returns `string[]`, not a Promise). It's already imported — check that the store interface has it. The `store.getState().addItems()` call adds all items in one Zustand `set()` call.

- [ ] **Step 2: Add IMPORT_ITEMS to post-processing in index.ts**

In `apps/extension/src/background/index.ts`, add `IMPORT_ITEMS` to the vault-changed notification block (around line 37-53). After the existing `msg.type === 'UPDATE_CREDENTIAL'` check, add `msg.type === 'IMPORT_ITEMS'`:

```typescript
      if (
        msg.type === 'ADD_ITEM' ||
        msg.type === 'UPDATE_ITEM' ||
        msg.type === 'DELETE_ITEM' ||
        msg.type === 'SAVE_CREDENTIAL' ||
        msg.type === 'UPDATE_CREDENTIAL' ||
        msg.type === 'IMPORT_ITEMS'
      ) {
```

However, for `IMPORT_ITEMS`, the sync is already handled inside the handler's fire-and-forget async block. We should notify content scripts but NOT trigger sync again. Update the block to:

```typescript
      if (
        msg.type === 'ADD_ITEM' ||
        msg.type === 'UPDATE_ITEM' ||
        msg.type === 'DELETE_ITEM' ||
        msg.type === 'SAVE_CREDENTIAL' ||
        msg.type === 'UPDATE_CREDENTIAL' ||
        msg.type === 'IMPORT_ITEMS'
      ) {
        const r = result as Record<string, unknown>;
        if (!r.error) {
          notifyContentScripts({ type: 'VAULT_CHANGED' });

          // Sync immediately — except IMPORT_ITEMS which handles its own sync
          if (msg.type !== 'IMPORT_ITEMS') {
            await handler({ type: 'TRIGGER_SYNC' }).catch(() => {});
          }
        }
      }
```

- [ ] **Step 3: Run extension tests**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/extension test -- --run`

Expected: All tests pass (no existing tests cover message handler directly; the type changes should compile).

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/background/message-handler.ts apps/extension/src/background/index.ts
git commit -m "feat(extension): implement IMPORT_ITEMS background handler with progress tracking"
```

---

### Task 7: Update extension ImportScreen to use bulk import + progress polling

**Files:**
- Modify: `apps/extension/src/popup/screens/ImportScreen.tsx`

- [ ] **Step 1: Rewrite import flow to use IMPORT_ITEMS and poll progress**

Replace the import logic in `apps/extension/src/popup/screens/ImportScreen.tsx`. The key changes are:

1. Replace the `for` loop over `addItemViaBackground` with a single `IMPORT_ITEMS` message
2. Add `GET_IMPORT_STATUS` polling on mount and during import
3. Show progress when import is in progress (even after popup reopen)

Add new state variables after the existing state declarations (around line 62):

```typescript
  const [importProgress, setImportProgress] = useState<{
    status: 'idle' | 'importing' | 'syncing' | 'done' | 'error';
    imported: number;
    total: number;
    error?: string;
  } | null>(null);
```

Add a `useEffect` to check for in-progress import on mount:

```typescript
  // Check for in-progress import on mount (popup may have closed and reopened)
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await sendMessage<{
        status: string;
        imported: number;
        total: number;
        error?: string;
      }>({ type: 'GET_IMPORT_STATUS' });
      if (!cancelled && status && status.status !== 'idle') {
        setImportProgress(status as typeof importProgress);
        setImporting(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);
```

Add a polling effect that runs while importing:

```typescript
  // Poll import status while importing
  React.useEffect(() => {
    if (!importing) return;
    const interval = setInterval(async () => {
      const status = await sendMessage<{
        status: string;
        imported: number;
        total: number;
        error?: string;
      }>({ type: 'GET_IMPORT_STATUS' });
      if (!status) return;
      const typed = status as NonNullable<typeof importProgress>;
      setImportProgress(typed);

      if (typed.status === 'done') {
        clearInterval(interval);
        setImporting(false);
        setSuccess({ count: typed.total, duplicates: 0 });
        await sendMessage({ type: 'CLEAR_IMPORT_STATUS' });
        onRefresh();
      } else if (typed.status === 'error') {
        clearInterval(interval);
        setImporting(false);
        setCsvError(typed.error ?? 'Import failed');
        await sendMessage({ type: 'CLEAR_IMPORT_STATUS' });
      }
    }, 500);
    return () => clearInterval(interval);
  }, [importing, onRefresh]);
```

Replace the `handleCsvImport` function (lines 133-170) with:

```typescript
  const handleCsvImport = async () => {
    if (!csvParseResult || csvParseResult.items.length === 0) return;
    setImporting(true);
    setCsvError(null);
    try {
      let itemsToAdd = csvParseResult.items;
      let duplicateCount = 0;

      if (importMode === 'merge') {
        const existingItems = await getCurrentItems();
        if (existingItems.length > 0) {
          const tempItems: VaultItem[] = csvParseResult.items.map((item, i) => ({
            ...item,
            id: `temp-${i}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })) as VaultItem[];

          const mergeResult = findDuplicates(tempItems, existingItems);
          duplicateCount = mergeResult.skipped.length;

          const importIds = new Set(mergeResult.toImport.map((it) => it.id));
          itemsToAdd = csvParseResult.items.filter((_, i) => importIds.has(`temp-${i}`));
        }
      }

      // Send all items in one message — background handles persist + sync
      const result = await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'IMPORT_ITEMS',
        items: itemsToAdd as NewItemData[],
      });

      if ((result as { error?: string }).error) {
        throw new Error((result as { error: string }).error);
      }

      // Polling effect will handle progress updates from here
      setImportProgress({ status: 'importing', imported: 0, total: itemsToAdd.length });
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Import failed');
      setImporting(false);
    }
  };
```

Remove the `addItemViaBackground` helper function (lines 82-84) — it's no longer used.

Update the import button / spinner text in the JSX to show progress. Find where `importing` is used to show a spinner and update to show progress:

```typescript
{importing && importProgress ? (
  importProgress.status === 'syncing'
    ? 'Syncing to cloud\u2026'
    : `Importing ${importProgress.imported}/${importProgress.total}\u2026`
) : 'Import'}
```

- [ ] **Step 2: Build and verify no type errors**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/extension test -- --run`

Expected: All tests pass, no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/popup/screens/ImportScreen.tsx
git commit -m "feat(extension): bulk import via IMPORT_ITEMS with progress polling"
```

---

### Task 8: Persist last_connected_provider on OAuth success

**Files:**
- Modify: `apps/extension/src/background/message-handler.ts`

- [ ] **Step 1: Write to last_connected_provider after OAuth connect**

In `apps/extension/src/background/message-handler.ts`, in the `GOOGLE_OAUTH_CONNECT` handler (around line 719, after `await lc.saveConfig(config);`), add:

```typescript
          await browser.storage.local.set({
            last_connected_provider: {
              provider: 'google-drive',
              timestamp: new Date().toISOString(),
            },
          });
```

In the `DROPBOX_OAUTH_CONNECT` handler (after `await lc.saveConfig(config);`), add:

```typescript
          await browser.storage.local.set({
            last_connected_provider: {
              provider: 'dropbox',
              timestamp: new Date().toISOString(),
            },
          });
```

In the `ONEDRIVE_OAUTH_CONNECT` handler (after `await lc.saveConfig(config);`), add:

```typescript
          await browser.storage.local.set({
            last_connected_provider: {
              provider: 'onedrive',
              timestamp: new Date().toISOString(),
            },
          });
```

- [ ] **Step 2: Clear last_connected_provider after setup, restore, and reset**

In the `SETUP` handler, after successful vault creation (after `return { recoveryKey: display };`... actually, add it before the return):

Find the SETUP handler's success path and add before the final return:

```typescript
          await browser.storage.local.remove('last_connected_provider');
```

In the `RESTORE_FROM_CLOUD` handler, after successful restore (before `return result;` at the end), add:

```typescript
        await browser.storage.local.remove('last_connected_provider');
```

In the `RESET_VAULT` handler, add:

```typescript
          await browser.storage.local.remove('last_connected_provider');
```

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/background/message-handler.ts
git commit -m "feat(extension): persist last_connected_provider on OAuth success"
```

---

### Task 9: Show provider-agnostic restore button on SetupScreen

**Files:**
- Modify: `apps/extension/src/popup/screens/SetupScreen.tsx`

- [ ] **Step 1: Replace Google-only token check with provider-agnostic check**

In `apps/extension/src/popup/screens/SetupScreen.tsx`, replace the `hasGoogleToken` state and `useEffect` (lines 19-44) with:

```typescript
  const [restoreProvider, setRestoreProvider] = useState<string | null>(null);

  useEffect(() => {
    // Check for last connected provider first (persisted across popup close)
    browser.storage.local.get('last_connected_provider').then((result) => {
      const data = result.last_connected_provider as
        | { provider: string; timestamp: string }
        | undefined;
      if (data?.provider) {
        setRestoreProvider(data.provider);
        return;
      }
      // Fallback: check for cached Google token via Chrome identity API
      try {
        const identity = (
          globalThis as unknown as {
            chrome?: {
              identity?: {
                getAuthToken: (opts: { interactive: boolean }) => Promise<{ token?: string }>;
              };
            };
          }
        ).chrome?.identity;
        if (identity?.getAuthToken) {
          identity
            .getAuthToken({ interactive: false })
            .then((r) => {
              if (r?.token) setRestoreProvider('google-drive');
            })
            .catch(() => {});
        }
      } catch {
        // Not available
      }
    });
  }, []);
```

Add the `browser` import at the top of the file:

```typescript
import browser from 'webextension-polyfill';
```

- [ ] **Step 2: Update the restore button to be provider-agnostic**

Replace the `hasGoogleToken` conditional button (lines 251-268) with:

```typescript
        {restoreProvider && (
          <button
            type="button"
            onClick={() => onNavigate?.(`restore:${restoreProvider}`)}
            style={{
              background: theme.colors.surface,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.md,
              padding: `${theme.spacing.sm}px`,
              color: theme.colors.text,
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.medium,
              cursor: 'pointer',
            }}
          >
            Restore from{' '}
            {restoreProvider === 'google-drive'
              ? 'Google Drive'
              : restoreProvider === 'dropbox'
                ? 'Dropbox'
                : restoreProvider === 'onedrive'
                  ? 'OneDrive'
                  : restoreProvider}
          </button>
        )}
```

- [ ] **Step 3: Build and verify no type errors**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/extension test -- --run`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/popup/screens/SetupScreen.tsx
git commit -m "feat(extension): show provider-agnostic restore button on setup screen"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm build && pnpm test
```

Expected: All tests pass across all packages.

- [ ] **Step 2: Run linting and formatting**

```bash
pnpm lint && pnpm format:check
```

Expected: No errors. If formatting issues, run `pnpm format` and commit.

- [ ] **Step 3: Run critical E2E tests**

```bash
cd e2e && npx playwright test --grep @critical
```

Expected: Critical E2E tests pass.

- [ ] **Step 4: Final commit if any formatting fixes**

```bash
git add -A
git commit -m "style: fix formatting"
```
