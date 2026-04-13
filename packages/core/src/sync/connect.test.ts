import { describe, it, expect, vi } from 'vitest';
import { connectSyncEngine } from './connect.js';
import { SyncEngine } from './core/sync-engine.js';
import { MemoryAdapter } from './adapters/memory-adapter.js';
import { createVaultStore } from '../store/vault-store.js';
import { createVaultHeader } from '../crypto/vault-header.js';
import { generateRecoveryKey } from '../crypto/recovery.js';
import type { Argon2Params } from '../crypto/constants.js';
import { deriveMEK, generateSyncSalt } from './blob/mek.js';

const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };
const TEST_HEADER_BYTES = new Uint8Array(64);

let sharedMek: Uint8Array;
let sharedSalt: Uint8Array;

async function ensureMek() {
  if (!sharedMek) {
    sharedSalt = generateSyncSalt();
    sharedMek = await deriveMEK('test-pass', sharedSalt, TEST_PARAMS);
  }
  return { mek: sharedMek, syncSalt: sharedSalt };
}

async function makeUnlockedStore() {
  const { raw: recoveryRaw } = generateRecoveryKey();
  const { header } = await createVaultHeader('test-pass', recoveryRaw, TEST_PARAMS);
  const store = createVaultStore();
  store.getState().loadHeader(header);
  await store.getState().unlock('test-pass', []);
  return store;
}

async function makeSyncEngine(store: ReturnType<typeof createVaultStore>) {
  const { mek, syncSalt } = await ensureMek();
  return new SyncEngine({
    adapter: new MemoryAdapter(),
    store,
    mek,
    syncSalt,
    vaultHeaderBytes: TEST_HEADER_BYTES,
    argon2Params: TEST_PARAMS,
  });
}

describe('connectSyncEngine', () => {
  it('should schedule sync when items change', async () => {
    const store = await makeUnlockedStore();
    const engine = await makeSyncEngine(store);
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

    await new Promise((r) => setTimeout(r, 10));
    expect(scheduleSpy).toHaveBeenCalled();
    disconnect();
  });

  it('should not schedule sync when engine is syncing', async () => {
    const store = await makeUnlockedStore();
    const engine = await makeSyncEngine(store);
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
    const engine = await makeSyncEngine(store);
    const scheduleSpy = vi.spyOn(engine, 'scheduleSync');

    const disconnect = connectSyncEngine(store, engine);
    store.getState().lock();

    await new Promise((r) => setTimeout(r, 10));
    expect(scheduleSpy).not.toHaveBeenCalled();
    disconnect();
  });

  it('should return a disconnect function that stops syncing', async () => {
    const store = await makeUnlockedStore();
    const engine = await makeSyncEngine(store);
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
