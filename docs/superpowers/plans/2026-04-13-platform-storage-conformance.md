# Platform Storage Conformance Test Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the `PlatformStorage` interface to its own file and build a shared conformance test factory that all three platform adapters run against their implementations.

**Architecture:** The interface moves from `sync-lifecycle.ts` to `platform-storage.ts` in the same directory with a re-export for backward compat. A `describePlatformStorageConformance()` factory using `describe/it/expect` globals is exported via a new `@keykeykey/core/testing` entry point. Each app wires up one test file that passes their adapter factory.

**Tech Stack:** TypeScript, Vitest (core/desktop/extension), Jest (mobile), tsup

---

## File Map

| Action | File                                                                    | Responsibility                                  |
| ------ | ----------------------------------------------------------------------- | ----------------------------------------------- |
| Create | `packages/core/src/sync/lifecycle/platform-storage.ts`                  | `PlatformStorage` interface + `StoredItem` type |
| Modify | `packages/core/src/sync/lifecycle/sync-lifecycle.ts:27-48`              | Remove interface, re-export from new file       |
| Modify | `packages/core/src/sync/index.ts:86-88`                                 | Re-export `PlatformStorage` from new location   |
| Create | `packages/core/src/sync/lifecycle/platform-storage.conformance.ts`      | Conformance test factory                        |
| Create | `packages/core/src/testing/index.ts`                                    | Barrel export for `@keykeykey/core/testing`     |
| Modify | `packages/core/package.json:8-64`                                       | Add `./testing` entry point                     |
| Modify | `packages/core/tsup.config.ts:4-18`                                     | Add `src/testing/index.ts` entry                |
| Create | `packages/core/src/sync/lifecycle/platform-storage.conformance.test.ts` | In-memory impl to validate the suite            |
| Create | `apps/extension/src/background/storage.conformance.test.ts`             | Extension conformance wiring                    |
| Create | `apps/desktop/src/__tests__/platform-storage.conformance.test.ts`       | Desktop conformance wiring                      |
| Create | `apps/mobile/__tests__/platform-storage.conformance.test.ts`            | Mobile conformance wiring                       |

---

### Task 1: Extract PlatformStorage interface

**Files:**

- Create: `packages/core/src/sync/lifecycle/platform-storage.ts`
- Modify: `packages/core/src/sync/lifecycle/sync-lifecycle.ts:27-48`
- Modify: `packages/core/src/sync/index.ts:84-89`

- [ ] **Step 1: Create the interface file**

Create `packages/core/src/sync/lifecycle/platform-storage.ts`:

```ts
// ---------------------------------------------------------------------------
// Platform Storage Interface
// ---------------------------------------------------------------------------

/**
 * The shape returned by loadAllEncryptedItems().
 */
export interface StoredItem {
  id: string;
  encrypted_data: string;
}

/**
 * Platform-agnostic storage contract used by SyncLifecycle.
 * Each platform (extension, desktop, mobile) provides its own implementation.
 */
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
  loadAllEncryptedItems(): Promise<StoredItem[]>;
  deleteAllItems(): Promise<void>;
  saveVaultHeader(headerBase64: string): Promise<void>;
  loadVaultHeader(): Promise<string | null>;
  setVaultSetupComplete(complete: boolean): Promise<void>;
  setSyncUrlPrefix?(prefix: string | null): Promise<void>;
}
```

- [ ] **Step 2: Update sync-lifecycle.ts to re-export**

In `packages/core/src/sync/lifecycle/sync-lifecycle.ts`, replace lines 27-48:

```ts
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
```

With:

```ts
// ---------------------------------------------------------------------------
// Platform Storage Interface (re-exported for backward compatibility)
// ---------------------------------------------------------------------------

export type { PlatformStorage, StoredItem } from './platform-storage.js';
```

Update the `SyncLifecycle` class body if it references `Array<{ id: string; encrypted_data: string }>` — it should now use the `StoredItem` type. However, the class already receives `PlatformStorage` by type, so no change is needed inside the class.

- [ ] **Step 3: Update sync/index.ts re-exports**

In `packages/core/src/sync/index.ts`, replace lines 84-89:

```ts
// Lifecycle
export { SyncLifecycle } from './lifecycle/sync-lifecycle.js';
export type {
  PlatformStorage,
  SyncLifecycleCallbacks,
  SubscribableSyncStore,
} from './lifecycle/sync-lifecycle.js';
```

With:

```ts
// Lifecycle
export { SyncLifecycle } from './lifecycle/sync-lifecycle.js';
export type { PlatformStorage, StoredItem } from './lifecycle/platform-storage.js';
export type { SyncLifecycleCallbacks, SubscribableSyncStore } from './lifecycle/sync-lifecycle.js';
```

- [ ] **Step 4: Build core and run existing tests**

Run:

```bash
pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/core test
```

Expected: Build succeeds, all existing tests pass. The re-exports keep all downstream imports working.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync/lifecycle/platform-storage.ts packages/core/src/sync/lifecycle/sync-lifecycle.ts packages/core/src/sync/index.ts
git commit -m "refactor(core): extract PlatformStorage interface to own file"
```

---

### Task 2: Create the conformance test factory

**Files:**

- Create: `packages/core/src/sync/lifecycle/platform-storage.conformance.ts`

- [ ] **Step 1: Create the conformance factory**

Create `packages/core/src/sync/lifecycle/platform-storage.conformance.ts`:

```ts
import type { PlatformStorage } from './platform-storage.js';

/**
 * Shared conformance test suite for PlatformStorage implementations.
 *
 * Uses describe/it/expect globals — compatible with both Vitest and Jest.
 * Each app calls this with a factory that creates their adapter (with mocked
 * backends) and an optional cleanup function.
 *
 * The `.conformance.ts` extension keeps this out of core's test glob
 * (`*.{test,spec}.ts`).
 */
export function describePlatformStorageConformance(
  name: string,
  factory: () => PlatformStorage | Promise<PlatformStorage>,
  cleanup?: () => void | Promise<void>,
): void {
  describe(`PlatformStorage conformance: ${name}`, () => {
    let storage: PlatformStorage;

    beforeEach(async () => {
      storage = await factory();
    });

    afterEach(async () => {
      await cleanup?.();
    });

    // ----- Vault Header -----

    describe('vault header', () => {
      it('returns null when no header saved', async () => {
        const result = await storage.loadVaultHeader();
        expect(result).toBeNull();
      });

      it('round-trips a base64 string', async () => {
        await storage.saveVaultHeader('dmF1bHRfaGVhZGVyX2RhdGE=');
        const result = await storage.loadVaultHeader();
        expect(result).toBe('dmF1bHRfaGVhZGVyX2RhdGE=');
      });

      it('overwrites on second save', async () => {
        await storage.saveVaultHeader('first');
        await storage.saveVaultHeader('second');
        const result = await storage.loadVaultHeader();
        expect(result).toBe('second');
      });
    });

    // ----- Encrypted Items -----

    describe('encrypted items', () => {
      it('returns empty array initially', async () => {
        const items = await storage.loadAllEncryptedItems();
        expect(items).toEqual([]);
      });

      it('saves and retrieves a single item', async () => {
        await storage.saveEncryptedItem(
          'item-1',
          'credential',
          'ZW5jcnlwdGVkX2RhdGE=',
          '2026-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
        );
        const items = await storage.loadAllEncryptedItems();
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe('item-1');
        expect(items[0].encrypted_data).toBe('ZW5jcnlwdGVkX2RhdGE=');
      });

      it('saves multiple items', async () => {
        await storage.saveEncryptedItem(
          'item-1',
          'credential',
          'data1',
          '2026-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
        );
        await storage.saveEncryptedItem(
          'item-2',
          'card',
          'data2',
          '2026-01-02T00:00:00Z',
          '2026-01-02T00:00:00Z',
        );
        const items = await storage.loadAllEncryptedItems();
        expect(items).toHaveLength(2);
        const ids = items.map((i) => i.id).sort();
        expect(ids).toEqual(['item-1', 'item-2']);
      });

      it('upserts item with same id', async () => {
        await storage.saveEncryptedItem(
          'item-1',
          'credential',
          'original',
          '2026-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
        );
        await storage.saveEncryptedItem(
          'item-1',
          'credential',
          'updated',
          '2026-01-01T00:00:00Z',
          '2026-01-02T00:00:00Z',
        );
        const items = await storage.loadAllEncryptedItems();
        expect(items).toHaveLength(1);
        expect(items[0].encrypted_data).toBe('updated');
      });

      it('deleteAllItems clears everything', async () => {
        await storage.saveEncryptedItem(
          'item-1',
          'credential',
          'data1',
          '2026-01-01T00:00:00Z',
          '2026-01-01T00:00:00Z',
        );
        await storage.saveEncryptedItem(
          'item-2',
          'card',
          'data2',
          '2026-01-02T00:00:00Z',
          '2026-01-02T00:00:00Z',
        );
        await storage.deleteAllItems();
        const items = await storage.loadAllEncryptedItems();
        expect(items).toEqual([]);
      });
    });

    // ----- Sync Config File -----

    describe('sync config file', () => {
      it('returns null when no config saved', async () => {
        const result = await storage.loadSyncConfigFile();
        expect(result).toBeNull();
      });

      it('round-trips Uint8Array data', async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5, 10, 20, 255]);
        await storage.saveSyncConfigFile(data);
        const result = await storage.loadSyncConfigFile();
        expect(result).toBeInstanceOf(Uint8Array);
        expect(Array.from(result!)).toEqual([1, 2, 3, 4, 5, 10, 20, 255]);
      });

      it('delete makes subsequent load return null', async () => {
        const data = new Uint8Array([99, 100]);
        await storage.saveSyncConfigFile(data);
        await storage.deleteSyncConfigFile();
        const result = await storage.loadSyncConfigFile();
        expect(result).toBeNull();
      });
    });

    // ----- Lifecycle Flags -----

    describe('lifecycle flags', () => {
      it('setVaultSetupComplete(true) does not throw', async () => {
        await expect(storage.setVaultSetupComplete(true)).resolves.not.toThrow();
      });

      it('setVaultSetupComplete(false) does not throw', async () => {
        await expect(storage.setVaultSetupComplete(false)).resolves.not.toThrow();
      });
    });

    // ----- Optional Methods -----

    describe('optional methods', () => {
      it('setSyncUrlPrefix with string does not throw (if defined)', async () => {
        if (!storage.setSyncUrlPrefix) return;
        await expect(storage.setSyncUrlPrefix('https://example.com')).resolves.not.toThrow();
      });

      it('setSyncUrlPrefix with null does not throw (if defined)', async () => {
        if (!storage.setSyncUrlPrefix) return;
        await expect(storage.setSyncUrlPrefix(null)).resolves.not.toThrow();
      });
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/sync/lifecycle/platform-storage.conformance.ts
git commit -m "feat(core): add PlatformStorage conformance test factory"
```

---

### Task 3: Add the `@keykeykey/core/testing` entry point

**Files:**

- Create: `packages/core/src/testing/index.ts`
- Modify: `packages/core/package.json:8-64`
- Modify: `packages/core/tsup.config.ts:4-18`

- [ ] **Step 1: Create the barrel export**

Create `packages/core/src/testing/index.ts`:

```ts
/**
 * Test utilities for @keykeykey/core.
 *
 * Import as: @keykeykey/core/testing
 *
 * Not included in the main bundle — only used in test files.
 */
export { describePlatformStorageConformance } from '../sync/lifecycle/platform-storage.conformance.js';
export type { PlatformStorage, StoredItem } from '../sync/lifecycle/platform-storage.js';
```

- [ ] **Step 2: Add entry point to package.json**

In `packages/core/package.json`, add after the `"./export-import-zip"` entry (after line 63):

```json
    "./testing": {
      "import": "./dist/testing/index.js",
      "types": "./dist/testing/index.d.ts"
    }
```

- [ ] **Step 3: Add entry to tsup config**

In `packages/core/tsup.config.ts`, add `'src/testing/index.ts'` to the `entry` array (after line 18):

```ts
    'src/testing/index.ts',
```

- [ ] **Step 4: Add module name mapper for mobile**

Mobile's Jest config maps `@keykeykey/core/(.*)` → `packages/core/src/$1`. The path `@keykeykey/core/testing` will resolve to `packages/core/src/testing` which is a directory — Jest needs `packages/core/src/testing/index.ts`. The existing mapper `"^@keykeykey/core/(.*)$": "<rootDir>/../../packages/core/src/$1"` works because Jest resolves `index.ts` from directories automatically. No change needed.

- [ ] **Step 5: Build and verify**

Run:

```bash
pnpm --filter @keykeykey/core build
```

Expected: Build succeeds. `dist/testing/index.js` and `dist/testing/index.d.ts` are generated.

```bash
ls packages/core/dist/testing/
```

Expected: `index.js`, `index.d.ts` present.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/testing/index.ts packages/core/package.json packages/core/tsup.config.ts
git commit -m "feat(core): add @keykeykey/core/testing entry point"
```

---

### Task 4: Validate the conformance suite with an in-memory implementation

**Files:**

- Create: `packages/core/src/sync/lifecycle/platform-storage.conformance.test.ts`

- [ ] **Step 1: Write the in-memory test**

Create `packages/core/src/sync/lifecycle/platform-storage.conformance.test.ts`:

```ts
import { describePlatformStorageConformance } from './platform-storage.conformance.js';
import type { PlatformStorage, StoredItem } from './platform-storage.js';

/**
 * Trivial in-memory PlatformStorage to validate the conformance suite itself.
 * Not exported — exists only so the suite doesn't bitrot.
 */
function createInMemoryStorage(): PlatformStorage {
  let header: string | null = null;
  let syncConfig: Uint8Array | null = null;
  let setupComplete = false;
  let syncUrlPrefix: string | null = null;
  const items = new Map<
    string,
    StoredItem & { type: string; created_at: string; updated_at: string }
  >();

  return {
    async loadSyncConfigFile() {
      return syncConfig ? new Uint8Array(syncConfig) : null;
    },
    async saveSyncConfigFile(data) {
      syncConfig = new Uint8Array(data);
    },
    async deleteSyncConfigFile() {
      syncConfig = null;
    },
    async saveEncryptedItem(id, type, encryptedBase64, createdAt, updatedAt) {
      items.set(id, {
        id,
        type,
        encrypted_data: encryptedBase64,
        created_at: createdAt,
        updated_at: updatedAt,
      });
    },
    async loadAllEncryptedItems() {
      return [...items.values()].map(({ id, encrypted_data }) => ({ id, encrypted_data }));
    },
    async deleteAllItems() {
      items.clear();
    },
    async saveVaultHeader(headerBase64) {
      header = headerBase64;
    },
    async loadVaultHeader() {
      return header;
    },
    async setVaultSetupComplete(complete) {
      setupComplete = complete;
    },
    async setSyncUrlPrefix(prefix) {
      syncUrlPrefix = prefix;
    },
  };
}

describePlatformStorageConformance('InMemory', () => createInMemoryStorage());
```

- [ ] **Step 2: Run the test**

Run:

```bash
pnpm --filter @keykeykey/core test -- --testPathPattern platform-storage.conformance
```

Expected: All conformance tests pass (vault header: 3, encrypted items: 5, sync config: 3, lifecycle flags: 2, optional methods: 2 = 15 total).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/sync/lifecycle/platform-storage.conformance.test.ts
git commit -m "test(core): validate conformance suite with in-memory implementation"
```

---

### Task 5: Wire up extension conformance tests

**Files:**

- Create: `apps/extension/src/background/storage.conformance.test.ts`

- [ ] **Step 1: Write the conformance test**

Create `apps/extension/src/background/storage.conformance.test.ts`:

```ts
import { vi } from 'vitest';
import { createBrowserMock } from '../lib/browser-mock.js';
import { describePlatformStorageConformance } from '@keykeykey/core/testing';

const browserMock = createBrowserMock();
vi.mock('webextension-polyfill', () => ({ default: browserMock }));

const { createExtensionPlatformStorage } = await import('./storage.js');

describePlatformStorageConformance(
  'Extension',
  () => createExtensionPlatformStorage(),
  () => browserMock._reset(),
);
```

- [ ] **Step 2: Build core then run the test**

Run:

```bash
pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/extension test -- --testPathPattern storage.conformance
```

Expected: All 15 conformance tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/background/storage.conformance.test.ts
git commit -m "test(extension): wire up PlatformStorage conformance suite"
```

---

### Task 6: Wire up desktop conformance tests

**Files:**

- Create: `apps/desktop/src/__tests__/platform-storage.conformance.test.ts`

- [ ] **Step 1: Write the conformance test**

The desktop adapter calls `invoke()` for sync config and vault header, and delegates to `tauri-storage.ts` functions for items. The test-setup.ts already mocks `@tauri-apps/api/core` with `vi.fn()`. We need to set up `mockInvoke` to simulate stateful storage.

Create `apps/desktop/src/__tests__/platform-storage.conformance.test.ts`:

```ts
import { vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { describePlatformStorageConformance } from '@keykeykey/core/testing';
import { createDesktopPlatformStorage } from '../lib/sync';

const mockInvoke = vi.mocked(invoke);

// Stateful mock that simulates the Tauri storage backend
let vaultHeader: string | null = null;
let syncConfig: string | null = null; // base64-encoded
let setupComplete = false;
let syncUrlPrefix: string | null = null;
const items: Array<{
  id: string;
  type: string;
  encrypted_data: string;
  created_at: string;
  updated_at: string;
}> = [];

function resetMockState() {
  vaultHeader = null;
  syncConfig = null;
  setupComplete = false;
  syncUrlPrefix = null;
  items.length = 0;
  mockInvoke.mockReset();
  installMockHandlers();
}

function installMockHandlers() {
  mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case 'save_vault_header':
        vaultHeader = args!.data as string;
        return undefined;
      case 'load_vault_header':
        return vaultHeader;
      case 'save_encrypted_item': {
        const idx = items.findIndex((i) => i.id === (args!.id as string));
        const row = {
          id: args!.id as string,
          type: args!.itemType as string,
          encrypted_data: args!.dataB64 as string,
          created_at: args!.createdAt as string,
          updated_at: args!.updatedAt as string,
        };
        if (idx >= 0) items[idx] = row;
        else items.push(row);
        return undefined;
      }
      case 'load_all_encrypted_items':
        return [...items];
      case 'delete_encrypted_item': {
        const delIdx = items.findIndex((i) => i.id === (args!.id as string));
        if (delIdx >= 0) items.splice(delIdx, 1);
        return undefined;
      }
      case 'save_sync_config': {
        syncConfig = args!.dataB64 as string;
        return undefined;
      }
      case 'load_sync_config':
        return syncConfig;
      case 'delete_sync_config':
        syncConfig = null;
        return undefined;
      case 'set_vault_setup_complete':
        setupComplete = args!.complete as boolean;
        return undefined;
      case 'is_vault_setup_complete':
        return setupComplete;
      case 'set_sync_url_prefix':
        syncUrlPrefix = args!.prefix as string | null;
        return undefined;
      default:
        throw new Error(`Unexpected invoke command: ${cmd}`);
    }
  });
}

describePlatformStorageConformance('Desktop', () => {
  resetMockState();
  return createDesktopPlatformStorage();
});
```

- [ ] **Step 2: Build core then run the test**

Run:

```bash
pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/desktop test -- --testPathPattern platform-storage.conformance
```

Expected: All 15 conformance tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/__tests__/platform-storage.conformance.test.ts
git commit -m "test(desktop): wire up PlatformStorage conformance suite"
```

---

### Task 7: Wire up mobile conformance tests

**Files:**

- Create: `apps/mobile/__tests__/platform-storage.conformance.test.ts`

- [ ] **Step 1: Write the conformance test**

Mobile uses Jest. The `createMobilePlatformStorage()` calls `expo-file-system` for sync config, and delegates to `./storage` for items/header/setup. We need to mock all three: `expo-file-system`, `expo-secure-store`, and `expo-sqlite`.

Create `apps/mobile/__tests__/platform-storage.conformance.test.ts`:

```ts
import { describePlatformStorageConformance } from '@keykeykey/core/testing';

// --- Mock state ---
let fileStore: Record<string, string> = {};
let fileExists: Record<string, boolean> = {};
const secureStore: Record<string, string> = {};
const sqliteRows: Array<{
  id: string;
  type: string;
  encrypted_data: string;
  created_at: string;
  updated_at: string;
}> = [];

// --- expo-file-system mock ---
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: fileExists[path] ?? false,
  })),
  readAsStringAsync: jest.fn(async (path: string) => fileStore[path] ?? ''),
  writeAsStringAsync: jest.fn(async (path: string, content: string) => {
    fileStore[path] = content;
    fileExists[path] = true;
  }),
  deleteAsync: jest.fn(async (path: string) => {
    delete fileStore[path];
    delete fileExists[path];
  }),
}));

// --- expo-secure-store mock ---
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    secureStore[key] = value;
  }),
  getItemAsync: jest.fn(async (key: string) => secureStore[key] ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete secureStore[key];
  }),
}));

// --- expo-sqlite mock ---
const mockRunAsync = jest.fn(async (sql: string, params?: any[]) => {
  if (sql.includes('INSERT OR REPLACE')) {
    const [id, type, encrypted_data, created_at, updated_at] = params!;
    const idx = sqliteRows.findIndex((r) => r.id === id);
    const row = { id, type, encrypted_data, created_at, updated_at };
    if (idx >= 0) sqliteRows[idx] = row;
    else sqliteRows.push(row);
  } else if (sql.includes('DELETE') && params?.length) {
    const idx = sqliteRows.findIndex((r) => r.id === params[0]);
    if (idx >= 0) sqliteRows.splice(idx, 1);
  } else if (sql === 'DELETE FROM vault_items') {
    sqliteRows.length = 0;
  }
});
const mockGetAllAsync = jest.fn(async () => [...sqliteRows]);
const mockExecAsync = jest.fn(async () => {});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: mockExecAsync,
    runAsync: mockRunAsync,
    getAllAsync: mockGetAllAsync,
  })),
}));

// --- App Group path mock (mobile storage.ts tries to require it) ---
jest.mock('../modules/app-group-path', () => ({
  getAppGroupContainerPath: () => null,
}));

const { createMobilePlatformStorage } = require('../lib/sync');

function resetMockState() {
  fileStore = {};
  fileExists = {};
  Object.keys(secureStore).forEach((k) => delete secureStore[k]);
  sqliteRows.length = 0;
}

describePlatformStorageConformance('Mobile', () => {
  resetMockState();
  return createMobilePlatformStorage();
});
```

- [ ] **Step 2: Build core then run the test**

Run:

```bash
pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/mobile test -- --testPathPattern platform-storage.conformance
```

Expected: All 15 conformance tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/__tests__/platform-storage.conformance.test.ts
git commit -m "test(mobile): wire up PlatformStorage conformance suite"
```

---

### Task 8: Run full test suite and rebuild

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

Run:

```bash
pnpm build
```

Expected: Clean build across all packages.

- [ ] **Step 2: Run all tests**

Run:

```bash
pnpm test
```

Expected: All tests pass across all packages, including the new conformance tests.

- [ ] **Step 3: Run critical E2E tests**

Run:

```bash
cd e2e && npx playwright test --grep @critical
```

Expected: Critical E2E tests pass (no runtime behavior changed).

- [ ] **Step 4: Final commit (if any formatting fixes needed)**

If the lint/format steps flag issues:

```bash
pnpm format
git add -u
git commit -m "style: fix formatting in conformance test files"
```
