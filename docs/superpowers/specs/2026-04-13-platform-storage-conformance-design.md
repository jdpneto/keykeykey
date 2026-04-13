# Platform Storage Conformance Test Suite

**Date:** 2026-04-13
**Status:** Approved
**Scope:** Extract `PlatformStorage` interface to its own file; build a shared conformance test suite in core; wire it into all three app test suites.

## Context

The `PlatformStorage` interface is defined inline in `packages/core/src/sync/lifecycle/sync-lifecycle.ts` (lines 31-48). Three platform adapters implement it:

- **Extension:** `createExtensionPlatformStorage()` in `apps/extension/src/background/storage.ts`
- **Desktop:** `createDesktopPlatformStorage()` in `apps/desktop/src/lib/sync.ts` (wraps Tauri commands)
- **Mobile:** `createMobilePlatformStorage()` in `apps/mobile/lib/sync.ts` (wraps expo-secure-store/sqlite/filesystem)

Each adapter has its own tests, but there is no shared suite that verifies all three conform to the same behavioral contract. A conformance test factory in core fixes this.

## Design

### 1. Interface extraction

**New file:** `packages/core/src/sync/lifecycle/platform-storage.ts`

Contains:
- `PlatformStorage` interface (moved from `sync-lifecycle.ts`)
- `StoredItem` type: `{ id: string; encrypted_data: string }`

**Re-export:** `sync-lifecycle.ts` re-exports both from the new file so all existing imports (`import { PlatformStorage } from ...sync-lifecycle`) continue to work with zero changes.

### 2. Conformance test suite

**New file:** `packages/core/src/sync/lifecycle/platform-storage.conformance.ts`

Exports a single function:

```ts
export function describePlatformStorageConformance(
  name: string,
  factory: () => PlatformStorage | Promise<PlatformStorage>,
  cleanup?: () => Promise<void>,
): void
```

Uses `describe/it/expect` globals (compatible with both Vitest and Jest).

**Test cases:**

#### Vault header
- Returns `null` when no header saved
- Round-trips a base64 string through `saveVaultHeader` → `loadVaultHeader`
- Overwrites previous header on second save

#### Encrypted items
- `loadAllEncryptedItems` returns empty array initially
- Saves an item and retrieves it with matching `id` and `encrypted_data`
- Saves multiple items, all returned
- Overwrites item with same `id` (upsert semantics)
- `deleteAllItems` clears everything

#### Sync config file
- Returns `null` when no config saved
- Round-trips `Uint8Array` through `saveSyncConfigFile` → `loadSyncConfigFile`
- `deleteSyncConfigFile` makes subsequent load return `null`

#### Lifecycle flags
- `setVaultSetupComplete(true)` does not throw
- `setVaultSetupComplete(false)` does not throw

#### Optional methods
- If `setSyncUrlPrefix` is defined, calling with a string and with `null` does not throw

Each test is independent. `beforeEach` creates a fresh storage via the factory. `afterEach` calls cleanup if provided. The `.conformance.ts` extension keeps it out of core's default test glob (`**/*.test.ts`).

### 3. Export path

**New entry point** in `packages/core/package.json` exports map:

```json
"./testing": {
  "import": "./src/sync/lifecycle/platform-storage.conformance.ts",
  "types": "./src/sync/lifecycle/platform-storage.conformance.ts"
}
```

Apps import as `@keykeykey/core/testing`.

### 4. App-side wiring

Each app adds one test file (~15-20 lines) that imports the conformance suite and provides their adapter factory with mocked backends.

**Extension** — `apps/extension/src/background/storage.conformance.test.ts`
- Factory: `createExtensionPlatformStorage()` with `browser.storage.local` mocked
- Cleanup: clears mock store

**Desktop** — `apps/desktop/src/__tests__/platform-storage.conformance.test.ts`
- Factory: `createDesktopPlatformStorage()` with `@tauri-apps/api/core` `invoke` mocked
- Cleanup: clears mock state

**Mobile** — `apps/mobile/__tests__/platform-storage.conformance.test.ts`
- Factory: `createMobilePlatformStorage()` with `expo-secure-store`, `expo-sqlite`, and `expo-file-system` mocked
- Cleanup: clears mock state

**Core** — `packages/core/src/sync/lifecycle/platform-storage.conformance.test.ts`
- Defines a trivial `InMemoryPlatformStorage` (not exported) to validate the conformance suite itself
- Prevents the test suite from bitrotting if an app temporarily stops running it

### 5. Out of scope

- No expanding the `PlatformStorage` interface (PIN, biometrics, settings stay platform-specific)
- No `InMemoryPlatformStorage` exported from core (test-internal only)
- No getter for `isVaultSetupComplete` added to the interface
- No changes to app runtime code (only interface extraction with re-export and new test files)
- No new `@keykeykey/core/storage` entry point
