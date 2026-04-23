# Restore Progress Feedback

**Date:** 2026-04-04
**Scope:** Desktop + Mobile only (extension stays as-is)

## Problem

Restoring a vault from cloud can take a long time on large vaults. Currently the UI shows a generic spinner with "Downloading and decrypting your vault..." and no indication of progress.

## Design

### Core: `pMap` callback

Add an optional `onProgress` callback to `pMap` in `packages/core/src/utils/concurrency.ts`:

```typescript
export async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency?: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<R[]>;
```

Called after each item's `fn` resolves, with `(completedSoFar, totalItems)`.

### Core: `restoreFromCloud` callback

Add an optional `onProgress` callback to `restoreFromCloud` in `packages/core/src/sync/restore.ts`:

```typescript
export interface RestoreProgressEvent {
  phase: 'downloading' | 'importing';
  completed: number;
  total: number;
}

export async function restoreFromCloud(
  adapter: ISyncAdapter,
  masterPassword: string,
  onProgress?: (event: RestoreProgressEvent) => void,
): Promise<RestoreFromCloudResult>;
```

- **Phase `'downloading'`**: fires during the `pMap` over `adapter.readItem(id)` (restore.ts line 60-66).
- The `'importing'` phase is not triggered here — it is handled by `SyncLifecycle`.

### Core: `SyncLifecycle.restoreFromCloud`

Accepts `onProgress` callback and forwards it:

```typescript
async restoreFromCloud(
  config: SyncConfig,
  masterPassword: string,
  onProgress?: (event: RestoreProgressEvent) => void,
): Promise<{ success: boolean; error?: string; itemCount?: number }>
```

- Passes `onProgress` to `restoreFromCloudCore` for the download phase.
- Fires `onProgress({ phase: 'importing', completed, total })` during its own decrypt + save `pMap` loop (sync-lifecycle.ts line 346-356).

### Desktop: `RestoreScreen.tsx`

Add local state:

```typescript
const [progress, setProgress] = useState<{
  phase: 'downloading' | 'importing';
  completed: number;
  total: number;
} | null>(null);
```

Pass `setProgress`-based callback through vault context's `restoreFromCloud`. During the `'restoring'` step, display:

- "Downloading item 3 of 50..." (phase = downloading)
- "Importing item 3 of 50..." (phase = importing)

Replaces the current static "Downloading and decrypting your vault..." text.

### Desktop: `vault-context.tsx`

Update `restoreFromCloud` wrapper to accept and forward the `onProgress` callback.

### Mobile: `restore.tsx`

Same pattern as desktop: local `progress` state, callback passed through vault context, text updates during restore.

### Mobile: `vault-context.tsx`

Update `restoreFromCloud` wrapper to accept and forward the `onProgress` callback.

## What doesn't change

- **Extension**: Keeps current spinner behavior. Adding progress would require port-based messaging through the background worker — not worth the complexity now.
- **Zustand store**: Progress stays local to UI components. No store changes.
- **Return types**: `RestoreFromCloudResult` is unchanged.
- **Concurrency**: `pMap` default concurrency of 5 is unchanged.

## Testing

- **`pMap` tests**: Verify `onProgress` fires with correct `(completed, total)` at each step.
- **`restoreFromCloud` tests**: Verify `'downloading'` phase progress fires with correct counts. Verify callback is optional (no regression).
- **`SyncLifecycle` tests**: Verify `'importing'` phase progress fires with correct counts.

## Files to modify

| File                                                    | Change                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/core/src/utils/concurrency.ts`                | Add `onProgress` param to `pMap`                           |
| `packages/core/src/sync/restore.ts`                     | Add `onProgress` param, export `RestoreProgressEvent` type |
| `packages/core/src/sync/sync-lifecycle.ts`              | Accept and use `onProgress` in `restoreFromCloud`          |
| `apps/desktop/src/lib/vault-context.tsx`                | Forward `onProgress` callback                              |
| `apps/desktop/src/screens/RestoreScreen.tsx`            | Add progress state + UI                                    |
| `apps/mobile/lib/vault-context.tsx`                     | Forward `onProgress` callback                              |
| `apps/mobile/app/restore.tsx`                           | Add progress state + UI                                    |
| `packages/core/src/utils/__tests__/concurrency.test.ts` | Test `onProgress`                                          |
| `packages/core/src/sync/__tests__/restore.test.ts`      | Test progress callback                                     |
