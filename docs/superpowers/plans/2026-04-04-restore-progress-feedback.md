# Restore Progress Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show "Downloading item X of Y" / "Importing item X of Y" progress during vault restore on desktop and mobile.

**Architecture:** Add an `onProgress` callback to `pMap`, thread it through `restoreFromCloud` (core) and `SyncLifecycle`, and consume it in desktop/mobile UI via local React state. Two phases: `'downloading'` (network fetch) and `'importing'` (decrypt + save).

**Tech Stack:** TypeScript, Vitest, React (desktop), React Native (mobile)

---

### Task 1: Add `onProgress` callback to `pMap`

**Files:**

- Modify: `packages/core/src/utils/concurrency.ts`

- [ ] **Step 1: Write the failing test**

Create test file `packages/core/src/utils/concurrency.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { pMap } from './concurrency.js';

describe('pMap', () => {
  it('processes all items with correct results', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await pMap(items, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('respects concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;
    const items = [1, 2, 3, 4, 5, 6];

    await pMap(
      items,
      async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
      },
      2,
    );

    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('calls onProgress after each item completes', async () => {
    const onProgress = vi.fn();
    const items = ['a', 'b', 'c'];

    await pMap(items, async (s) => s.toUpperCase(), 5, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenCalledWith(1, 3);
    expect(onProgress).toHaveBeenCalledWith(2, 3);
    expect(onProgress).toHaveBeenCalledWith(3, 3);
  });

  it('works without onProgress callback', async () => {
    const results = await pMap([1, 2], async (n) => n + 1);
    expect(results).toEqual([2, 3]);
  });

  it('onProgress completed count is monotonically increasing with concurrency=1', async () => {
    const calls: number[] = [];
    await pMap(
      [1, 2, 3, 4],
      async (n) => n,
      1,
      (completed) => calls.push(completed),
    );
    expect(calls).toEqual([1, 2, 3, 4]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @keykeykey/core exec vitest run src/utils/concurrency.test.ts`
Expected: FAIL — `onProgress` is not accepted by `pMap`.

- [ ] **Step 3: Implement `onProgress` in `pMap`**

Edit `packages/core/src/utils/concurrency.ts` to:

```typescript
/**
 * Run async tasks with bounded concurrency, similar to p-map.
 *
 * @param items  - Array of inputs to process
 * @param fn     - Async function to apply to each item
 * @param concurrency - Maximum number of tasks running at once (default 5)
 * @param onProgress  - Called after each item completes with (completedCount, totalCount)
 * @returns Array of results in the same order as the input
 */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 5,
  onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  let completed = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
      completed++;
      onProgress?.(completed, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core exec vitest run src/utils/concurrency.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/utils/concurrency.ts packages/core/src/utils/concurrency.test.ts
git commit -m "feat(core): add onProgress callback to pMap"
```

---

### Task 2: Add progress callback to `restoreFromCloud` (core)

**Files:**

- Modify: `packages/core/src/sync/restore.ts`
- Modify: `packages/core/src/sync/index.ts`
- Modify: `packages/core/src/sync/restore.test.ts`

- [ ] **Step 1: Write the failing test**

Add to bottom of `packages/core/src/sync/restore.test.ts`:

```typescript
it('fires onProgress with downloading phase for each item', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  const { adapter } = await setupAdapter(TEST_PASSWORD, TEST_PARAMS, ids);
  const calls: { phase: string; completed: number; total: number }[] = [];

  await restoreFromCloud(adapter, TEST_PASSWORD, (event) => {
    calls.push({ ...event });
  });

  const downloadCalls = calls.filter((c) => c.phase === 'downloading');
  expect(downloadCalls).toHaveLength(4);
  expect(downloadCalls[downloadCalls.length - 1]).toEqual({
    phase: 'downloading',
    completed: 4,
    total: 4,
  });
});

it('works without onProgress (no regression)', async () => {
  const { adapter } = await setupAdapter();
  const result = await restoreFromCloud(adapter, TEST_PASSWORD);
  expect(result.encryptedItems).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core exec vitest run src/sync/restore.test.ts`
Expected: FAIL — `restoreFromCloud` does not accept a third argument.

- [ ] **Step 3: Add `RestoreProgressEvent` type and `onProgress` parameter**

Edit `packages/core/src/sync/restore.ts`. Add the type after the existing imports:

```typescript
export interface RestoreProgressEvent {
  phase: 'downloading' | 'importing';
  completed: number;
  total: number;
}
```

Update the function signature:

```typescript
export async function restoreFromCloud(
  adapter: ISyncAdapter,
  masterPassword: string,
  onProgress?: (event: RestoreProgressEvent) => void,
): Promise<RestoreFromCloudResult> {
```

Update the `pMap` call for downloading items (the block starting at line 60) to pass the progress callback:

```typescript
results = await pMap(
  itemIds,
  (id) => adapter.readItem(id),
  5,
  onProgress
    ? (completed, total) => onProgress({ phase: 'downloading', completed, total })
    : undefined,
);
```

- [ ] **Step 4: Export `RestoreProgressEvent` from index**

In `packages/core/src/sync/index.ts`, update the restore export line:

```typescript
export { restoreFromCloud } from './restore.js';
export type { RestoreFromCloudResult, RestoreProgressEvent } from './restore.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core exec vitest run src/sync/restore.test.ts`
Expected: All tests PASS (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/restore.ts packages/core/src/sync/index.ts packages/core/src/sync/restore.test.ts
git commit -m "feat(core): add onProgress callback to restoreFromCloud"
```

---

### Task 3: Thread progress through `SyncLifecycle.restoreFromCloud`

**Files:**

- Modify: `packages/core/src/sync/sync-lifecycle.ts`
- Modify: `packages/core/src/sync/sync-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/sync/sync-lifecycle.test.ts`, inside the existing `describe('SyncLifecycle', ...)` block, at the end:

```typescript
describe('restoreFromCloud progress', () => {
  it('fires downloading and importing phases via onProgress', async () => {
    // Setup: create a valid remote vault with 3 items
    const { header: vaultHeader, dek } = await createTestVaultStore();
    const { serializeVaultHeader } = await import('../crypto/vault-header.js');
    const { generateSyncSalt, deriveMEK, encryptVaultBlob } = await import('./vault-blob.js');
    const { MemoryAdapter } = await import('./memory-adapter.js');
    const { VaultItemSchema } = await import('../models/vault-item.js');
    const { generateRecoveryKey } = await import('../crypto/recovery.js');

    const adapter = new MemoryAdapter();
    const recoveryKey = generateRecoveryKey();
    const testParams = { t: 1, m: 8192, p: 1, dkLen: 32 };
    const { header, dek: testDek } = await import('../crypto/vault-header.js').then((m) =>
      m.createVaultHeader(TEST_PASSWORD, recoveryKey.raw, testParams),
    );
    const headerBytes = serializeVaultHeader(header);
    const syncSalt = generateSyncSalt();
    const mek = await deriveMEK(TEST_PASSWORD, syncSalt, testParams);

    const itemIds = ['item-1', 'item-2', 'item-3'];
    const manifest = {
      version: 2 as const,
      lastModified: new Date().toISOString(),
      items: Object.fromEntries(
        itemIds.map((id) => [id, { updatedAt: new Date().toISOString(), hash: `h-${id}` }]),
      ),
    };

    const blobData = encryptVaultBlob(manifest, headerBytes, mek, syncSalt, testParams);
    await adapter.writeVaultBlob(blobData);

    // Write valid VaultItem-shaped encrypted items
    for (const id of itemIds) {
      const item = {
        id,
        type: 'credential',
        name: `Item ${id}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        credential: { username: 'user', password: 'pass', urls: [] },
      };
      const plaintext = new TextEncoder().encode(JSON.stringify(item));
      const encrypted = encrypt(plaintext, testDek);
      await adapter.writeItem(id, encrypted);
    }

    // Patch lifecycle to use our adapter
    const lifecycle = new SyncLifecycle(storage, callbacks);
    const { createAdapterFromConfig } = await import('./sync-config.js');
    vi.spyOn(await import('./sync-config.js'), 'createAdapterFromConfig').mockReturnValue(adapter);

    const calls: { phase: string; completed: number; total: number }[] = [];
    const config: SyncConfig = {
      ...DEFAULT_SYNC_CONFIG,
      provider: 'webdav',
      webdavUrl: 'https://example.com/dav',
      masterPassword: TEST_PASSWORD,
    };

    const result = await lifecycle.restoreFromCloud(config, TEST_PASSWORD, (event) => {
      calls.push({ ...event });
    });

    expect(result.success).toBe(true);
    const downloadCalls = calls.filter((c) => c.phase === 'downloading');
    const importCalls = calls.filter((c) => c.phase === 'importing');
    expect(downloadCalls.length).toBe(3);
    expect(importCalls.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core exec vitest run src/sync/sync-lifecycle.test.ts`
Expected: FAIL — `restoreFromCloud` on `SyncLifecycle` does not accept a third argument.

- [ ] **Step 3: Implement the progress threading**

In `packages/core/src/sync/sync-lifecycle.ts`:

Add the import for `RestoreProgressEvent` at the top, alongside the existing `restoreFromCloud` import:

```typescript
import type { RestoreProgressEvent } from './restore.js';
```

Update the method signature (around line 325):

```typescript
  async restoreFromCloud(
    config: SyncConfig,
    masterPassword: string,
    onProgress?: (event: RestoreProgressEvent) => void,
  ): Promise<{ success: boolean; error?: string; itemCount?: number }> {
```

Pass `onProgress` to `restoreFromCloudCore` (around line 336):

```typescript
const result = await restoreFromCloudCore(adapter, masterPassword, onProgress);
```

Add progress to the importing `pMap` loop (around line 346). Replace the existing `pMap` call:

```typescript
let importedCount = 0;
const importTotal = result.encryptedItems.length;
await pMap(result.encryptedItems, async (encBytes) => {
  const plainBytes = decrypt(encBytes, dek);
  const item = VaultItemSchema.parse(JSON.parse(new TextDecoder().decode(plainBytes)));
  await this._storage.saveEncryptedItem(
    item.id,
    item.type,
    toBase64(encBytes),
    item.createdAt,
    item.updatedAt,
  );
  importedCount++;
  onProgress?.({ phase: 'importing', completed: importedCount, total: importTotal });
});
```

- [ ] **Step 4: Export `RestoreProgressEvent` from sync-lifecycle re-exports if needed**

No change needed — it's already exported from `packages/core/src/sync/index.ts` (Task 2, Step 4).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core exec vitest run src/sync/sync-lifecycle.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Run all core tests to check for regressions**

Run: `pnpm --filter @keykeykey/core test`
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync/sync-lifecycle.ts packages/core/src/sync/sync-lifecycle.test.ts
git commit -m "feat(core): thread onProgress through SyncLifecycle.restoreFromCloud"
```

---

### Task 4: Desktop — progress UI in RestoreScreen

**Files:**

- Modify: `apps/desktop/src/lib/vault-context.tsx`
- Modify: `apps/desktop/src/screens/RestoreScreen.tsx`

- [ ] **Step 1: Update vault context to accept and forward `onProgress`**

In `apps/desktop/src/lib/vault-context.tsx`, add the import:

```typescript
import type { RestoreProgressEvent } from '@keykeykey/core/sync';
```

Update the `VaultContextType` type's `restoreFromCloud` signature (around line 96):

```typescript
restoreFromCloud: (
  syncConfig: SyncConfig,
  masterPassword: string,
  onProgress?: (event: RestoreProgressEvent) => void,
) => Promise<{ success: boolean; error?: string; itemCount?: number }>;
```

Update the `restoreFromCloudAction` callback (around line 452) to accept and forward `onProgress`:

```typescript
const restoreFromCloudAction = useCallback(
  async (
    config: SyncConfig,
    masterPassword: string,
    onProgress?: (event: RestoreProgressEvent) => void,
  ) => {
    const lifecycle = getOrCreateLifecycle();
    const result = await lifecycle.restoreFromCloud(config, masterPassword, onProgress);
```

(The rest of `restoreFromCloudAction` stays the same.)

- [ ] **Step 2: Add progress state to RestoreScreen**

In `apps/desktop/src/screens/RestoreScreen.tsx`, add the import:

```typescript
import type { RestoreProgressEvent } from '@keykeykey/core/sync';
```

Add state near the other state declarations (around line 24):

```typescript
const [progress, setProgress] = useState<RestoreProgressEvent | null>(null);
```

- [ ] **Step 3: Pass progress callback in `handleRestore`**

Update `handleRestore` (around line 149). After `setStep('restoring')` and the yield, add the progress callback and reset:

```typescript
const handleRestore = async () => {
  if (!masterPassword) return;
  setError('');
  setProgress(null);
  setStep('restoring');
  // Yield to let spinner render
  await new Promise((r) => setTimeout(r, 50));
  const config = buildSyncConfig();
  const result = await restoreFromCloud(config, masterPassword, (event) => {
    setProgress({ ...event });
  });
```

(The rest of `handleRestore` — success/error handling — stays the same.)

- [ ] **Step 4: Update the restoring UI to show progress text**

Replace the static `<p>` text in the `step === 'restoring'` block (the paragraph that says "Downloading and decrypting your vault...") with:

```tsx
<p
  style={{
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textSecondary,
    marginBottom: 32,
  }}
>
  {progress
    ? progress.phase === 'downloading'
      ? `Downloading item ${progress.completed} of ${progress.total}...`
      : `Importing item ${progress.completed} of ${progress.total}...`
    : 'Connecting to cloud...'}
</p>
```

- [ ] **Step 5: Build desktop to verify no type errors**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/desktop build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/lib/vault-context.tsx apps/desktop/src/screens/RestoreScreen.tsx
git commit -m "feat(desktop): show restore progress as X of Y items"
```

---

### Task 5: Mobile — progress UI in restore screen

**Files:**

- Modify: `apps/mobile/lib/vault-context.tsx`
- Modify: `apps/mobile/app/restore.tsx`

- [ ] **Step 1: Update vault context to accept and forward `onProgress`**

In `apps/mobile/lib/vault-context.tsx`, add the import:

```typescript
import type { RestoreProgressEvent } from '@keykeykey/core/sync';
```

Update the `VaultContextType` type's `restoreFromCloud` signature (around line 94):

```typescript
restoreFromCloud: (
  syncConfig: SyncConfig,
  masterPassword: string,
  onProgress?: (event: RestoreProgressEvent) => void,
) => Promise<{ success: boolean; error?: string; itemCount?: number }>;
```

Update the `restoreFromCloudAction` callback (around line 558) to accept and forward `onProgress`:

```typescript
const restoreFromCloudAction = useCallback(
  async (
    config: SyncConfig,
    masterPassword: string,
    onProgress?: (event: RestoreProgressEvent) => void,
  ) => {
    const lifecycle = getOrCreateLifecycle();
    const result = await lifecycle.restoreFromCloud(config, masterPassword, onProgress);
```

(The rest of `restoreFromCloudAction` stays the same.)

- [ ] **Step 2: Add progress state and callback to restore screen**

In `apps/mobile/app/restore.tsx`, add the import:

```typescript
import type { RestoreProgressEvent } from '@keykeykey/core/sync';
```

Add state near the other state declarations (around line 27):

```typescript
const [progress, setProgress] = useState<RestoreProgressEvent | null>(null);
```

- [ ] **Step 3: Pass progress callback in `handleRestore`**

Update `handleRestore` (around line 60):

```typescript
const handleRestore = async () => {
  if (!masterPassword) return;
  setError('');
  setProgress(null);
  setStep('restoring');
  // Yield to let spinner render
  await new Promise((r) => setTimeout(r, 50));
  const config = buildSyncConfig();
  const result = await restoreFromCloud(config, masterPassword, (event) => {
    setProgress({ ...event });
  });
```

(The rest of `handleRestore` — success/error handling — stays the same.)

- [ ] **Step 4: Update the restoring UI to show progress text**

Replace the static subtitle `<Text>` in the `step === 'restoring'` block (the one that says "Downloading and decrypting your vault...") with:

```tsx
<Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
  {progress
    ? progress.phase === 'downloading'
      ? `Downloading item ${progress.completed} of ${progress.total}...`
      : `Importing item ${progress.completed} of ${progress.total}...`
    : 'Connecting to cloud...'}
</Text>
```

- [ ] **Step 5: Build to verify no type errors**

Run: `pnpm --filter @keykeykey/core build && cd apps/mobile && npx expo export --platform web --output-dir /tmp/mobile-check 2>&1 | head -20`
(Or just run `npx tsc --noEmit` in the mobile dir if available.)
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/vault-context.tsx apps/mobile/app/restore.tsx
git commit -m "feat(mobile): show restore progress as X of Y items"
```
