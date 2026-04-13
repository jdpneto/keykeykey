# Extension Internal Decomposition (PR2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the extension's god modules (`message-handler.ts` 1,376 lines, `Popup.tsx` 744 lines) and six large screens into focused, single-responsibility modules with a context-based handler architecture and shared UI components.

**Architecture:** Background: `message-handler.ts` → `HandlerContext` + domain-specific handlers + thin message router. Popup: `Popup.tsx` → slim shell + `router/Router.tsx` + `useOperationProgress` hook + decomposed large screens with shared form components and a reusable `ProgressView`.

**Tech Stack:** TypeScript, React, webextension-polyfill, Zustand, Vitest, `@keykeykey/core`

**Prerequisite:** PR1 (OAuth consolidation) must be merged first. This plan assumes OAuth imports come from `lib/oauth/index.js`.

---

### Task 1: Create HandlerContext type and factory

**Files:**

- Create: `apps/extension/src/background/context.ts`
- Create: `apps/extension/src/background/context.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/extension/src/background/context.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBrowserMock } from '../lib/browser-mock.js';

const browserMock = createBrowserMock();
vi.mock('webextension-polyfill', () => ({ default: browserMock }));

vi.mock('@keykeykey/core/crypto', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ARGON2_PRESETS: {
      ...(actual.ARGON2_PRESETS as Record<string, unknown>),
      browser: { t: 1, m: 1024, p: 1, dkLen: 32 },
    },
  };
});

const { createHandlerContext } = await import('./context.js');

describe('createHandlerContext', () => {
  beforeEach(() => {
    browserMock._reset();
  });

  it('creates a context with all required properties', async () => {
    const ctx = createHandlerContext();
    await ctx.init();

    expect(ctx.store).toBeDefined();
    expect(ctx.store.getState).toBeDefined();
    expect(ctx.headerBase64).toBeNull();
    expect(ctx.autoLock).toBeNull();
    expect(typeof ctx.startAutoLock).toBe('function');
    expect(typeof ctx.broadcastToContentScripts).toBe('function');
  });

  it('loads vault header from storage during init', async () => {
    browserMock.storage.local._store.vault_header = 'test-header-b64';
    const ctx = createHandlerContext();
    await ctx.init();

    expect(ctx.headerBase64).toBe('test-header-b64');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run src/background/context.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Extract the shared state and setup logic from `message-handler.ts` lines 67-288 into `context.ts`:

```typescript
// apps/extension/src/background/context.ts
import browser from 'webextension-polyfill';
import { createVaultStore, deserializeVaultHeader, serializeVaultHeader } from '@keykeykey/core';
import type { VaultItem } from '@keykeykey/core';
import { toBase64, fromBase64 } from '@keykeykey/core/utils';
import type { SyncConfig } from '@keykeykey/core/sync';
import { loadVaultHeader, saveVaultHeader, loadSettings } from './storage.js';
import { AutoLockManager } from './auto-lock.js';
import { scheduleClipboardClear } from './clipboard.js';
import {
  initLifecycle,
  getLifecycle,
  teardownLifecycle,
  getSyncStatus,
  getMismatchInfo,
  setLastSynced,
  setSyncError,
  recordTombstone,
  getCurrentConfig,
} from './sync-lifecycle.js';
import type { SyncCompatibleStore } from './sync-lifecycle.js';
import type { ContentPushMessage } from '../lib/messages.js';

// ---------------------------------------------------------------------------
// Per-tab fillable credential allowlist
// ---------------------------------------------------------------------------

export const tabAllowlists = new Map<number, Set<string>>();

// ---------------------------------------------------------------------------
// Persisted operation state types
// ---------------------------------------------------------------------------

export type ImportState = {
  status: 'idle' | 'importing' | 'syncing' | 'done' | 'error';
  imported: number;
  total: number;
  error?: string;
};

export type RestoreState = {
  status: 'idle' | 'restoring' | 'error';
  error?: string;
};

export type SyncOpState = {
  status: 'idle' | 'replacing_remote' | 'replacing_local' | 'merging' | 'error';
  error?: string;
};

export type SyncConnectState = {
  status: 'idle' | 'connecting' | 'error';
  provider?: 'google-drive' | 'dropbox' | 'onedrive';
  error?: string;
};

// ---------------------------------------------------------------------------
// HandlerContext
// ---------------------------------------------------------------------------

export interface HandlerContext {
  // Core state
  store: ReturnType<typeof createVaultStore>;
  headerBase64: string | null;
  autoLock: AutoLockManager | null;

  // Syncable store adapter
  syncableStore: SyncCompatibleStore;

  // Operation progress state
  importState: ImportState;
  restoreState: RestoreState;
  syncOpState: SyncOpState;
  syncConnectState: SyncConnectState;

  // State mutators with persistence
  setImportState: (next: ImportState) => void;
  setRestoreState: (next: RestoreState) => Promise<void>;
  setSyncOpState: (next: SyncOpState) => Promise<void>;
  setSyncConnectState: (next: SyncConnectState) => Promise<void>;

  // Lifecycle
  init: () => Promise<void>;
  startAutoLock: () => void;
  broadcastToContentScripts: (msg: ContentPushMessage) => Promise<void>;

  // Sync re-exports (to avoid handlers importing sync-lifecycle directly)
  initLifecycle: typeof initLifecycle;
  getLifecycle: typeof getLifecycle;
  teardownLifecycle: typeof teardownLifecycle;
  getSyncStatus: typeof getSyncStatus;
  getMismatchInfo: typeof getMismatchInfo;
  setLastSynced: typeof setLastSynced;
  setSyncError: typeof setSyncError;
  recordTombstone: typeof recordTombstone;
  getCurrentConfig: typeof getCurrentConfig;
  scheduleClipboardClear: typeof scheduleClipboardClear;
}

export function createHandlerContext(): HandlerContext {
  const store = createVaultStore();
  let autoLock: AutoLockManager | null = null;
  let headerBase64: string | null = null;

  // Operation state
  let importState: ImportState = { status: 'idle', imported: 0, total: 0 };
  let restoreState: RestoreState = { status: 'idle' };
  let syncOpState: SyncOpState = { status: 'idle' };
  let syncConnectState: SyncConnectState = { status: 'idle' };

  // Persistence helpers
  function setImportState(next: ImportState): void {
    importState = next;
    ctx.importState = importState;
    browser.storage.local.set({ import_state: importState }).catch(() => {});
  }

  async function setRestoreState(next: RestoreState): Promise<void> {
    restoreState = next;
    ctx.restoreState = restoreState;
    await browser.storage.local.set({ restore_state: restoreState }).catch(() => {});
  }

  async function setSyncOpState(next: SyncOpState): Promise<void> {
    syncOpState = next;
    ctx.syncOpState = syncOpState;
    await browser.storage.local.set({ sync_op_state: syncOpState }).catch(() => {});
  }

  async function setSyncConnectState(next: SyncConnectState): Promise<void> {
    syncConnectState = next;
    ctx.syncConnectState = syncConnectState;
    await browser.storage.local.set({ sync_connect_state: syncConnectState }).catch(() => {});
  }

  // Syncable store adapter
  const syncableStore: SyncCompatibleStore = {
    getState: () => store.getState(),
    setState: (partial) => store.setState(partial),
    getVaultId: () => store.getState().header?.vaultId ?? '',
    subscribe: (listener) => store.subscribe(listener),
  };

  function startAutoLock(): void {
    if (autoLock) autoLock.stop();
    autoLock = new AutoLockManager(() => {
      teardownLifecycle();
      store.getState().lock();
    });
    ctx.autoLock = autoLock;
    loadSettings().then((settings) => {
      autoLock?.start(settings.autoLockMode, settings.autoLockMinutes);
    });
  }

  async function broadcastToContentScripts(message: ContentPushMessage): Promise<void> {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) browser.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  }

  async function init(): Promise<void> {
    headerBase64 = await loadVaultHeader();

    // Migrate v1 headers to v2
    if (headerBase64) {
      const headerBytes = fromBase64(headerBase64);
      const header = deserializeVaultHeader(headerBytes);
      if (header.version === 1) {
        header.version = 2;
        const v2Bytes = serializeVaultHeader(header);
        headerBase64 = toBase64(v2Bytes);
        await saveVaultHeader(headerBase64);
      }
    }
    ctx.headerBase64 = headerBase64;

    // Restore import state
    try {
      const stored = await browser.storage.local.get('import_state');
      const prev = stored.import_state as ImportState | undefined;
      if (prev) {
        if (prev.status === 'importing' || prev.status === 'syncing') {
          setImportState({
            status: 'error',
            imported: prev.imported,
            total: prev.total,
            error: 'Import was interrupted. Please try again.',
          });
        } else {
          importState = prev;
          ctx.importState = importState;
        }
      }
    } catch {
      /* ignore */
    }

    // Restore restore state
    try {
      const stored = await browser.storage.local.get('restore_state');
      const prev = stored.restore_state as RestoreState | undefined;
      if (prev) {
        if (prev.status === 'restoring') {
          await setRestoreState({
            status: 'error',
            error: 'Restore was interrupted. Please try again.',
          });
        } else {
          restoreState = prev;
          ctx.restoreState = restoreState;
        }
      }
    } catch {
      /* ignore */
    }

    // Restore sync op state
    try {
      const stored = await browser.storage.local.get('sync_op_state');
      const prev = stored.sync_op_state as SyncOpState | undefined;
      if (prev) {
        if (
          prev.status === 'replacing_remote' ||
          prev.status === 'replacing_local' ||
          prev.status === 'merging'
        ) {
          await setSyncOpState({
            status: 'error',
            error: 'Sync operation was interrupted. Please try again.',
          });
        } else {
          syncOpState = prev;
          ctx.syncOpState = syncOpState;
        }
      }
    } catch {
      /* ignore */
    }

    // Restore sync connect state
    try {
      const stored = await browser.storage.local.get('sync_connect_state');
      const prev = stored.sync_connect_state as SyncConnectState | undefined;
      if (prev) {
        if (prev.status === 'connecting') {
          await setSyncConnectState({ status: 'idle' });
        } else {
          syncConnectState = prev;
          ctx.syncConnectState = syncConnectState;
        }
      }
    } catch {
      /* ignore */
    }
  }

  const ctx: HandlerContext = {
    store,
    headerBase64,
    autoLock,
    syncableStore,
    importState,
    restoreState,
    syncOpState,
    syncConnectState,
    setImportState,
    setRestoreState,
    setSyncOpState,
    setSyncConnectState,
    init,
    startAutoLock,
    broadcastToContentScripts,
    initLifecycle,
    getLifecycle,
    teardownLifecycle,
    getSyncStatus,
    getMismatchInfo,
    setLastSynced,
    setSyncError,
    recordTombstone,
    getCurrentConfig,
    scheduleClipboardClear,
  };

  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run src/background/context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/background/context.ts apps/extension/src/background/context.test.ts
git commit -m "refactor(extension): create HandlerContext type and factory"
```

---

### Task 2: Rename `sync.ts` → `sync-lifecycle.ts`

**Files:**

- Rename: `apps/extension/src/background/sync.ts` → `apps/extension/src/background/sync-lifecycle.ts`
- Modify: `apps/extension/src/background/message-handler.ts` (update import path)

- [ ] **Step 1: Rename the file**

```bash
cd /Users/davidneto/keykeykey
git mv apps/extension/src/background/sync.ts apps/extension/src/background/sync-lifecycle.ts
```

- [ ] **Step 2: Update import in message-handler.ts**

Replace lines 44-55 in `message-handler.ts`:

```typescript
// OLD:
import {
  initLifecycle,
  getLifecycle,
  getCurrentConfig,
  teardownLifecycle,
  getSyncStatus,
  getMismatchInfo,
  setLastSynced,
  setSyncError,
  recordTombstone,
} from './sync.js';
import type { SyncCompatibleStore } from './sync.js';

// NEW:
import {
  initLifecycle,
  getLifecycle,
  getCurrentConfig,
  teardownLifecycle,
  getSyncStatus,
  getMismatchInfo,
  setLastSynced,
  setSyncError,
  recordTombstone,
} from './sync-lifecycle.js';
import type { SyncCompatibleStore } from './sync-lifecycle.js';
```

- [ ] **Step 3: Update import in context.ts**

The `context.ts` file already imports from `./sync-lifecycle.js` (written in Task 1). Verify no other files import from `./sync.js`.

Run: `cd /Users/davidneto/keykeykey && grep -r "from.*['\"].*\/sync\.js['\"]" apps/extension/src/background/`

- [ ] **Step 4: Run tests**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/background/
git commit -m "refactor(extension): rename sync.ts to sync-lifecycle.ts for clarity"
```

---

### Task 3: Extract vault handler

**Files:**

- Create: `apps/extension/src/background/handlers/vault.ts`

- [ ] **Step 1: Create the handler file**

Extract the SETUP, UNLOCK, UNLOCK_PIN, LOCK, GET_STATUS, VALIDATE_MASTER_PASSWORD, and RESET_VAULT cases from `message-handler.ts`:

```typescript
// apps/extension/src/background/handlers/vault.ts
import {
  generateRecoveryKey,
  createVaultHeader,
  serializeVaultHeader,
  deserializeVaultHeader,
  ARGON2_PRESETS,
} from '@keykeykey/core';
import { unlockVault } from '@keykeykey/core/crypto';
import { setupPin, unwrapDekWithPin } from '@keykeykey/core/pin';
import { toBase64, fromBase64 } from '@keykeykey/core/utils';
import browser from 'webextension-polyfill';
import type { HandlerContext } from '../context.js';
import {
  loadVaultHeader,
  saveVaultHeader,
  loadEncryptedItems,
  loadPinData,
  savePinData,
  clearPinData,
  clearSyncConfig,
  clearSyncConfigEncrypted,
  deleteEncryptedItem,
} from '../storage.js';

export async function getStatus(
  _msg: { type: 'GET_STATUS' },
  ctx: HandlerContext,
): Promise<unknown> {
  const state = ctx.store.getState();
  const status = !ctx.headerBase64
    ? 'needs_setup'
    : state.status === 'unlocked'
      ? 'unlocked'
      : 'locked';
  const hasPIN = (await loadPinData()) !== null;
  return { status, hasPIN, itemCount: state.items.length };
}

export async function setup(
  msg: { type: 'SETUP'; password: string },
  ctx: HandlerContext,
): Promise<unknown> {
  const { raw, formatted } = generateRecoveryKey();
  const { header } = await createVaultHeader(msg.password, raw, ARGON2_PRESETS.browser);

  const serialized = serializeVaultHeader(header);
  const b64 = toBase64(serialized);
  await saveVaultHeader(b64);
  ctx.headerBase64 = b64;

  ctx.store.getState().loadHeader(header);
  await ctx.store.getState().unlock(msg.password, []);

  ctx.startAutoLock();

  const lc = ctx.initLifecycle(ctx.syncableStore, () => ctx.store.getState().header ?? null);
  await lc.initAfterUnlock();

  await browser.storage.local.remove('last_connected_provider');
  return { recoveryKey: formatted };
}

export async function unlock(
  msg: { type: 'UNLOCK'; password: string },
  ctx: HandlerContext,
): Promise<unknown> {
  if (!ctx.headerBase64) {
    return { error: 'No vault found. Please set up first.' };
  }

  try {
    const headerBytes = fromBase64(ctx.headerBase64);
    const header = deserializeVaultHeader(headerBytes);
    ctx.store.getState().loadHeader(header);

    const encItemMap = await loadEncryptedItems();
    const encryptedItems = Object.values(encItemMap).map(fromBase64);

    await ctx.store.getState().unlock(msg.password, encryptedItems);
    ctx.startAutoLock();

    const lc = ctx.initLifecycle(ctx.syncableStore, () => ctx.store.getState().header ?? null);
    await lc.initAfterUnlock();

    return { ok: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unlock failed';
    if (errMsg === 'invalid tag') {
      return { error: 'Incorrect master password.' };
    }
    return { error: errMsg };
  }
}

export async function unlockPin(
  msg: { type: 'UNLOCK_PIN'; pin: string },
  ctx: HandlerContext,
): Promise<unknown> {
  const pinData = await loadPinData();
  if (!pinData) {
    return { error: 'No PIN configured' };
  }

  try {
    const pinDataCore = {
      wrappedDEK: fromBase64(pinData.pinHash),
      salt: fromBase64(pinData.salt),
    };
    const dek = await unwrapDekWithPin(msg.pin, pinDataCore);
    if (!dek) throw new Error('Wrong PIN');

    if (!ctx.headerBase64) {
      return { error: 'No vault found' };
    }
    const headerBytes = fromBase64(ctx.headerBase64);
    const header = deserializeVaultHeader(headerBytes);
    ctx.store.getState().loadHeader(header);

    const encItemMap = await loadEncryptedItems();
    const encryptedItems = Object.values(encItemMap).map(fromBase64);

    ctx.store.getState().unlockWithDEK(dek, encryptedItems);

    ctx.startAutoLock();

    const lc = ctx.initLifecycle(ctx.syncableStore, () => ctx.store.getState().header ?? null);
    await lc.initAfterUnlock();

    return { success: true };
  } catch {
    const remaining = pinData.attemptsRemaining - 1;
    const { updatePinAttempts } = await import('../storage.js');
    await updatePinAttempts(remaining);
    if (remaining <= 0) {
      return { error: 'PIN locked out. Use master password.' };
    }
    return { error: `Wrong PIN. ${remaining} attempts remaining.` };
  }
}

export async function lock(_msg: { type: 'LOCK' }, ctx: HandlerContext): Promise<unknown> {
  ctx.teardownLifecycle();
  ctx.store.getState().lock();
  ctx.autoLock?.stop();
  ctx.autoLock = null;
  return { ok: true };
}

export async function validateMasterPassword(
  msg: { type: 'VALIDATE_MASTER_PASSWORD'; password: string },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { valid: false, error: 'Vault is locked' };
  if (!ctx.headerBase64) return { valid: false, error: 'No vault found' };
  try {
    const headerBytes = fromBase64(ctx.headerBase64);
    const header = deserializeVaultHeader(headerBytes);
    const dek = await unlockVault(header, msg.password);
    dek.fill(0);
    return { valid: true };
  } catch {
    return { valid: false };
  }
}

export async function resetVault(
  _msg: { type: 'RESET_VAULT' },
  ctx: HandlerContext,
): Promise<unknown> {
  ctx.teardownLifecycle();
  ctx.store.getState().resetVault();
  ctx.headerBase64 = null;
  ctx.autoLock?.stop();
  ctx.autoLock = null;
  const allItems = await loadEncryptedItems();
  for (const id of Object.keys(allItems)) {
    await deleteEncryptedItem(id);
  }
  await saveVaultHeader('');
  await clearPinData();
  await clearSyncConfig();
  await clearSyncConfigEncrypted();
  await browser.storage.local.remove('last_connected_provider');
  return { ok: true };
}
```

- [ ] **Step 2: Run existing message-handler tests (should still pass — old file untouched)**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run src/background/message-handler.test.ts`
Expected: PASS (old file still has all code)

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/background/handlers/vault.ts
git commit -m "refactor(extension): extract vault handler from message-handler"
```

---

### Task 4: Extract items handler

**Files:**

- Create: `apps/extension/src/background/handlers/items.ts`

- [ ] **Step 1: Create the handler file**

```typescript
// apps/extension/src/background/handlers/items.ts
import { matchCredentialsByDomain } from '@keykeykey/core';
import { toBase64 } from '@keykeykey/core/utils';
import type { HandlerContext } from '../context.js';
import { saveEncryptedItem, deleteEncryptedItem } from '../storage.js';
import type { NewItemData, ItemUpdates } from '../../lib/messages.js';

export async function getItems(_msg: { type: 'GET_ITEMS' }, ctx: HandlerContext): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  return { items: ctx.store.getState().items };
}

export async function getItemsForHost(
  msg: { type: 'GET_ITEMS_FOR_HOST'; hostname: string },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  const all = ctx.store.getState().items;
  const matches = matchCredentialsByDomain(msg.hostname, all);
  const matchIds = matches.map((m) => m.id);
  return { items: all, matchedIds: matchIds };
}

export async function search(
  msg: { type: 'SEARCH'; query: string },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  const items = ctx.store.getState().search(msg.query);
  return { items };
}

export async function addItem(
  msg: { type: 'ADD_ITEM'; item: NewItemData },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  const id = ctx.store.getState().addItem(msg.item);
  const item = ctx.store.getState().items.find((i) => i.id === id);
  if (item) {
    const encrypted = ctx.store.getState().encryptItem(item);
    await saveEncryptedItem(id, toBase64(encrypted));
  }
  return { id };
}

export async function updateItem(
  msg: { type: 'UPDATE_ITEM'; id: string; updates: ItemUpdates },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  ctx.store.getState().updateItem(msg.id, msg.updates);
  const updated = ctx.store.getState().items.find((i) => i.id === msg.id);
  if (updated) {
    const encrypted = ctx.store.getState().encryptItem(updated);
    await saveEncryptedItem(msg.id, toBase64(encrypted));
  }
  return { ok: true };
}

export async function deleteItem(
  msg: { type: 'DELETE_ITEM'; id: string },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  ctx.store.getState().deleteItem(msg.id);
  await deleteEncryptedItem(msg.id);
  ctx.recordTombstone(msg.id);
  return { ok: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/extension/src/background/handlers/items.ts
git commit -m "refactor(extension): extract items handler from message-handler"
```

---

### Task 5: Extract credentials handler

**Files:**

- Create: `apps/extension/src/background/handlers/credentials.ts`

- [ ] **Step 1: Create the handler file**

Extract GET_MATCHING_CREDENTIALS, FILL_CREDENTIAL, CHECK_CREDENTIAL_EXISTS, SAVE_CREDENTIAL, UPDATE_CREDENTIAL, GET_CREDENTIALS_FOR_TAB, and FILL_ACTIVE_TAB from `message-handler.ts` lines 866-1030. Same pattern — each function takes `(msg, ctx)` and returns `Promise<unknown>`. Import `tabAllowlists` from `context.ts`.

Use the exact logic from `message-handler.ts` lines 866-1030, replacing closure-captured `store` with `ctx.store` and `tabAllowlists` from `../context.js`.

- [ ] **Step 2: Commit**

```bash
git add apps/extension/src/background/handlers/credentials.ts
git commit -m "refactor(extension): extract credentials handler from message-handler"
```

---

### Task 6: Extract sync handler

**Files:**

- Create: `apps/extension/src/background/handlers/sync.ts`

- [ ] **Step 1: Create the handler file**

Extract GET_SYNC_STATUS, CONFIGURE_SYNC, TRIGGER_SYNC, DISCONNECT_SYNC, RESTORE_FROM_CLOUD, CLEAR_RESTORE_STATUS, GET_MISMATCH_INFO, CLEAR_MISMATCH, REPLACE_REMOTE, REPLACE_LOCAL, MERGE_VAULTS, CLEAR_SYNC_OP_STATUS, CLEAR_SYNC_CONNECT_STATUS from `message-handler.ts`. Each handler uses `ctx.getLifecycle()`, `ctx.setLastSynced()`, etc.

- [ ] **Step 2: Commit**

```bash
git add apps/extension/src/background/handlers/sync.ts
git commit -m "refactor(extension): extract sync handler from message-handler"
```

---

### Task 7: Extract OAuth handler

**Files:**

- Create: `apps/extension/src/background/handlers/oauth.ts`

- [ ] **Step 1: Create the handler file**

Extract GOOGLE_OAUTH_CONNECT, GOOGLE_OAUTH_GET_TOKEN, GOOGLE_OAUTH_DISCONNECT, DROPBOX_OAUTH_CONNECT, DROPBOX_OAUTH_GET_TOKEN, DROPBOX_OAUTH_DISCONNECT, ONEDRIVE_OAUTH_CONNECT, ONEDRIVE_OAUTH_GET_TOKEN, ONEDRIVE_OAUTH_DISCONNECT from `message-handler.ts`. Import OAuth functions from `../../lib/oauth/index.js`.

- [ ] **Step 2: Commit**

```bash
git add apps/extension/src/background/handlers/oauth.ts
git commit -m "refactor(extension): extract OAuth handler from message-handler"
```

---

### Task 8: Extract import-export handler

**Files:**

- Create: `apps/extension/src/background/handlers/import-export.ts`

- [ ] **Step 1: Create the handler file**

Extract IMPORT_ITEMS, GET_IMPORT_STATUS, CLEAR_IMPORT_STATUS from `message-handler.ts`. The import handler owns `ctx.importState` via `ctx.setImportState()`.

- [ ] **Step 2: Commit**

```bash
git add apps/extension/src/background/handlers/import-export.ts
git commit -m "refactor(extension): extract import-export handler from message-handler"
```

---

### Task 9: Extract settings handler

**Files:**

- Create: `apps/extension/src/background/handlers/settings.ts`

- [ ] **Step 1: Create the handler file**

Extract GET_SETTINGS, UPDATE_SETTINGS, SET_PIN, REMOVE_PIN, GENERATE_PASSWORD, GET_ACTIVE_TAB_URL, CLIPBOARD_COPIED from `message-handler.ts`.

- [ ] **Step 2: Commit**

```bash
git add apps/extension/src/background/handlers/settings.ts
git commit -m "refactor(extension): extract settings handler from message-handler"
```

---

### Task 10: Create handlers barrel and message router

**Files:**

- Create: `apps/extension/src/background/handlers/index.ts`
- Create: `apps/extension/src/background/router.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// apps/extension/src/background/handlers/index.ts
export * as vault from './vault.js';
export * as items from './items.js';
export * as credentials from './credentials.js';
export * as sync from './sync.js';
export * as oauth from './oauth.js';
export * as importExport from './import-export.js';
export * as settings from './settings.js';
```

- [ ] **Step 2: Create the router**

```typescript
// apps/extension/src/background/router.ts
import type { BackgroundMessage } from '../lib/messages.js';
import type { HandlerContext } from './context.js';
import * as handlers from './handlers/index.js';

type Handler = (msg: never, ctx: HandlerContext) => Promise<unknown>;

const ROUTES: Record<string, Handler> = {
  // Vault
  GET_STATUS: handlers.vault.getStatus as Handler,
  SETUP: handlers.vault.setup as Handler,
  UNLOCK: handlers.vault.unlock as Handler,
  UNLOCK_PIN: handlers.vault.unlockPin as Handler,
  LOCK: handlers.vault.lock as Handler,
  VALIDATE_MASTER_PASSWORD: handlers.vault.validateMasterPassword as Handler,
  RESET_VAULT: handlers.vault.resetVault as Handler,

  // Items
  GET_ITEMS: handlers.items.getItems as Handler,
  GET_ITEMS_FOR_HOST: handlers.items.getItemsForHost as Handler,
  SEARCH: handlers.items.search as Handler,
  ADD_ITEM: handlers.items.addItem as Handler,
  UPDATE_ITEM: handlers.items.updateItem as Handler,
  DELETE_ITEM: handlers.items.deleteItem as Handler,

  // Credentials
  GET_CREDENTIALS_FOR_TAB: handlers.credentials.getCredentialsForTab as Handler,
  GET_MATCHING_CREDENTIALS: handlers.credentials.getMatchingCredentials as Handler,
  FILL_CREDENTIAL: handlers.credentials.fillCredential as Handler,
  CHECK_CREDENTIAL_EXISTS: handlers.credentials.checkCredentialExists as Handler,
  SAVE_CREDENTIAL: handlers.credentials.saveCredential as Handler,
  UPDATE_CREDENTIAL: handlers.credentials.updateCredential as Handler,
  FILL_ACTIVE_TAB: handlers.credentials.fillActiveTab as Handler,

  // Sync
  GET_SYNC_STATUS: handlers.sync.getSyncStatusHandler as Handler,
  CONFIGURE_SYNC: handlers.sync.configureSync as Handler,
  TRIGGER_SYNC: handlers.sync.triggerSync as Handler,
  DISCONNECT_SYNC: handlers.sync.disconnectSync as Handler,
  RESTORE_FROM_CLOUD: handlers.sync.restoreFromCloud as Handler,
  CLEAR_RESTORE_STATUS: handlers.sync.clearRestoreStatus as Handler,
  GET_MISMATCH_INFO: handlers.sync.getMismatchInfoHandler as Handler,
  CLEAR_MISMATCH: handlers.sync.clearMismatch as Handler,
  REPLACE_REMOTE: handlers.sync.replaceRemote as Handler,
  REPLACE_LOCAL: handlers.sync.replaceLocal as Handler,
  MERGE_VAULTS: handlers.sync.mergeVaults as Handler,
  CLEAR_SYNC_OP_STATUS: handlers.sync.clearSyncOpStatus as Handler,
  CLEAR_SYNC_CONNECT_STATUS: handlers.sync.clearSyncConnectStatus as Handler,

  // OAuth
  GOOGLE_OAUTH_CONNECT: handlers.oauth.googleOAuthConnect as Handler,
  GOOGLE_OAUTH_GET_TOKEN: handlers.oauth.googleOAuthGetToken as Handler,
  GOOGLE_OAUTH_DISCONNECT: handlers.oauth.googleOAuthDisconnect as Handler,
  DROPBOX_OAUTH_CONNECT: handlers.oauth.dropboxOAuthConnect as Handler,
  DROPBOX_OAUTH_GET_TOKEN: handlers.oauth.dropboxOAuthGetToken as Handler,
  DROPBOX_OAUTH_DISCONNECT: handlers.oauth.dropboxOAuthDisconnect as Handler,
  ONEDRIVE_OAUTH_CONNECT: handlers.oauth.oneDriveOAuthConnect as Handler,
  ONEDRIVE_OAUTH_GET_TOKEN: handlers.oauth.oneDriveOAuthGetToken as Handler,
  ONEDRIVE_OAUTH_DISCONNECT: handlers.oauth.oneDriveOAuthDisconnect as Handler,

  // Import/Export
  IMPORT_ITEMS: handlers.importExport.importItems as Handler,
  GET_IMPORT_STATUS: handlers.importExport.getImportStatus as Handler,
  CLEAR_IMPORT_STATUS: handlers.importExport.clearImportStatus as Handler,

  // Settings
  GET_SETTINGS: handlers.settings.getSettings as Handler,
  UPDATE_SETTINGS: handlers.settings.updateSettings as Handler,
  SET_PIN: handlers.settings.setPin as Handler,
  REMOVE_PIN: handlers.settings.removePin as Handler,
  GENERATE_PASSWORD: handlers.settings.generatePassword as Handler,
  GET_ACTIVE_TAB_URL: handlers.settings.getActiveTabUrl as Handler,
  CLIPBOARD_COPIED: handlers.settings.clipboardCopied as Handler,
};

export function routeMessage(
  msg: BackgroundMessage,
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const handler = ROUTES[msg.type];
  if (!handler) {
    return Promise.resolve({ error: `Unknown message type: ${msg.type}` });
  }
  // Attach sender to message for handlers that need it
  const msgWithSender = Object.assign({}, msg, { _sender: sender });
  return handler(msgWithSender as never, ctx);
}
```

- [ ] **Step 3: Run existing tests to verify nothing broken (old message-handler still exists)**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/background/handlers/index.ts apps/extension/src/background/router.ts
git commit -m "refactor(extension): create handlers barrel and message router"
```

---

### Task 11: Replace message-handler.ts with router delegation

**Files:**

- Modify: `apps/extension/src/background/message-handler.ts` (reduce to thin shim)
- Modify: `apps/extension/src/background/index.ts` (update to use router + context)

- [ ] **Step 1: Replace message-handler.ts with a thin shim**

Replace the entire 1,376-line file with:

```typescript
// apps/extension/src/background/message-handler.ts
// SHIM: delegates to router.ts. Will be removed once index.ts is updated.
import type { BackgroundMessage } from '../lib/messages.js';
import { createHandlerContext, tabAllowlists } from './context.js';
import { routeMessage } from './router.js';
import type browser from 'webextension-polyfill';

export { tabAllowlists };

export function createMessageHandler() {
  const ctx = createHandlerContext();
  let initPromise: Promise<void> | null = ctx.init();

  return async function handleMessage(
    message: BackgroundMessage,
    sender?: browser.Runtime.MessageSender,
  ): Promise<unknown> {
    if (initPromise) {
      await initPromise;
      initPromise = null;
    }
    ctx.autoLock?.resetTimer();
    return routeMessage(message, ctx, sender);
  };
}
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run`
Expected: All tests PASS (the shim preserves the `createMessageHandler()` API that `index.ts` and tests use)

- [ ] **Step 3: Build both targets**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/background/message-handler.ts
git commit -m "refactor(extension): replace message-handler with thin router shim"
```

---

### Task 12: Extract ProgressView component from Popup.tsx

**Files:**

- Create: `apps/extension/src/popup/components/ProgressView.tsx`

- [ ] **Step 1: Create the shared component**

Extract the four inline views (`RestoreProgressView`, `RestoreErrorView`, `SyncOpProgressView`, `SyncOpErrorView`) into a single reusable component:

```typescript
// apps/extension/src/popup/components/ProgressView.tsx
import React from 'react';
import { useTheme } from '../../lib/theme.js';

type Theme = ReturnType<typeof useTheme>['theme'];

interface ProgressViewProps {
  title: string;
  message: string;
  subtitle?: string;
  theme: Theme;
}

export function ProgressSpinner({ title, message, subtitle, theme }: ProgressViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      <div
        style={{
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          fontWeight: theme.typography.weights.bold,
          fontSize: theme.typography.sizes.md,
          color: theme.colors.text,
        }}
      >
        {title}
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            border: `4px solid ${theme.colors.border}`,
            borderTopColor: theme.colors.primary,
            borderRadius: '50%',
            animation: 'keykey-spin 1s linear infinite',
          }}
        />
        <style>{`@keyframes keykey-spin { to { transform: rotate(360deg); } }`}</style>
        <div
          style={{
            fontSize: theme.typography.sizes.md,
            fontWeight: theme.typography.weights.semibold,
            color: theme.colors.text,
            textAlign: 'center',
          }}
        >
          {message}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: theme.typography.sizes.xs,
              color: theme.colors.textSecondary,
              textAlign: 'center',
              marginTop: theme.spacing.sm,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

interface ErrorViewProps {
  title: string;
  error: string;
  buttonLabel?: string;
  onDismiss: () => void;
  theme: Theme;
}

export function ErrorView({ title, error, buttonLabel, onDismiss, theme }: ErrorViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      <div
        style={{
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          fontWeight: theme.typography.weights.bold,
          fontSize: theme.typography.sizes.md,
          color: theme.colors.text,
        }}
      >
        {title}
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <div style={{ fontSize: 40 }}>&#9888;&#65039;</div>
        <div
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.text,
            textAlign: 'center',
          }}
        >
          {error}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            marginTop: theme.spacing.md,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            background: theme.colors.primary,
            color: '#000',
            border: 'none',
            borderRadius: theme.radii.md,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.semibold,
          }}
        >
          {buttonLabel ?? 'Dismiss'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/extension/src/popup/components/ProgressView.tsx
git commit -m "refactor(extension): extract shared ProgressSpinner and ErrorView components"
```

---

### Task 13: Extract useOperationProgress hook and Router

**Files:**

- Create: `apps/extension/src/popup/router/useOperationProgress.ts`
- Create: `apps/extension/src/popup/router/routes.ts`
- Create: `apps/extension/src/popup/router/Router.tsx`

- [ ] **Step 1: Create route constants**

```typescript
// apps/extension/src/popup/router/routes.ts
export const SYNC_OP_LABELS: Record<'replacing_remote' | 'replacing_local' | 'merging', string> = {
  replacing_remote: 'Replacing cloud vault with local',
  replacing_local: 'Replacing local vault with cloud',
  merging: 'Merging local and cloud vaults',
};
```

- [ ] **Step 2: Extract useOperationProgress hook**

Extract the two `useEffect` blocks (lines 62-217) and the operation state (`activeOperation`, `restoreError`, `syncOpKind`, `syncOpError`, `operationCheckDone`) from `Popup.tsx` into a dedicated hook.

```typescript
// apps/extension/src/popup/router/useOperationProgress.ts
import { useState, useEffect } from 'react';
import browser from 'webextension-polyfill';
import { sendMessage } from '../hooks/useMessage.js';

export type ActiveOperation =
  | 'import'
  | 'restore'
  | 'restore-error'
  | 'sync-op'
  | 'sync-op-error'
  | null;

export interface OperationProgress {
  operationCheckDone: boolean;
  activeOperation: ActiveOperation;
  restoreError: string | null;
  syncOpKind: 'replacing_remote' | 'replacing_local' | 'merging' | null;
  syncOpError: string | null;
  setScreen: (screen: string) => void;
  clearRestoreError: () => Promise<void>;
  clearSyncOpError: () => Promise<void>;
}

export function useOperationProgress(
  status: string,
  refresh: () => void,
  setScreen: (screen: string) => void,
): OperationProgress {
  const [operationCheckDone, setOperationCheckDone] = useState(false);
  const [activeOperation, setActiveOperation] = useState<ActiveOperation>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [syncOpKind, setSyncOpKind] = useState<
    'replacing_remote' | 'replacing_local' | 'merging' | null
  >(null);
  const [syncOpError, setSyncOpError] = useState<string | null>(null);

  // Check for in-flight operations on mount / status change
  useEffect(() => {
    let cancelled = false;
    setOperationCheckDone(false);
    (async () => {
      try {
        const stored = await browser.storage.local.get([
          'import_state',
          'restore_state',
          'sync_op_state',
          'sync_connect_state',
        ]);
        if (cancelled) return;

        const importPrev = stored.import_state as { status: string } | undefined;
        if (importPrev && (importPrev.status === 'importing' || importPrev.status === 'syncing')) {
          setScreen('import');
          setActiveOperation('import');
          return;
        }

        const restorePrev = stored.restore_state as { status: string; error?: string } | undefined;
        if (restorePrev) {
          if (restorePrev.status === 'restoring') {
            setActiveOperation('restore');
            return;
          }
          if (restorePrev.status === 'error') {
            setActiveOperation('restore-error');
            setRestoreError(restorePrev.error ?? 'Restore failed');
            return;
          }
        }

        const syncOpPrev = stored.sync_op_state as { status: string; error?: string } | undefined;
        if (syncOpPrev) {
          if (
            syncOpPrev.status === 'replacing_remote' ||
            syncOpPrev.status === 'replacing_local' ||
            syncOpPrev.status === 'merging'
          ) {
            setActiveOperation('sync-op');
            setSyncOpKind(syncOpPrev.status as 'replacing_remote' | 'replacing_local' | 'merging');
            return;
          }
          if (syncOpPrev.status === 'error') {
            setActiveOperation('sync-op-error');
            setSyncOpError(syncOpPrev.error ?? 'Sync operation failed');
            return;
          }
        }

        const syncConnectPrev = stored.sync_connect_state as
          | { status: string; provider?: string; error?: string }
          | undefined;
        if (syncConnectPrev && syncConnectPrev.status !== 'idle') {
          setScreen('sync-settings');
          if (syncConnectPrev.status === 'error') {
            sendMessage({ type: 'CLEAR_SYNC_CONNECT_STATUS' }).catch(() => {});
          }
        }

        setActiveOperation(null);
      } catch {
        if (!cancelled) setActiveOperation(null);
      } finally {
        if (!cancelled) setOperationCheckDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, setScreen]);

  // Listen for background state changes in real time
  useEffect(() => {
    const listener = (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;

      if (changes.restore_state) {
        const newState = changes.restore_state.newValue as
          | { status: string; error?: string }
          | undefined;
        if (!newState || newState.status === 'idle') {
          setActiveOperation((prev) =>
            prev === 'restore' || prev === 'restore-error' ? null : prev,
          );
          setRestoreError(null);
          refresh();
        } else if (newState.status === 'error') {
          setActiveOperation('restore-error');
          setRestoreError(newState.error ?? 'Restore failed');
        } else if (newState.status === 'restoring') {
          setActiveOperation('restore');
        }
      }

      if (changes.import_state) {
        const newState = changes.import_state.newValue as { status: string } | undefined;
        if (!newState || newState.status === 'idle' || newState.status === 'done') {
          setActiveOperation((prev) => (prev === 'import' ? null : prev));
        }
      }

      if (changes.sync_op_state) {
        const newState = changes.sync_op_state.newValue as
          | { status: string; error?: string }
          | undefined;
        if (!newState || newState.status === 'idle') {
          setActiveOperation((prev) =>
            prev === 'sync-op' || prev === 'sync-op-error' ? null : prev,
          );
          setSyncOpKind(null);
          setSyncOpError(null);
          setScreen('sync-settings');
        } else if (newState.status === 'error') {
          setActiveOperation('sync-op-error');
          setSyncOpError(newState.error ?? 'Sync operation failed');
        } else if (
          newState.status === 'replacing_remote' ||
          newState.status === 'replacing_local' ||
          newState.status === 'merging'
        ) {
          setActiveOperation('sync-op');
          setSyncOpKind(newState.status as 'replacing_remote' | 'replacing_local' | 'merging');
        }
      }

      if (changes.sync_connect_state) {
        const newState = changes.sync_connect_state.newValue as { status: string } | undefined;
        if (newState && newState.status !== 'idle') {
          setScreen('sync-settings');
        }
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [refresh, setScreen]);

  const clearRestoreError = async () => {
    try {
      await sendMessage({ type: 'CLEAR_RESTORE_STATUS' });
    } catch {
      /* ignore */
    }
    setActiveOperation(null);
    setRestoreError(null);
  };

  const clearSyncOpError = async () => {
    try {
      await sendMessage({ type: 'CLEAR_SYNC_OP_STATUS' });
    } catch {
      /* ignore */
    }
    setActiveOperation(null);
    setSyncOpKind(null);
    setSyncOpError(null);
    setScreen('sync-settings');
  };

  return {
    operationCheckDone,
    activeOperation,
    restoreError,
    syncOpKind,
    syncOpError,
    setScreen,
    clearRestoreError,
    clearSyncOpError,
  };
}
```

- [ ] **Step 3: Create Router.tsx**

Extract `renderMain()` and `renderUnlockedScreen()` from `Popup.tsx` into `Router.tsx`. The Router receives all needed props and handles screen dispatch.

- [ ] **Step 4: Slim down Popup.tsx**

Reduce `Popup.tsx` to ~80 lines: `useVaultStatus`, `useTheme`, screen state, items state, `useOperationProgress`, container style, delegate to `<Router />`.

- [ ] **Step 5: Run tests**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/popup/router/ apps/extension/src/popup/Popup.tsx apps/extension/src/popup/components/ProgressView.tsx
git commit -m "refactor(extension): extract popup router and useOperationProgress hook"
```

---

### Task 14: Extract shared form components

**Files:**

- Create: `apps/extension/src/popup/components/forms/CredentialForm.tsx`
- Create: `apps/extension/src/popup/components/forms/CardForm.tsx`
- Create: `apps/extension/src/popup/components/forms/NoteForm.tsx`

- [ ] **Step 1: Identify shared form patterns**

Read `AddItemScreen.tsx` and `EditItemScreen.tsx`. Both render the same field groups:

- Credential: name, url, username, password (with generate + visibility toggle)
- Card: name, cardholderName, cardNumber, expiryDate, cvv
- SecureNote: name, content

- [ ] **Step 2: Extract CredentialForm, CardForm, NoteForm**

Each form component receives `values`, `onChange`, `theme`, and optional `onGeneratePassword`. The parent screen handles submit logic and error display.

- [ ] **Step 3: Update AddItemScreen to use shared forms**

- [ ] **Step 4: Update EditItemScreen to use shared forms**

- [ ] **Step 5: Run tests**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/popup/components/forms/ apps/extension/src/popup/screens/AddItemScreen.tsx apps/extension/src/popup/screens/EditItemScreen.tsx
git commit -m "refactor(extension): extract shared form components for AddItem and EditItem"
```

---

### Task 15: Decompose SettingsScreen

**Files:**

- Create: `apps/extension/src/popup/screens/SettingsScreen/SettingsScreen.tsx`
- Create: `apps/extension/src/popup/screens/SettingsScreen/AutoLockSettings.tsx`
- Create: `apps/extension/src/popup/screens/SettingsScreen/PinSettings.tsx`
- Create: `apps/extension/src/popup/screens/SettingsScreen/DangerZone.tsx`
- Move old: `apps/extension/src/popup/screens/SettingsScreen.tsx` → directory

- [ ] **Step 1: Read current SettingsScreen.tsx and identify section boundaries**

- [ ] **Step 2: Create the directory and sub-components**

- [ ] **Step 3: Create orchestrator that composes sub-components**

- [ ] **Step 4: Update imports in Popup.tsx / Router.tsx**

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/popup/screens/SettingsScreen/
git commit -m "refactor(extension): decompose SettingsScreen into sub-components"
```

---

### Task 16: Decompose SyncSettingsScreen

**Files:**

- Create: `apps/extension/src/popup/screens/SyncSettingsScreen/SyncSettingsScreen.tsx`
- Create: `apps/extension/src/popup/screens/SyncSettingsScreen/ProviderSelector.tsx`
- Create: `apps/extension/src/popup/screens/SyncSettingsScreen/OAuthPanel.tsx`
- Create: `apps/extension/src/popup/screens/SyncSettingsScreen/MismatchResolver.tsx`

- [ ] **Step 1-5: Same pattern as Task 15**

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/popup/screens/SyncSettingsScreen/
git commit -m "refactor(extension): decompose SyncSettingsScreen into sub-components"
```

---

### Task 17: Decompose RestoreScreen

**Files:**

- Create: `apps/extension/src/popup/screens/RestoreScreen/RestoreScreen.tsx`
- Create: `apps/extension/src/popup/screens/RestoreScreen/ProviderStep.tsx`
- Create: `apps/extension/src/popup/screens/RestoreScreen/RestoreProgress.tsx`

- [ ] **Step 1-5: Same pattern as Task 15**

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/popup/screens/RestoreScreen/
git commit -m "refactor(extension): decompose RestoreScreen into sub-components"
```

---

### Task 18: Decompose ImportScreen

**Files:**

- Create: `apps/extension/src/popup/screens/ImportScreen/ImportScreen.tsx`
- Create: `apps/extension/src/popup/screens/ImportScreen/FileSelector.tsx`
- Create: `apps/extension/src/popup/screens/ImportScreen/FieldMapping.tsx`
- Create: `apps/extension/src/popup/screens/ImportScreen/ImportProgress.tsx`

- [ ] **Step 1-5: Same pattern as Task 15**

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/popup/screens/ImportScreen/
git commit -m "refactor(extension): decompose ImportScreen into sub-components"
```

---

### Task 19: Remove message-handler shim and update index.ts

**Files:**

- Modify: `apps/extension/src/background/index.ts` (use router + context directly)
- Delete: `apps/extension/src/background/message-handler.ts` (remove shim)

- [ ] **Step 1: Rewrite background/index.ts**

```typescript
// apps/extension/src/background/index.ts
import browser from 'webextension-polyfill';
import { createHandlerContext, tabAllowlists } from './context.js';
import { routeMessage } from './router.js';
import { updateBadge } from './badge.js';
import type { ContentPushMessage } from '../lib/messages.js';
import type { BackgroundMessage } from '../lib/messages.js';
import type { VaultItem } from '@keykeykey/core';

const ctx = createHandlerContext();
let initPromise: Promise<void> | null = ctx.init();

async function handleMessage(
  message: BackgroundMessage,
  sender?: browser.Runtime.MessageSender,
): Promise<unknown> {
  if (initPromise) {
    await initPromise;
    initPromise = null;
  }
  ctx.autoLock?.resetTimer();
  return routeMessage(message, ctx, sender);
}

// Push notifications to all content scripts
async function notifyContentScripts(message: ContentPushMessage): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) browser.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

// Message listener (popup + content scripts)
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message as BackgroundMessage;
  handleMessage(msg, sender)
    .then(async (result) => {
      if (msg.type === 'LOCK') {
        tabAllowlists.clear();
        notifyContentScripts({ type: 'VAULT_LOCKED' });
      }
      if (msg.type === 'UNLOCK' || msg.type === 'UNLOCK_PIN') {
        const r = result as Record<string, unknown>;
        if (!r.error) {
          notifyContentScripts({ type: 'VAULT_UNLOCKED' });
        }
      }
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
          if (msg.type !== 'IMPORT_ITEMS') {
            await handleMessage({ type: 'TRIGGER_SYNC' }).catch(() => {});
          }
        }
      }
      sendResponse(result);
    })
    .catch((err) => {
      sendResponse({ error: err instanceof Error ? err.message : 'Unknown error' });
    });
  return true;
});

// Badge
function extractHostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function refreshBadge(hostname: string | null, tabId: number): Promise<void> {
  const status = (await handleMessage({ type: 'GET_STATUS' })) as {
    status: string;
    itemCount: number;
  };
  if (status.status === 'unlocked') {
    const result = (await handleMessage({ type: 'GET_ITEMS' })) as {
      items?: VaultItem[];
    };
    await updateBadge(hostname, 'unlocked', result.items ?? [], tabId);
  } else {
    await updateBadge(hostname, status.status, [], tabId);
  }
}

browser.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await browser.tabs.get(activeInfo.tabId);
  const hostname = extractHostname(tab.url);
  await refreshBadge(hostname, activeInfo.tabId);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    tabAllowlists.delete(tabId);
  }
  if (changeInfo.url || changeInfo.status === 'complete') {
    const hostname = extractHostname(changeInfo.url ?? tab.url);
    await refreshBadge(hostname, tabId);
  }
});
```

- [ ] **Step 2: Delete message-handler.ts shim**

```bash
rm apps/extension/src/background/message-handler.ts
```

- [ ] **Step 3: Update message-handler.test.ts to import from context + router**

Update the test file's import to use `createHandlerContext` + `routeMessage` instead of `createMessageHandler`. The test helper `send()` now creates a context, inits it, and calls `routeMessage`.

- [ ] **Step 4: Run all tests**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run`
Expected: All tests PASS

- [ ] **Step 5: Build both targets**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/background/
git commit -m "refactor(extension): remove message-handler shim, index.ts uses router directly"
```

---

### Task 20: Move test files and update imports

**Files:**

- Move/update test files to colocate with new handler structure

- [ ] **Step 1: Verify all test files have correct import paths**

Run: `cd /Users/davidneto/keykeykey && grep -r "from.*message-handler" apps/extension/src/`

Fix any remaining references to the deleted `message-handler.ts`.

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/
git commit -m "refactor(extension): update test imports for decomposed handler structure"
```

---

### Task 21: Final formatting and verification

- [ ] **Step 1: Run Prettier**

Run: `cd /Users/davidneto/keykeykey && pnpm format`

- [ ] **Step 2: Run lint**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension lint`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run`
Expected: All tests PASS

- [ ] **Step 4: Build both targets**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension build`
Expected: Both Chrome and Firefox builds succeed

- [ ] **Step 5: Run critical E2E tests**

Run: `cd /Users/davidneto/keykeykey/e2e && npx playwright test --grep @critical`
Expected: All critical tests pass

- [ ] **Step 6: Commit if formatting changed anything**

```bash
git add -A apps/extension/
git commit -m "style(extension): fix formatting after decomposition"
```
