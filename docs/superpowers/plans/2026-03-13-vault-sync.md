# Vault Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bidirectional vault sync across devices via Google Drive, iCloud, and WebDAV cloud adapters with tombstone-based deletion tracking and LWW conflict resolution.

**Architecture:** A `SyncEngine` class in `packages/core/sync/` orchestrates pull→merge→push cycles using the existing `ISyncAdapter` interface. The `mergeManifests()` function is extended with tombstone awareness. Three cloud adapters implement `ISyncAdapter`. The vault store is connected to the engine via Zustand subscription with a sync-loop guard.

**Tech Stack:** TypeScript, Zustand, Vitest, `@noble/hashes` (SHA-256 for item hashing), existing `@keykeykey/core` crypto primitives.

**Spec:** `docs/superpowers/specs/2026-03-13-vault-sync-design.md`

**Out of scope (deferred to follow-up plan):**

- `SyncConfig` model and platform-specific persistence (spec Section 5)
- First-launch "Restore from Cloud" flow and onboarding UI (spec Section 5)
- On-unlock and on-foreground sync triggers (spec Section 4 — requires app-layer integration)
- These are app-layer concerns that depend on this core sync infrastructure being in place first.

**Note on mergeManifests:** The spec says "extended, not replaced." This plan creates a new `mergeManifestsV2` function and deprecates the old one — this is cleaner for backward compatibility and avoids breaking existing callers.

---

## File Structure

### New files

| File                                                  | Responsibility                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/core/src/sync/tombstone.ts`                 | `TombstoneEntry` type, `garbageCollectTombstones()` helper                 |
| `packages/core/src/sync/tombstone.test.ts`            | Tests for tombstone GC                                                     |
| `packages/core/src/sync/merge.ts`                     | New tombstone-aware `mergeManifestsV2()`, replaces old `mergeManifests()`  |
| `packages/core/src/sync/merge.test.ts`                | Tests for all merge cases (item+item, item+tombstone, tombstone+tombstone) |
| `packages/core/src/sync/sync-engine.ts`               | `SyncEngine` class: sync cycle, debounce, mutex, backoff                   |
| `packages/core/src/sync/sync-engine.test.ts`          | Unit tests for sync engine                                                 |
| `packages/core/src/sync/errors.ts`                    | `SyncAuthError`, `SyncAdapterUnsupportedError` error classes               |
| `packages/core/src/sync/webdav-adapter.ts`            | WebDAV `ISyncAdapter` implementation                                       |
| `packages/core/src/sync/webdav-adapter.test.ts`       | WebDAV adapter integration tests                                           |
| `packages/core/src/sync/google-drive-adapter.ts`      | Google Drive `ISyncAdapter` implementation                                 |
| `packages/core/src/sync/google-drive-adapter.test.ts` | Google Drive adapter tests (MSW mocked)                                    |
| `packages/core/src/sync/icloud-adapter.ts`            | iCloud `ISyncAdapter` implementation                                       |
| `packages/core/src/sync/icloud-adapter.test.ts`       | iCloud adapter tests (filesystem mocked)                                   |
| `packages/core/src/sync/connect.ts`                   | `connectSyncEngine()` store wiring function                                |
| `packages/core/src/sync/connect.test.ts`              | Tests for store↔engine wiring                                              |

### Modified files

| File                                  | Changes                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/core/src/sync/types.ts`     | Add `TombstoneEntry` to `SyncManifest`, bump version, deprecate old `mergeManifests()` |
| `packages/core/src/sync/index.ts`     | Re-export new modules                                                                  |
| `packages/core/src/sync/sync.test.ts` | Update existing tests for manifest v2 schema                                           |

---

## Chunk 1: Tombstone Types & Manifest V2

### Task 1: Add tombstone types and update SyncManifest

**Files:**

- Modify: `packages/core/src/sync/types.ts`
- Create: `packages/core/src/sync/tombstone.ts`
- Create: `packages/core/src/sync/tombstone.test.ts`
- Create: `packages/core/src/sync/errors.ts`

- [ ] **Step 1: Write failing test for tombstone GC**

Create `packages/core/src/sync/tombstone.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { garbageCollectTombstones } from './tombstone.js';
import type { TombstoneEntry } from './types.js';

describe('garbageCollectTombstones', () => {
  it('should remove tombstones older than maxAgeDays', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(); // 31 days ago
    const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago

    const tombstones: Record<string, TombstoneEntry> = {
      'old-item': { deletedAt: old },
      'recent-item': { deletedAt: recent },
    };

    const result = garbageCollectTombstones(tombstones, 30);
    expect(result).not.toHaveProperty('old-item');
    expect(result).toHaveProperty('recent-item');
  });

  it('should keep all tombstones when none are expired', () => {
    const recent = new Date().toISOString();
    const tombstones: Record<string, TombstoneEntry> = {
      a: { deletedAt: recent },
      b: { deletedAt: recent },
    };

    const result = garbageCollectTombstones(tombstones, 30);
    expect(Object.keys(result)).toHaveLength(2);
  });

  it('should return empty object when all tombstones are expired', () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
    const tombstones: Record<string, TombstoneEntry> = {
      a: { deletedAt: old },
      b: { deletedAt: old },
    };

    const result = garbageCollectTombstones(tombstones, 30);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should return empty object for empty input', () => {
    const result = garbageCollectTombstones({}, 30);
    expect(result).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/tombstone.test.ts`
Expected: FAIL — `TombstoneEntry` type and `garbageCollectTombstones` not found.

- [ ] **Step 3: Add TombstoneEntry to SyncManifest and update types**

Modify `packages/core/src/sync/types.ts`:

Add after the `SyncItemMeta` type definition:

```typescript
/** Metadata for a deleted item (tombstone). */
export type TombstoneEntry = {
  /** ISO 8601 timestamp when the item was deleted. */
  deletedAt: string;
};
```

Change the `SyncManifest` type to:

```typescript
/** Sync manifest — tracks all items and their metadata. */
export type SyncManifest = {
  /** Manifest schema version (1 = no tombstones, 2 = with tombstones). */
  version: number;
  /** ISO 8601 timestamp of last manifest update. */
  lastModified: string;
  /** Map of item ID → metadata. */
  items: Record<string, SyncItemMeta>;
  /** Map of item ID → deletion record. Only present in version >= 2. */
  tombstones?: Record<string, TombstoneEntry>;
};
```

- [ ] **Step 4: Create error classes**

Create `packages/core/src/sync/errors.ts`:

```typescript
/** Thrown when a sync adapter's auth token is expired or invalid. */
export class SyncAuthError extends Error {
  constructor(message = 'Sync authentication failed — re-authenticate to continue syncing') {
    super(message);
    this.name = 'SyncAuthError';
  }
}

/** Thrown when a sync adapter is used on an unsupported platform. */
export class SyncAdapterUnsupportedError extends Error {
  constructor(adapter: string, platform: string) {
    super(`${adapter} is not supported on ${platform}`);
    this.name = 'SyncAdapterUnsupportedError';
  }
}
```

- [ ] **Step 5: Implement garbageCollectTombstones**

Create `packages/core/src/sync/tombstone.ts`:

```typescript
import type { TombstoneEntry } from './types.js';

/**
 * Remove tombstones older than maxAgeDays.
 *
 * @param tombstones - Map of item ID → tombstone entry
 * @param maxAgeDays - Maximum age in days before a tombstone is garbage-collected
 * @returns New map with only non-expired tombstones
 */
export function garbageCollectTombstones(
  tombstones: Record<string, TombstoneEntry>,
  maxAgeDays: number,
): Record<string, TombstoneEntry> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const result: Record<string, TombstoneEntry> = {};

  for (const [id, entry] of Object.entries(tombstones)) {
    if (new Date(entry.deletedAt).getTime() > cutoff) {
      result[id] = entry;
    }
  }

  return result;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/tombstone.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Update existing sync tests for manifest v2 schema**

In `packages/core/src/sync/sync.test.ts`, the existing `mergeManifests` tests use version 1 manifests without `tombstones`. These tests should still pass unchanged because `tombstones` is optional on `SyncManifest`. Verify:

Run: `pnpm --filter @keykeykey/core vitest run src/sync/sync.test.ts`
Expected: PASS (all existing tests)

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/sync/types.ts packages/core/src/sync/tombstone.ts packages/core/src/sync/tombstone.test.ts packages/core/src/sync/errors.ts
git commit -m "feat(sync): add tombstone types, GC helper, and sync error classes"
```

---

## Chunk 2: Tombstone-Aware Merge

### Task 2: Implement mergeManifestsV2 with tombstone resolution

**Files:**

- Create: `packages/core/src/sync/merge.ts`
- Create: `packages/core/src/sync/merge.test.ts`
- Modify: `packages/core/src/sync/types.ts` (deprecate old `mergeManifests`)

- [ ] **Step 1: Write failing tests for all merge cases**

Create `packages/core/src/sync/merge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mergeManifestsV2 } from './merge.js';
import type { SyncManifest } from './types.js';

const t = (offset: number) => new Date(Date.now() + offset * 1000).toISOString();
const base = t(0);
const earlier = t(-3600);
const later = t(3600);

function manifest(overrides: Partial<SyncManifest> = {}): SyncManifest {
  return { version: 2, lastModified: base, items: {}, tombstones: {}, ...overrides };
}

describe('mergeManifestsV2', () => {
  describe('item + item (no tombstones)', () => {
    it('should keep local-only items', () => {
      const local = manifest({ items: { a: { updatedAt: base, hash: 'ha' } } });
      const remote = manifest();
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).toHaveProperty('a');
    });

    it('should keep remote-only items', () => {
      const local = manifest();
      const remote = manifest({ items: { a: { updatedAt: base, hash: 'ha' } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).toHaveProperty('a');
    });

    it('should pick item with later updatedAt when both have it', () => {
      const local = manifest({ items: { a: { updatedAt: earlier, hash: 'old' } } });
      const remote = manifest({ items: { a: { updatedAt: later, hash: 'new' } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items['a']!.hash).toBe('new');
    });
  });

  describe('item + tombstone', () => {
    it('should delete item when tombstone is newer', () => {
      const local = manifest({ items: { a: { updatedAt: earlier, hash: 'ha' } } });
      const remote = manifest({ tombstones: { a: { deletedAt: later } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).not.toHaveProperty('a');
      expect(merged.tombstones).toHaveProperty('a');
    });

    it('should keep item when item is newer than tombstone', () => {
      const local = manifest({ items: { a: { updatedAt: later, hash: 'ha' } } });
      const remote = manifest({ tombstones: { a: { deletedAt: earlier } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).toHaveProperty('a');
      expect(merged.tombstones).not.toHaveProperty('a');
    });

    it('should handle remote item vs local tombstone', () => {
      const local = manifest({ tombstones: { a: { deletedAt: later } } });
      const remote = manifest({ items: { a: { updatedAt: earlier, hash: 'ha' } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).not.toHaveProperty('a');
      expect(merged.tombstones).toHaveProperty('a');
    });

    it('should keep remote item when it is newer than local tombstone', () => {
      const local = manifest({ tombstones: { a: { deletedAt: earlier } } });
      const remote = manifest({ items: { a: { updatedAt: later, hash: 'ha' } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).toHaveProperty('a');
      expect(merged.tombstones).not.toHaveProperty('a');
    });
  });

  describe('tombstone + tombstone', () => {
    it('should keep tombstone with later deletedAt', () => {
      const local = manifest({ tombstones: { a: { deletedAt: earlier } } });
      const remote = manifest({ tombstones: { a: { deletedAt: later } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.tombstones!['a']!.deletedAt).toBe(later);
    });
  });

  describe('tombstone GC', () => {
    it('should garbage-collect tombstones older than maxAgeDays', () => {
      const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const local = manifest({ tombstones: { a: { deletedAt: old } } });
      const remote = manifest();
      const merged = mergeManifestsV2(local, remote, 30);
      expect(merged.tombstones).not.toHaveProperty('a');
    });
  });

  describe('version handling', () => {
    it('should use highest version', () => {
      const local = manifest({ version: 1 });
      const remote = manifest({ version: 2 });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.version).toBe(2);
    });

    it('should treat missing tombstones as empty (v1 compat)', () => {
      const local: SyncManifest = {
        version: 1,
        lastModified: base,
        items: { a: { updatedAt: base, hash: 'ha' } },
      };
      const remote = manifest({ tombstones: { a: { deletedAt: later } } });
      const merged = mergeManifestsV2(local, remote);
      expect(merged.items).not.toHaveProperty('a');
      expect(merged.tombstones).toHaveProperty('a');
    });
  });

  describe('combined scenarios', () => {
    it('should handle mix of items and tombstones from both sides', () => {
      const local = manifest({
        items: {
          a: { updatedAt: later, hash: 'ha' },
          b: { updatedAt: earlier, hash: 'hb' },
        },
        tombstones: { c: { deletedAt: later } },
      });
      const remote = manifest({
        items: {
          b: { updatedAt: later, hash: 'hb-new' },
          d: { updatedAt: base, hash: 'hd' },
        },
        tombstones: { a: { deletedAt: earlier } },
      });

      const merged = mergeManifestsV2(local, remote);
      // a: local item (later) beats remote tombstone (earlier) → item survives
      expect(merged.items).toHaveProperty('a');
      // b: remote item (later) beats local item (earlier) → remote wins
      expect(merged.items['b']!.hash).toBe('hb-new');
      // c: local tombstone, no remote item → tombstone preserved
      expect(merged.tombstones).toHaveProperty('c');
      // d: remote-only item → preserved
      expect(merged.items).toHaveProperty('d');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/merge.test.ts`
Expected: FAIL — `mergeManifestsV2` not found.

- [ ] **Step 3: Implement mergeManifestsV2**

Create `packages/core/src/sync/merge.ts`:

```typescript
import type { SyncManifest, SyncItemMeta, TombstoneEntry } from './types.js';
import { garbageCollectTombstones } from './tombstone.js';

/**
 * Merge two sync manifests with tombstone-aware LWW conflict resolution.
 *
 * For each item ID across both manifests:
 * - item + item (no tombstones): keep the one with later updatedAt
 * - item + tombstone: if item.updatedAt > tombstone.deletedAt, item survives; otherwise deletion wins
 * - tombstone + tombstone: keep the one with later deletedAt
 *
 * Tombstones older than maxAgeDays are garbage-collected from the result.
 *
 * @param local - The local manifest
 * @param remote - The remote manifest
 * @param maxAgeDays - Maximum tombstone age before GC (default: 30)
 * @returns Merged manifest
 */
export function mergeManifestsV2(
  local: SyncManifest,
  remote: SyncManifest,
  maxAgeDays = 30,
): SyncManifest {
  const mergedItems: Record<string, SyncItemMeta> = {};
  const mergedTombstones: Record<string, TombstoneEntry> = {};

  const localTombstones = local.tombstones ?? {};
  const remoteTombstones = remote.tombstones ?? {};

  // Collect all IDs from items and tombstones on both sides
  const allIds = new Set([
    ...Object.keys(local.items),
    ...Object.keys(remote.items),
    ...Object.keys(localTombstones),
    ...Object.keys(remoteTombstones),
  ]);

  for (const id of allIds) {
    const localItem = local.items[id];
    const remoteItem = remote.items[id];
    const localTomb = localTombstones[id];
    const remoteTomb = remoteTombstones[id];

    // Case 1: Both sides have item, no tombstones → LWW on updatedAt
    if (localItem && remoteItem && !localTomb && !remoteTomb) {
      mergedItems[id] = remoteItem.updatedAt > localItem.updatedAt ? remoteItem : localItem;
      continue;
    }

    // Case 2a: Local has item, remote has tombstone
    if (localItem && remoteTomb) {
      if (localItem.updatedAt > remoteTomb.deletedAt) {
        mergedItems[id] = localItem;
      } else {
        mergedTombstones[id] = remoteTomb;
      }
      continue;
    }

    // Case 2b: Remote has item, local has tombstone
    if (remoteItem && localTomb) {
      if (remoteItem.updatedAt > localTomb.deletedAt) {
        mergedItems[id] = remoteItem;
      } else {
        mergedTombstones[id] = localTomb;
      }
      continue;
    }

    // Case 3: Both sides have tombstones → keep later
    if (localTomb && remoteTomb) {
      mergedTombstones[id] = remoteTomb.deletedAt > localTomb.deletedAt ? remoteTomb : localTomb;
      continue;
    }

    // Case 4: Item on one side only, no opposing tombstone
    if (localItem && !remoteTomb) {
      mergedItems[id] = localItem;
      continue;
    }
    if (remoteItem && !localTomb) {
      mergedItems[id] = remoteItem;
      continue;
    }

    // Case 5: Tombstone on one side only, no item on other
    if (localTomb && !remoteItem) {
      mergedTombstones[id] = localTomb;
      continue;
    }
    if (remoteTomb && !localItem) {
      mergedTombstones[id] = remoteTomb;
      continue;
    }
  }

  return {
    version: Math.max(local.version, remote.version),
    lastModified: new Date().toISOString(),
    items: mergedItems,
    tombstones: garbageCollectTombstones(mergedTombstones, maxAgeDays),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/merge.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Deprecate old mergeManifests in types.ts**

In `packages/core/src/sync/types.ts`, add a JSDoc `@deprecated` tag to the existing `mergeManifests` function:

```typescript
/**
 * @deprecated Use `mergeManifestsV2` from `./merge.js` instead. This function
 * does not handle tombstones. Kept for backward compatibility with existing tests.
 */
```

- [ ] **Step 6: Run all sync tests to verify no regressions**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/`
Expected: PASS (all existing + new tests)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync/merge.ts packages/core/src/sync/merge.test.ts packages/core/src/sync/types.ts
git commit -m "feat(sync): implement tombstone-aware mergeManifestsV2 with LWW resolution"
```

---

## Chunk 3: Sync Engine

### Task 3: Implement SyncEngine with debounce, mutex, and backoff

**Files:**

- Create: `packages/core/src/sync/sync-engine.ts`
- Create: `packages/core/src/sync/sync-engine.test.ts`

- [ ] **Step 1: Write failing tests for sync engine**

Create `packages/core/src/sync/sync-engine.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncEngine } from './sync-engine.js';
import { MemoryAdapter } from './memory-adapter.js';
import { createVaultStore } from '../store/vault-store.js';
import { createVaultHeader } from '../crypto/vault-header.js';
import { generateRecoveryKey } from '../crypto/recovery.js';
import type { Argon2Params } from '../crypto/constants.js';
import type { SyncManifest } from './types.js';

const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };
const MASTER_PASSWORD = 'sync-engine-test';

async function makeUnlockedStore() {
  const { raw: recoveryRaw } = generateRecoveryKey();
  const { header } = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);
  const store = createVaultStore();
  store.getState().loadHeader(header);
  await store.getState().unlock(MASTER_PASSWORD, []);
  return store;
}

describe('SyncEngine', () => {
  let adapter: MemoryAdapter;
  let store: ReturnType<typeof createVaultStore>;
  let engine: SyncEngine;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    store = await makeUnlockedStore();
    engine = new SyncEngine({ adapter, store });
  });

  describe('sync()', () => {
    it('should push local items to empty remote', async () => {
      store.getState().addItem({
        type: 'credential',
        name: 'Test',
        tags: [],
        favorite: false,
        username: 'user',
        password: 'pass',
      });

      const result = await engine.sync();
      expect(result.pushed).toBe(1);
      expect(result.pulled).toBe(0);

      // Verify item is on adapter
      const manifest = await adapter.readManifest();
      expect(Object.keys(manifest!.items)).toHaveLength(1);
    });

    it('should pull remote items into empty local store', async () => {
      // Simulate another device having pushed an item
      const otherStore = await makeUnlockedStore();
      // Use same vault header/DEK — in tests the stores share the same crypto
      // For this test, we manually write encrypted data to the adapter
      otherStore.getState().loadHeader(store.getState().header!);
      // Re-unlock with same password to get same DEK
      const otherAdapter = new MemoryAdapter();

      // Instead, set up remote state directly on our adapter
      const id = store.getState().addItem({
        type: 'credential',
        name: 'Remote Item',
        tags: [],
        favorite: false,
        username: 'remote-user',
        password: 'remote-pass',
      });

      // Push first
      await engine.sync();

      // Now clear local store and re-create engine
      store.getState().deleteItem(id);
      expect(store.getState().items).toHaveLength(0);

      // Sync should pull the item back
      const result = await engine.sync();
      expect(result.pulled).toBe(1);
      expect(store.getState().items).toHaveLength(1);
    });

    it('should propagate tombstones', async () => {
      // Add and sync an item
      const id = store.getState().addItem({
        type: 'credential',
        name: 'To Delete',
        tags: [],
        favorite: false,
        username: 'user',
        password: 'pass',
      });
      await engine.sync();

      // Delete locally and sync
      store.getState().deleteItem(id);
      engine.recordTombstone(id);
      const result = await engine.sync();

      expect(result.deleted).toBeGreaterThanOrEqual(1);

      // Remote item should be gone
      const remoteItem = await adapter.readItem(id);
      expect(remoteItem).toBeNull();

      // Manifest should have tombstone
      const manifest = await adapter.readManifest();
      expect(manifest!.tombstones).toHaveProperty(id);
    });

    it('should not run concurrent syncs', async () => {
      store.getState().addItem({
        type: 'credential',
        name: 'Test',
        tags: [],
        favorite: false,
        username: 'user',
        password: 'pass',
      });

      // Start two syncs simultaneously
      const sync1 = engine.sync();
      const sync2 = engine.sync();

      const [result1, result2] = await Promise.all([sync1, sync2]);

      // One should have done work, the other should be a no-op (or queued)
      const totalPushed = result1.pushed + result2.pushed;
      expect(totalPushed).toBeGreaterThanOrEqual(1);
    });

    it('should return correct SyncResult counts', async () => {
      const result = await engine.sync();
      expect(result).toEqual({
        pulled: 0,
        pushed: 0,
        deleted: 0,
        conflicts: 0,
      });
    });
  });

  describe('isSyncing()', () => {
    it('should return false when not syncing', () => {
      expect(engine.isSyncing()).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/sync-engine.test.ts`
Expected: FAIL — `SyncEngine` not found.

- [ ] **Step 3: Implement SyncEngine**

Create `packages/core/src/sync/sync-engine.ts`:

```typescript
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { ISyncAdapter, SyncManifest, SyncItemMeta, TombstoneEntry } from './types.js';
import type { VaultItem } from '../models/vault-item.js';
import { encrypt, decrypt } from '../crypto/encryption.js';
import { VaultItemSchema } from '../models/vault-item.js';
import { mergeManifestsV2 } from './merge.js';

export interface SyncResult {
  pulled: number;
  pushed: number;
  deleted: number;
  conflicts: number;
}

export interface SyncEngineOptions {
  adapter: ISyncAdapter;
  store: {
    getState: () => {
      status: string;
      items: VaultItem[];
      encryptItem: (item: VaultItem) => Uint8Array;
      getDEK: () => Uint8Array;
    };
    setState: (
      partial: { items: VaultItem[] } | ((state: { items: VaultItem[] }) => { items: VaultItem[] }),
    ) => void;
  };
  onConflictResolved?: (winner: VaultItem, loser: VaultItem) => void;
  tombstoneMaxAgeDays?: number;
}

const DEFAULT_TOMBSTONE_MAX_AGE_DAYS = 30;
const DEBOUNCE_MS = 2000;
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

export class SyncEngine {
  private adapter: ISyncAdapter;
  private store: SyncEngineOptions['store'];
  private onConflictResolved?: SyncEngineOptions['onConflictResolved'];
  private tombstoneMaxAgeDays: number;

  private localManifest: SyncManifest;
  private localTombstones: Record<string, TombstoneEntry> = {};

  private syncing = false;
  private pendingSync = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = DEBOUNCE_MS;
  private consecutiveFailures = 0;

  constructor(options: SyncEngineOptions) {
    this.adapter = options.adapter;
    this.store = options.store;
    this.onConflictResolved = options.onConflictResolved;
    this.tombstoneMaxAgeDays = options.tombstoneMaxAgeDays ?? DEFAULT_TOMBSTONE_MAX_AGE_DAYS;

    this.localManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: {},
    };
  }

  /** Record a tombstone for a deleted item. Call before sync(). */
  recordTombstone(itemId: string): void {
    this.localTombstones[itemId] = { deletedAt: new Date().toISOString() };
    delete this.localManifest.items[itemId];
    this.localManifest.tombstones = {
      ...this.localManifest.tombstones,
      ...this.localTombstones,
    };
  }

  /** Whether a sync is currently in progress. */
  isSyncing(): boolean {
    return this.syncing;
  }

  /** Schedule a debounced sync. User-initiated changes reset backoff. */
  scheduleSync(isUserAction = true): void {
    if (isUserAction) {
      this.consecutiveFailures = 0;
      this.backoffMs = DEBOUNCE_MS;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.sync().catch(() => {
        // Error handling is inside sync()
      });
    }, this.backoffMs);
  }

  /** Run a full bidirectional sync cycle. */
  async sync(): Promise<SyncResult> {
    if (this.syncing) {
      this.pendingSync = true;
      return { pulled: 0, pushed: 0, deleted: 0, conflicts: 0 };
    }

    this.syncing = true;
    const result: SyncResult = { pulled: 0, pushed: 0, deleted: 0, conflicts: 0 };

    try {
      const storeState = this.store.getState();
      if (storeState.status !== 'unlocked') {
        return result;
      }

      const dek = storeState.getDEK();

      // Step 1: Fetch remote manifest
      const remoteManifest = (await this.adapter.readManifest()) ?? {
        version: 2,
        lastModified: new Date().toISOString(),
        items: {},
        tombstones: {},
      };

      // Build local manifest from store items
      this.rebuildLocalManifest(storeState.items);

      // Step 2: Diff — determine what to pull and push
      const merged = mergeManifestsV2(this.localManifest, remoteManifest, this.tombstoneMaxAgeDays);

      // Step 3: Pull remote items that are newer
      for (const [id, meta] of Object.entries(merged.items)) {
        const localMeta = this.localManifest.items[id];
        const remoteMeta = remoteManifest.items[id];

        // Item exists remotely and is the winner, but not locally (or local is older)
        if (
          remoteMeta &&
          meta === remoteMeta &&
          (!localMeta || remoteMeta.updatedAt > localMeta.updatedAt)
        ) {
          const encryptedData = await this.adapter.readItem(id);
          if (encryptedData) {
            try {
              const plainBytes = decrypt(encryptedData, dek);
              const json = new TextDecoder().decode(plainBytes);
              const item = VaultItemSchema.parse(JSON.parse(json));

              // Check if this is a conflict (both sides had the item)
              if (localMeta && remoteMeta.updatedAt > localMeta.updatedAt) {
                const localItem = storeState.items.find((i) => i.id === id);
                if (localItem && this.onConflictResolved) {
                  this.onConflictResolved(item, localItem);
                }
                result.conflicts++;
              }

              // Update store with remote item
              const currentItems = this.store.getState().items;
              const existingIndex = currentItems.findIndex((i) => i.id === id);
              if (existingIndex >= 0) {
                const newItems = [...currentItems];
                newItems[existingIndex] = item;
                this.store.setState({ items: newItems });
              } else {
                this.store.setState({ items: [...currentItems, item] });
              }
              result.pulled++;
            } catch {
              console.warn(`Failed to decrypt remote item ${id}, skipping`);
            }
          }
        }
      }

      // Step 4: Apply tombstones — delete local items that were deleted remotely
      const mergedTombstones = merged.tombstones ?? {};
      for (const id of Object.keys(mergedTombstones)) {
        const currentItems = this.store.getState().items;
        const exists = currentItems.find((i) => i.id === id);
        if (exists) {
          this.store.setState({ items: currentItems.filter((i) => i.id !== id) });
          result.deleted++;
        }
        // Also delete from remote adapter
        await this.adapter.deleteItem(id);
      }

      // Step 5: Push local items that are newer or missing remotely
      const currentItems = this.store.getState().items;
      for (const item of currentItems) {
        const remoteMeta = remoteManifest.items[item.id];

        // Push if: not on remote, or local item is newer than remote
        const shouldPush = !remoteMeta || item.updatedAt > remoteMeta.updatedAt;
        if (shouldPush) {
          const encrypted = storeState.encryptItem(item);
          await this.adapter.writeItem(item.id, encrypted);

          // Update merged manifest with fresh hash
          merged.items[item.id] = {
            updatedAt: item.updatedAt,
            hash: bytesToHex(sha256(encrypted)),
          };
          result.pushed++;
        }
      }

      // Step 6: Commit — write merged manifest
      await this.adapter.writeManifest(merged);
      this.localManifest = merged;
      this.localTombstones = {};

      // Reset backoff on success
      this.consecutiveFailures = 0;
      this.backoffMs = DEBOUNCE_MS;
    } catch (error) {
      this.consecutiveFailures++;
      this.backoffMs = Math.min(
        DEBOUNCE_MS * Math.pow(2, this.consecutiveFailures),
        MAX_BACKOFF_MS,
      );
      console.warn('Sync failed:', error instanceof Error ? error.message : error);
    } finally {
      this.syncing = false;

      // If another sync was requested while we were running, schedule it
      // (don't call sync() directly — respect backoff via scheduleSync)
      if (this.pendingSync) {
        this.pendingSync = false;
        this.scheduleSync(false);
      }
    }

    return result;
  }

  /** Rebuild local manifest from current store items. Preserves existing tombstones. */
  private rebuildLocalManifest(items: VaultItem[]): void {
    const itemsMeta: Record<string, SyncItemMeta> = {};
    for (const item of items) {
      // Use updatedAt from the item itself, hash will be computed on push
      itemsMeta[item.id] = {
        updatedAt: item.updatedAt,
        hash: this.localManifest.items[item.id]?.hash ?? '',
      };
    }
    this.localManifest = {
      ...this.localManifest,
      items: itemsMeta,
      tombstones: { ...this.localManifest.tombstones, ...this.localTombstones },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/sync-engine.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync/sync-engine.ts packages/core/src/sync/sync-engine.test.ts
git commit -m "feat(sync): implement SyncEngine with debounce, mutex, and backoff"
```

---

## Chunk 4: Store↔Engine Wiring

### Task 4: Implement connectSyncEngine and update exports

**Files:**

- Create: `packages/core/src/sync/connect.ts`
- Create: `packages/core/src/sync/connect.test.ts`
- Modify: `packages/core/src/sync/index.ts`

- [ ] **Step 1: Write failing test for connectSyncEngine**

Create `packages/core/src/sync/connect.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { connectSyncEngine } from './connect.js';
import { SyncEngine } from './sync-engine.js';
import { MemoryAdapter } from './memory-adapter.js';
import { createVaultStore } from '../store/vault-store.js';
import { createVaultHeader } from '../crypto/vault-header.js';
import { generateRecoveryKey } from '../crypto/recovery.js';
import type { Argon2Params } from '../crypto/constants.js';

const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };

async function makeUnlockedStore() {
  const { raw: recoveryRaw } = generateRecoveryKey();
  const { header } = await createVaultHeader('test-pass', recoveryRaw, TEST_PARAMS);
  const store = createVaultStore();
  store.getState().loadHeader(header);
  await store.getState().unlock('test-pass', []);
  return store;
}

describe('connectSyncEngine', () => {
  it('should schedule sync when items change', async () => {
    const store = await makeUnlockedStore();
    const adapter = new MemoryAdapter();
    const engine = new SyncEngine({ adapter, store });
    const scheduleSpy = vi.spyOn(engine, 'scheduleSync');

    const disconnect = connectSyncEngine(store, engine);

    store.getState().addItem({
      type: 'credential',
      name: 'Test',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    // Give Zustand subscription a tick to fire
    await new Promise((r) => setTimeout(r, 10));

    expect(scheduleSpy).toHaveBeenCalled();
    disconnect();
  });

  it('should not schedule sync when engine is already syncing', async () => {
    const store = await makeUnlockedStore();
    const adapter = new MemoryAdapter();
    const engine = new SyncEngine({ adapter, store });
    const scheduleSpy = vi.spyOn(engine, 'scheduleSync');
    vi.spyOn(engine, 'isSyncing').mockReturnValue(true);

    const disconnect = connectSyncEngine(store, engine);

    store.getState().addItem({
      type: 'credential',
      name: 'Test',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(scheduleSpy).not.toHaveBeenCalled();
    disconnect();
  });

  it('should not schedule sync when vault is locked', async () => {
    const store = await makeUnlockedStore();
    const adapter = new MemoryAdapter();
    const engine = new SyncEngine({ adapter, store });
    const scheduleSpy = vi.spyOn(engine, 'scheduleSync');

    const disconnect = connectSyncEngine(store, engine);

    store.getState().lock();

    await new Promise((r) => setTimeout(r, 10));

    // lock() changes items to [] but status is 'locked', so no sync
    expect(scheduleSpy).not.toHaveBeenCalled();
    disconnect();
  });

  it('should return a disconnect function', async () => {
    const store = await makeUnlockedStore();
    const adapter = new MemoryAdapter();
    const engine = new SyncEngine({ adapter, store });
    const scheduleSpy = vi.spyOn(engine, 'scheduleSync');

    const disconnect = connectSyncEngine(store, engine);
    disconnect();

    store.getState().addItem({
      type: 'credential',
      name: 'Test',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(scheduleSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/connect.test.ts`
Expected: FAIL — `connectSyncEngine` not found.

- [ ] **Step 3: Implement connectSyncEngine**

Create `packages/core/src/sync/connect.ts`:

```typescript
import type { SyncEngine } from './sync-engine.js';

type MinimalStore = {
  getState: () => { status: string; items: unknown[] };
  subscribe: (
    listener: (
      state: { status: string; items: unknown[] },
      prevState: { status: string; items: unknown[] },
    ) => void,
  ) => () => void;
};

/**
 * Connect a SyncEngine to a vault store.
 *
 * Subscribes to store changes and schedules sync when items change,
 * with a guard to prevent sync-originated store mutations from re-triggering sync.
 *
 * @returns Disconnect function to unsubscribe.
 */
export function connectSyncEngine(store: MinimalStore, engine: SyncEngine): () => void {
  const unsubscribe = store.subscribe((state, prevState) => {
    if (state.items !== prevState.items && state.status === 'unlocked' && !engine.isSyncing()) {
      engine.scheduleSync();
    }
  });

  return unsubscribe;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/connect.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Update sync module exports**

Modify `packages/core/src/sync/index.ts`:

```typescript
/**
 * Sync adapter interface and implementations for BYOC (Bring Your Own Cloud) sync.
 *
 * @module sync
 */

export { mergeManifests } from './types.js';
export type { ISyncAdapter, SyncManifest, SyncItemMeta, TombstoneEntry } from './types.js';
export { mergeManifestsV2 } from './merge.js';
export { MemoryAdapter } from './memory-adapter.js';
export { SyncEngine } from './sync-engine.js';
export type { SyncResult, SyncEngineOptions } from './sync-engine.js';
export { connectSyncEngine } from './connect.js';
export { garbageCollectTombstones } from './tombstone.js';
export { SyncAuthError, SyncAdapterUnsupportedError } from './errors.js';
```

- [ ] **Step 6: Run all sync tests**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/`
Expected: PASS (all tests across all sync files)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync/connect.ts packages/core/src/sync/connect.test.ts packages/core/src/sync/index.ts
git commit -m "feat(sync): add store-engine wiring and update sync module exports"
```

---

## Chunk 5: WebDAV Adapter

### Task 5: Implement WebDAV sync adapter

**Files:**

- Create: `packages/core/src/sync/webdav-adapter.ts`
- Create: `packages/core/src/sync/webdav-adapter.test.ts`

- [ ] **Step 1: Write failing tests for WebDAV adapter**

Create `packages/core/src/sync/webdav-adapter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebDavAdapter } from './webdav-adapter.js';
import type { SyncManifest } from './types.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BASE_URL = 'https://dav.example.com/keykeykey';
const CREDS = { url: BASE_URL, username: 'user', password: 'pass' };

describe('WebDavAdapter', () => {
  let adapter: WebDavAdapter;

  beforeEach(() => {
    adapter = new WebDavAdapter(CREDS);
    mockFetch.mockReset();
  });

  describe('readManifest()', () => {
    it('should return null when manifest does not exist (404)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      const manifest = await adapter.readManifest();
      expect(manifest).toBeNull();
    });

    it('should parse and return manifest', async () => {
      const manifest: SyncManifest = {
        version: 2,
        lastModified: new Date().toISOString(),
        items: {},
        tombstones: {},
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(manifest),
      });

      const result = await adapter.readManifest();
      expect(result).toEqual(manifest);
    });
  });

  describe('writeManifest()', () => {
    it('should PUT manifest as JSON', async () => {
      // MKCOL for directory (may already exist)
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
      // PUT manifest
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });

      const manifest: SyncManifest = {
        version: 2,
        lastModified: new Date().toISOString(),
        items: {},
        tombstones: {},
      };

      await adapter.writeManifest(manifest);

      // Second call should be PUT with JSON body
      const putCall = mockFetch.mock.calls[1]!;
      expect(putCall[0]).toBe(`${BASE_URL}/manifest.json`);
      expect(putCall[1]!.method).toBe('PUT');
    });
  });

  describe('readItem()', () => {
    it('should return null for missing item (404)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      const result = await adapter.readItem('test-id');
      expect(result).toBeNull();
    });

    it('should return Uint8Array for existing item', async () => {
      const data = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(data.buffer),
      });

      const result = await adapter.readItem('test-id');
      expect(result).toEqual(data);
    });
  });

  describe('writeItem()', () => {
    it('should PUT item bytes', async () => {
      // MKCOL items dir
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
      // PUT item
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });

      await adapter.writeItem('test-id', new Uint8Array([1, 2, 3]));

      const putCall = mockFetch.mock.calls[1]!;
      expect(putCall[0]).toBe(`${BASE_URL}/items/test-id.bin`);
      expect(putCall[1]!.method).toBe('PUT');
    });
  });

  describe('deleteItem()', () => {
    it('should DELETE item', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      await adapter.deleteItem('test-id');

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/items/test-id.bin`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('should not throw on 404 (already deleted)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      await expect(adapter.deleteItem('test-id')).resolves.not.toThrow();
    });
  });

  describe('ping()', () => {
    it('should return true when server responds', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 207 });
      const result = await adapter.ping();
      expect(result).toBe(true);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const result = await adapter.ping();
      expect(result).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/webdav-adapter.test.ts`
Expected: FAIL — `WebDavAdapter` not found.

- [ ] **Step 3: Implement WebDavAdapter**

Create `packages/core/src/sync/webdav-adapter.ts`:

```typescript
import type { ISyncAdapter, SyncManifest } from './types.js';
import { SyncAuthError } from './errors.js';

export interface WebDavConfig {
  /** WebDAV server base URL (e.g., https://dav.example.com/keykeykey) */
  url: string;
  /** Basic auth username */
  username: string;
  /** Basic auth password */
  password: string;
}

export class WebDavAdapter implements ISyncAdapter {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: WebDavConfig) {
    // Remove trailing slash
    this.baseUrl = config.url.replace(/\/+$/, '');
    const encoded = btoa(`${config.username}:${config.password}`);
    this.headers = { Authorization: `Basic ${encoded}` };
  }

  async readManifest(): Promise<SyncManifest | null> {
    const res = await this.fetch(`${this.baseUrl}/manifest.json`, { method: 'GET' });
    if (res.status === 404) return null;
    this.checkAuth(res);
    if (!res.ok) throw new Error(`WebDAV readManifest failed: ${res.status}`);
    return (await res.json()) as SyncManifest;
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    await this.ensureDir(this.baseUrl);
    const res = await this.fetch(`${this.baseUrl}/manifest.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    this.checkAuth(res);
    if (!res.ok) throw new Error(`WebDAV writeManifest failed: ${res.status}`);
  }

  async readItem(id: string): Promise<Uint8Array | null> {
    const res = await this.fetch(`${this.baseUrl}/items/${id}.bin`, { method: 'GET' });
    if (res.status === 404) return null;
    this.checkAuth(res);
    if (!res.ok) throw new Error(`WebDAV readItem failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    await this.ensureDir(`${this.baseUrl}/items`);
    const res = await this.fetch(`${this.baseUrl}/items/${id}.bin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    this.checkAuth(res);
    if (!res.ok) throw new Error(`WebDAV writeItem failed: ${res.status}`);
  }

  async deleteItem(id: string): Promise<void> {
    const res = await this.fetch(`${this.baseUrl}/items/${id}.bin`, { method: 'DELETE' });
    if (res.status === 404) return; // Already gone
    this.checkAuth(res);
    if (!res.ok) throw new Error(`WebDAV deleteItem failed: ${res.status}`);
  }

  async listItems(): Promise<string[]> {
    // PROPFIND on items directory to list files
    const res = await this.fetch(`${this.baseUrl}/items/`, {
      method: 'PROPFIND',
      headers: { Depth: '1' },
    });
    if (res.status === 404) return [];
    this.checkAuth(res);
    if (!res.ok) throw new Error(`WebDAV listItems failed: ${res.status}`);

    const text = await res.text();
    // Parse item IDs from WebDAV PROPFIND XML response
    const ids: string[] = [];
    const matches = text.matchAll(/<D:href>[^<]*\/items\/([^<]+)\.bin<\/D:href>/gi);
    for (const match of matches) {
      if (match[1]) ids.push(decodeURIComponent(match[1]));
    }
    return ids;
  }

  /** Check if the WebDAV server is reachable. */
  async ping(): Promise<boolean> {
    try {
      const res = await this.fetch(this.baseUrl, { method: 'PROPFIND', headers: { Depth: '0' } });
      return res.ok || res.status === 207;
    } catch {
      return false;
    }
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: { ...this.headers, ...(init.headers as Record<string, string>) },
    });
  }

  private async ensureDir(url: string): Promise<void> {
    // MKCOL — creates directory if it doesn't exist. 405 = already exists, which is fine.
    const res = await this.fetch(url, { method: 'MKCOL' });
    if (!res.ok && res.status !== 405) {
      this.checkAuth(res);
    }
  }

  private checkAuth(res: Response): void {
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/webdav-adapter.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Update index.ts exports**

Add to `packages/core/src/sync/index.ts`:

```typescript
export { WebDavAdapter } from './webdav-adapter.js';
export type { WebDavConfig } from './webdav-adapter.js';
```

- [ ] **Step 6: Run all sync tests**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync/webdav-adapter.ts packages/core/src/sync/webdav-adapter.test.ts packages/core/src/sync/index.ts
git commit -m "feat(sync): add WebDAV sync adapter"
```

---

## Chunk 6: Google Drive Adapter

### Task 6: Implement Google Drive sync adapter

**Files:**

- Create: `packages/core/src/sync/google-drive-adapter.ts`
- Create: `packages/core/src/sync/google-drive-adapter.test.ts`

- [ ] **Step 1: Write failing tests for Google Drive adapter**

Create `packages/core/src/sync/google-drive-adapter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoogleDriveAdapter } from './google-drive-adapter.js';
import type { SyncManifest } from './types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const getAccessToken = vi.fn().mockResolvedValue('test-token');

describe('GoogleDriveAdapter', () => {
  let adapter: GoogleDriveAdapter;

  beforeEach(() => {
    adapter = new GoogleDriveAdapter({ getAccessToken });
    mockFetch.mockReset();
    getAccessToken.mockClear();
  });

  describe('readManifest()', () => {
    it('should return null when no manifest file exists', async () => {
      // Search for manifest file — empty result
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ files: [] }),
      });

      const result = await adapter.readManifest();
      expect(result).toBeNull();
    });

    it('should return manifest when it exists', async () => {
      const manifest: SyncManifest = {
        version: 2,
        lastModified: new Date().toISOString(),
        items: {},
        tombstones: {},
      };

      // Search returns file
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ files: [{ id: 'file-123' }] }),
      });
      // Download file content
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(manifest),
      });

      const result = await adapter.readManifest();
      expect(result).toEqual(manifest);
    });
  });

  describe('writeItem()', () => {
    it('should create a new file when item does not exist', async () => {
      // Search for existing file — not found
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ files: [] }),
      });
      // Create file via multipart upload
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'new-file-id' }),
      });

      await adapter.writeItem('test-id', new Uint8Array([1, 2, 3]));
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('deleteItem()', () => {
    it('should delete file by searching and then deleting', async () => {
      // Search returns file
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ files: [{ id: 'file-123' }] }),
      });
      // DELETE
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      await adapter.deleteItem('test-id');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not throw when file does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ files: [] }),
      });

      await expect(adapter.deleteItem('nonexistent')).resolves.not.toThrow();
    });
  });

  it('should pass Authorization header with access token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ files: [] }),
    });

    await adapter.readManifest();

    expect(getAccessToken).toHaveBeenCalled();
    const callHeaders = mockFetch.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(callHeaders['Authorization']).toBe('Bearer test-token');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/google-drive-adapter.test.ts`
Expected: FAIL — `GoogleDriveAdapter` not found.

- [ ] **Step 3: Implement GoogleDriveAdapter**

Create `packages/core/src/sync/google-drive-adapter.ts`:

```typescript
import type { ISyncAdapter, SyncManifest } from './types.js';
import { SyncAuthError } from './errors.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export interface GoogleDriveConfig {
  /** Returns a valid OAuth 2.0 access token. Platform handles the OAuth flow. */
  getAccessToken: () => Promise<string>;
}

export class GoogleDriveAdapter implements ISyncAdapter {
  private getAccessToken: () => Promise<string>;
  /** Cache of filename → Drive file ID for the session */
  private fileIdCache = new Map<string, string>();

  constructor(config: GoogleDriveConfig) {
    this.getAccessToken = config.getAccessToken;
  }

  async readManifest(): Promise<SyncManifest | null> {
    const fileId = await this.findFile('manifest.json');
    if (!fileId) return null;
    const res = await this.apiFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
    if (!res.ok) throw new Error(`Google Drive readManifest failed: ${res.status}`);
    return (await res.json()) as SyncManifest;
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    const body = JSON.stringify(manifest);
    await this.upsertFile('manifest.json', new TextEncoder().encode(body), 'application/json');
  }

  async readItem(id: string): Promise<Uint8Array | null> {
    const fileId = await this.findFile(`${id}.bin`);
    if (!fileId) return null;
    const res = await this.apiFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
    if (!res.ok) throw new Error(`Google Drive readItem failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    await this.upsertFile(`${id}.bin`, data, 'application/octet-stream');
  }

  async deleteItem(id: string): Promise<void> {
    const fileId = await this.findFile(`${id}.bin`);
    if (!fileId) return;
    const res = await this.apiFetch(`${DRIVE_API}/files/${fileId}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) {
      this.fileIdCache.delete(`${id}.bin`);
      return;
    }
    throw new Error(`Google Drive deleteItem failed: ${res.status}`);
  }

  async listItems(): Promise<string[]> {
    const query = `'appDataFolder' in parents and name contains '.bin'`;
    const res = await this.apiFetch(
      `${DRIVE_API}/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id,name)`,
    );
    if (!res.ok) throw new Error(`Google Drive listItems failed: ${res.status}`);
    const data = (await res.json()) as { files: Array<{ id: string; name: string }> };
    return data.files.map((f) => f.name.replace(/\.bin$/, ''));
  }

  /** Find a file by name in appDataFolder. Returns Drive file ID or null. */
  private async findFile(name: string): Promise<string | null> {
    const cached = this.fileIdCache.get(name);
    if (cached) return cached;

    const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const query = `name = '${safeName}' and 'appDataFolder' in parents and trashed = false`;
    const res = await this.apiFetch(
      `${DRIVE_API}/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id)`,
    );
    this.checkAuth(res);
    if (!res.ok) throw new Error(`Google Drive findFile failed: ${res.status}`);

    const data = (await res.json()) as { files: Array<{ id: string }> };
    if (data.files.length === 0) return null;

    const fileId = data.files[0]!.id;
    this.fileIdCache.set(name, fileId);
    return fileId;
  }

  /** Create or update a file in appDataFolder. */
  private async upsertFile(name: string, data: Uint8Array, mimeType: string): Promise<void> {
    const existingId = await this.findFile(name);

    if (existingId) {
      // Update existing file
      const res = await this.apiFetch(`${UPLOAD_API}/files/${existingId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': mimeType },
        body: data,
      });
      this.checkAuth(res);
      if (!res.ok) throw new Error(`Google Drive upsertFile (update) failed: ${res.status}`);
    } else {
      // Create new file with multipart upload
      const metadata = JSON.stringify({ name, parents: ['appDataFolder'] });
      const boundary = `---keykeykey-${crypto.randomUUID()}`;
      const body =
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
      const bodyEnd = `\r\n--${boundary}--`;

      const encoder = new TextEncoder();
      const parts = [encoder.encode(body), data, encoder.encode(bodyEnd)];
      const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of parts) {
        combined.set(part, offset);
        offset += part.length;
      }

      const res = await this.apiFetch(`${UPLOAD_API}/files?uploadType=multipart`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: combined,
      });
      this.checkAuth(res);
      if (!res.ok) throw new Error(`Google Drive upsertFile (create) failed: ${res.status}`);

      const result = (await res.json()) as { id: string };
      this.fileIdCache.set(name, result.id);
    }
  }

  private async apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers as Record<string, string>),
      },
    });
  }

  private checkAuth(res: Response): void {
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/google-drive-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Update index.ts exports**

Add to `packages/core/src/sync/index.ts`:

```typescript
export { GoogleDriveAdapter } from './google-drive-adapter.js';
export type { GoogleDriveConfig } from './google-drive-adapter.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/google-drive-adapter.ts packages/core/src/sync/google-drive-adapter.test.ts packages/core/src/sync/index.ts
git commit -m "feat(sync): add Google Drive sync adapter"
```

---

## Chunk 7: iCloud Adapter

### Task 7: Implement iCloud sync adapter

**Files:**

- Create: `packages/core/src/sync/icloud-adapter.ts`
- Create: `packages/core/src/sync/icloud-adapter.test.ts`

- [ ] **Step 1: Write failing tests for iCloud adapter**

Create `packages/core/src/sync/icloud-adapter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ICloudAdapter } from './icloud-adapter.js';
import type { SyncManifest } from './types.js';

// The iCloud adapter uses a filesystem interface (abstracted for platform portability)
const mockFs = {
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  listFiles: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
};

describe('ICloudAdapter', () => {
  let adapter: ICloudAdapter;

  beforeEach(() => {
    adapter = new ICloudAdapter({ containerPath: '/icloud/keykeykey', fs: mockFs });
    vi.clearAllMocks();
  });

  describe('readManifest()', () => {
    it('should return null when manifest does not exist', async () => {
      mockFs.exists.mockResolvedValueOnce(false);
      const result = await adapter.readManifest();
      expect(result).toBeNull();
    });

    it('should parse and return manifest', async () => {
      const manifest: SyncManifest = {
        version: 2,
        lastModified: new Date().toISOString(),
        items: {},
        tombstones: {},
      };
      mockFs.exists.mockResolvedValueOnce(true);
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(manifest));
      const result = await adapter.readManifest();
      expect(result).toEqual(manifest);
    });
  });

  describe('writeManifest()', () => {
    it('should write manifest as JSON to container path', async () => {
      mockFs.mkdir.mockResolvedValueOnce(undefined);
      mockFs.writeFile.mockResolvedValueOnce(undefined);
      const manifest: SyncManifest = { version: 2, lastModified: '', items: {}, tombstones: {} };
      await adapter.writeManifest(manifest);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/icloud/keykeykey/manifest.json',
        JSON.stringify(manifest),
      );
    });
  });

  describe('readItem()', () => {
    it('should return null for missing item', async () => {
      mockFs.exists.mockResolvedValueOnce(false);
      const result = await adapter.readItem('test-id');
      expect(result).toBeNull();
    });

    it('should return Uint8Array for existing item', async () => {
      const data = new Uint8Array([1, 2, 3]);
      mockFs.exists.mockResolvedValueOnce(true);
      mockFs.readFile.mockResolvedValueOnce(data);
      const result = await adapter.readItem('test-id');
      expect(result).toEqual(data);
    });
  });

  describe('writeItem()', () => {
    it('should write item to items directory', async () => {
      mockFs.mkdir.mockResolvedValueOnce(undefined);
      mockFs.writeFile.mockResolvedValueOnce(undefined);
      await adapter.writeItem('test-id', new Uint8Array([1, 2, 3]));
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/icloud/keykeykey/items/test-id.bin',
        expect.any(Uint8Array),
      );
    });
  });

  describe('deleteItem()', () => {
    it('should delete item file', async () => {
      mockFs.deleteFile.mockResolvedValueOnce(undefined);
      await adapter.deleteItem('test-id');
      expect(mockFs.deleteFile).toHaveBeenCalledWith('/icloud/keykeykey/items/test-id.bin');
    });
  });

  describe('listItems()', () => {
    it('should list .bin files and return IDs', async () => {
      mockFs.listFiles.mockResolvedValueOnce(['abc.bin', 'def.bin']);
      const ids = await adapter.listItems();
      expect(ids).toEqual(['abc', 'def']);
    });

    it('should return empty array when items dir does not exist', async () => {
      mockFs.listFiles.mockRejectedValueOnce(new Error('not found'));
      const ids = await adapter.listItems();
      expect(ids).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/icloud-adapter.test.ts`
Expected: FAIL — `ICloudAdapter` not found.

- [ ] **Step 3: Implement ICloudAdapter**

Create `packages/core/src/sync/icloud-adapter.ts`:

```typescript
import type { ISyncAdapter, SyncManifest } from './types.js';

/**
 * Filesystem interface for iCloud adapter.
 *
 * Each platform provides its own implementation:
 * - Mobile: expo-file-system wrapper
 * - Desktop: Tauri fs commands
 * - Extension (Safari): Web APIs
 */
export interface ICloudFs {
  readFile(path: string): Promise<string | Uint8Array>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(directory: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}

export interface ICloudConfig {
  /** Path to the iCloud container directory */
  containerPath: string;
  /** Platform-specific filesystem implementation */
  fs: ICloudFs;
}

export class ICloudAdapter implements ISyncAdapter {
  private basePath: string;
  private fs: ICloudFs;

  constructor(config: ICloudConfig) {
    this.basePath = config.containerPath.replace(/\/+$/, '');
    this.fs = config.fs;
  }

  async readManifest(): Promise<SyncManifest | null> {
    const path = `${this.basePath}/manifest.json`;
    if (!(await this.fs.exists(path))) return null;
    const content = await this.fs.readFile(path);
    const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
    return JSON.parse(text) as SyncManifest;
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    await this.fs.mkdir(this.basePath);
    await this.fs.writeFile(`${this.basePath}/manifest.json`, JSON.stringify(manifest));
  }

  async readItem(id: string): Promise<Uint8Array | null> {
    const path = `${this.basePath}/items/${id}.bin`;
    if (!(await this.fs.exists(path))) return null;
    const data = await this.fs.readFile(path);
    if (data instanceof Uint8Array) return data;
    return new TextEncoder().encode(data);
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    await this.fs.mkdir(`${this.basePath}/items`);
    await this.fs.writeFile(`${this.basePath}/items/${id}.bin`, data);
  }

  async deleteItem(id: string): Promise<void> {
    try {
      await this.fs.deleteFile(`${this.basePath}/items/${id}.bin`);
    } catch {
      // File may already be gone
    }
  }

  async listItems(): Promise<string[]> {
    try {
      const files = await this.fs.listFiles(`${this.basePath}/items`);
      return files.filter((f) => f.endsWith('.bin')).map((f) => f.replace(/\.bin$/, ''));
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/icloud-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Update index.ts exports**

Add to `packages/core/src/sync/index.ts`:

```typescript
export { ICloudAdapter } from './icloud-adapter.js';
export type { ICloudConfig, ICloudFs } from './icloud-adapter.js';
```

- [ ] **Step 6: Run all sync tests**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync/icloud-adapter.ts packages/core/src/sync/icloud-adapter.test.ts packages/core/src/sync/index.ts
git commit -m "feat(sync): add iCloud sync adapter with platform-agnostic filesystem interface"
```

---

## Chunk 8: E2E Conflict Simulation with Tombstones

### Task 8: Extend conflict simulation tests for tombstone scenarios

**Files:**

- Modify: `packages/core/src/sync/sync-conflict.test.ts`

- [ ] **Step 1: Add tombstone conflict tests**

Append to `packages/core/src/sync/sync-conflict.test.ts`, adding new describe blocks that use `mergeManifestsV2` and test tombstone interactions:

```typescript
import { mergeManifestsV2 } from './merge.js';

describe('Sync conflict simulation — Tombstones', () => {
  it('should propagate deletion when device A deletes and device B has not synced', async () => {
    const { deviceA, deviceB } = await makeTwoDevices();

    // Both devices have an item (simulated)
    const idA = deviceA.getState().addItem({
      type: 'credential',
      name: 'Shared Item',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    const adapterA = new MemoryAdapter();
    const manifestA = await writeToAdapter(deviceA, adapterA);

    // Device A deletes the item
    deviceA.getState().deleteItem(idA);
    const deletedAt = new Date().toISOString();

    // Build manifests with tombstone
    const manifestAWithTombstone: SyncManifest = {
      ...manifestA,
      version: 2,
      items: {},
      tombstones: { [idA]: { deletedAt } },
    };

    // Device B still has the item
    const idB = deviceB.getState().addItem({
      type: 'credential',
      name: 'Shared Item',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    const adapterB = new MemoryAdapter();
    const manifestB = await writeToAdapter(deviceB, adapterB);
    const manifestBV2: SyncManifest = { ...manifestB, version: 2, tombstones: {} };

    const merged = mergeManifestsV2(manifestAWithTombstone, manifestBV2);

    // A's item should be tombstoned (A deleted it, B's copy has a different ID so it survives)
    expect(merged.tombstones).toHaveProperty(idA);
    // B's item (different ID) should survive
    expect(merged.items).toHaveProperty(idB);
  });

  it('should keep item when it was updated after deletion on another device', async () => {
    const earlier = new Date(Date.now() - 5000).toISOString();
    const later = new Date(Date.now() + 5000).toISOString();

    const localManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: { shared: { updatedAt: later, hash: 'updated-hash' } },
      tombstones: {},
    };

    const remoteManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: { shared: { deletedAt: earlier } },
    };

    const merged = mergeManifestsV2(localManifest, remoteManifest);

    // Item updated after deletion → item survives
    expect(merged.items).toHaveProperty('shared');
    expect(merged.tombstones).not.toHaveProperty('shared');
  });

  it('should handle three-device churn with interleaved operations', async () => {
    const t1 = new Date(Date.now() - 3000).toISOString();
    const t2 = new Date(Date.now() - 2000).toISOString();
    const t3 = new Date(Date.now() - 1000).toISOString();

    // Device A: has items a, b; deleted c
    const manifestA: SyncManifest = {
      version: 2,
      lastModified: t3,
      items: {
        a: { updatedAt: t1, hash: 'ha' },
        b: { updatedAt: t3, hash: 'hb-updated' },
      },
      tombstones: { c: { deletedAt: t2 } },
    };

    // Device B: has items b, c, d
    const manifestB: SyncManifest = {
      version: 2,
      lastModified: t2,
      items: {
        b: { updatedAt: t1, hash: 'hb-old' },
        c: { updatedAt: t1, hash: 'hc' },
        d: { updatedAt: t2, hash: 'hd' },
      },
      tombstones: {},
    };

    const merged = mergeManifestsV2(manifestA, manifestB);

    // a: only in A → preserved
    expect(merged.items).toHaveProperty('a');
    // b: A has later version → A's version wins
    expect(merged.items['b']!.hash).toBe('hb-updated');
    // c: A tombstoned at t2, B has item at t1 → tombstone wins (t2 > t1)
    expect(merged.items).not.toHaveProperty('c');
    expect(merged.tombstones).toHaveProperty('c');
    // d: only in B → preserved
    expect(merged.items).toHaveProperty('d');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/sync-conflict.test.ts`
Expected: PASS (all existing + new tests)

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `pnpm --filter @keykeykey/core test`
Expected: PASS (all tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sync/sync-conflict.test.ts
git commit -m "test(sync): add tombstone conflict simulation for multi-device scenarios"
```

---

## Chunk 9: Final Integration

### Task 9: Build, lint, format, and verify everything

- [ ] **Step 1: Run lint**

Run: `pnpm lint`
Expected: PASS (no errors)

- [ ] **Step 2: Run format**

Run: `pnpm format`
Then: `pnpm format:check`
Expected: PASS (all files formatted)

- [ ] **Step 3: Build all packages**

Run: `pnpm build`
Expected: PASS (no build errors; sync module exports resolve correctly)

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: PASS (all packages)

- [ ] **Step 5: Commit any formatting fixes**

```bash
git add -A
git commit -m "fix(sync): format sync module with Prettier"
```

- [ ] **Step 6: Run coverage on core**

Run: `pnpm --filter @keykeykey/core test:coverage`
Expected: PASS (sync module coverage should be high; adjust if needed)
