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
 * Subscribes to store changes and schedules sync when items change,
 * with a guard to prevent sync-originated mutations from re-triggering sync.
 *
 * @returns Disconnect function to unsubscribe.
 */
export function connectSyncEngine(store: MinimalStore, engine: SyncEngine): () => void {
  const unsubscribe = store.subscribe((state, prevState) => {
    if (
      state.items !== prevState.items &&
      state.status === 'unlocked' &&
      !engine.isSyncing()
    ) {
      engine.scheduleSync();
    }
  });

  return unsubscribe;
}
