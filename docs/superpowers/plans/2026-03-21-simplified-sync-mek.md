# Simplified Sync MEK Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store the master password in the encrypted SyncConfig so MEK can be derived on any unlock path (password, PIN, biometric), eliminating all edge cases around sync availability.

**Architecture:** Add `masterPassword` to the Zod-validated `SyncConfig` schema. SyncSettingsScreen requires master password input when connecting (validated against vault header before saving). `initSyncAfterUnlock()` reads the password from the decrypted config instead of receiving it as a parameter. Remove `masterPasswordRef`, `mekRef`, `syncSaltRef` as long-lived refs.

**Vault mismatch resolution:** Three-way resolution (replace remote / replace local / merge with LWW) is included in Chunks 7-8.

**Tech Stack:** TypeScript, Zod, Zustand, React, Vitest (desktop), Jest (mobile), XChaCha20-Poly1305, Argon2id

**Spec:** `docs/superpowers/specs/2026-03-21-simplified-sync-mek-design.md`

---

## File Structure

### New files

| File                                   | Responsibility                                        |
| -------------------------------------- | ----------------------------------------------------- |
| `packages/core/src/sync/merge.ts`      | `mergeItemSets()` — LWW merge of two VaultItem arrays |
| `packages/core/src/sync/merge.test.ts` | Tests for merge logic                                 |

### Modified files

| File                                                             | Changes                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/sync/sync-config.ts`                          | Add `masterPassword` to Zod schema                                                                                                                                                                                                                                                                                                   |
| `packages/core/src/sync/sync-config.test.ts`                     | Add round-trip test for config with masterPassword                                                                                                                                                                                                                                                                                   |
| `packages/core/src/sync/index.ts`                                | Export `mergeItemSets`                                                                                                                                                                                                                                                                                                               |
| `apps/desktop/src/lib/vault-context.tsx`                         | Remove `masterPasswordRef`, `mekRef`, `syncSaltRef` refs; simplify `initSyncAfterUnlock`, `saveSyncConfigAction`, `setupVault`, `unlock`, `lock`, `resetVault`, `restoreFromCloudAction`, `replaceRemoteVault`; remove `syncReady`; add `validateMasterPassword`, `mergeRemoteVault`, `replaceLocalVault`; update `VaultContextType` |
| `apps/desktop/src/screens/SyncSettingsScreen.tsx`                | Add master password input field; remove password prompt modal; update mismatch dialog with 3 options (merge / replace local / replace remote)                                                                                                                                                                                        |
| `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx` | Update tests for master password field; remove modal tests                                                                                                                                                                                                                                                                           |
| `apps/mobile/lib/vault-context.tsx`                              | Implement `initSyncAfterUnlock` with MEK derivation from config; add sync engine lifecycle; add `handleVaultMismatch`                                                                                                                                                                                                                |
| `apps/mobile/lib/sync.ts`                                        | Add `connectSyncEngine` to re-exports                                                                                                                                                                                                                                                                                                |
| `apps/mobile/app/settings/sync.tsx`                              | Add master password input field                                                                                                                                                                                                                                                                                                      |
| `apps/mobile/__tests__/screens/sync-settings.test.tsx`           | Update tests for master password field                                                                                                                                                                                                                                                                                               |

---

## Chunk 1: Core SyncConfig Schema

### Task 1: Add masterPassword to SyncConfigSchema

**Files:**

- Modify: `packages/core/src/sync/sync-config.ts:15-20`
- Modify: `packages/core/src/sync/sync-config.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/core/src/sync/sync-config.test.ts` in the `SyncConfig encryption` describe block, after the existing round-trip tests:

```typescript
it('should round-trip encrypt/decrypt a WebDAV config with masterPassword', () => {
  const config: SyncConfig = {
    provider: 'webdav',
    masterPassword: 'my-secret-password',
    webdav: { url: 'https://dav.example.com', username: 'user', password: 'pass' },
  };
  const encrypted = encryptSyncConfig(config, dek);
  const decrypted = decryptSyncConfig(encrypted, dek);
  expect(decrypted).toEqual(config);
  expect(decrypted.masterPassword).toBe('my-secret-password');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/sync-config.test.ts`
Expected: FAIL — TypeScript error: `masterPassword` does not exist on type `SyncConfig`.

- [ ] **Step 3: Add masterPassword to Zod schema**

In `packages/core/src/sync/sync-config.ts`, update the `SyncConfigSchema` (line 15-20):

```typescript
const SyncConfigSchema = z.object({
  provider: z.enum(['none', 'webdav', 'google-drive', 'icloud']),
  masterPassword: z.string().optional(),
  webdav: z.object({ url: z.string(), username: z.string(), password: z.string() }).optional(),
  googleDrive: z.object({ refreshToken: z.string() }).optional(),
  icloud: z.object({ containerPath: z.string() }).optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/sync-config.test.ts`
Expected: PASS (all tests including the new one).

- [ ] **Step 5: Run all core tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/sync-config.ts packages/core/src/sync/sync-config.test.ts
git commit -m "feat(sync): add masterPassword field to SyncConfig schema"
```

---

## Chunk 2: Desktop Vault Context Simplification

### Task 2: Remove masterPasswordRef, mekRef, syncSaltRef and simplify vault context

**Files:**

- Modify: `apps/desktop/src/lib/vault-context.tsx`

This is the largest change. The goal is to:

1. Remove `masterPasswordRef` (line 135), `mekRef` (line 131), `syncSaltRef` (line 132) as long-lived refs
2. Remove `syncReady` from `VaultContextType` (line 102) and the provider value (line 843)
3. Simplify `initSyncAfterUnlock` to read master password from config instead of parameter
4. Simplify `saveSyncConfigAction` to remove the `masterPassword` parameter
5. Remove MEK pre-derivation from `setupVault`
6. Simplify `lock` and `resetVault` (no more MEK/masterPassword zeroing)
7. Update `unlock`, `unlockWithPin`, `unlockWithBiometric` to all call `initSyncAfterUnlock()` with no args
8. Update `replaceRemoteVault` to derive MEK on-demand from config
9. Update `restoreFromCloudAction` to save masterPassword in config

- [ ] **Step 1: Update VaultContextType**

Remove `syncReady` (line 102) and change `saveSyncConfig` signature (line 100). Add `validateMasterPassword`:

Replace:

```typescript
saveSyncConfig: (config: SyncConfig, masterPassword?: string) => Promise<void>;
/** True when MEK is available (sync engine can be created without password prompt) */
syncReady: boolean;
```

With:

```typescript
saveSyncConfig: (config: SyncConfig) => Promise<void>;
validateMasterPassword: (password: string) => Promise<boolean>;
```

Add `unlockVault` to the `@keykeykey/core` import at the top of the file.

- [ ] **Step 2: Remove long-lived refs**

Remove lines 131-135:

```typescript
const mekRef = useRef<Uint8Array | null>(null);
const syncSaltRef = useRef<Uint8Array | null>(null);
/** Master password held as Uint8Array during unlocked session for on-demand MEK derivation.
 *  Stored as bytes (not a JS string) so it can be zeroed with .fill(0) on lock/reset. */
const masterPasswordRef = useRef<Uint8Array | null>(null);
```

- [ ] **Step 3: Simplify setupVault**

Remove the MEK pre-derivation block (lines 205, 207-211):

```typescript
masterPasswordRef.current = new TextEncoder().encode(masterPassword);

// Pre-derive MEK so sync can be configured immediately without lock/unlock
const syncSalt = generateSyncSalt();
const mek = await deriveMEK(masterPassword, syncSalt, header.argon2Params);
mekRef.current = mek;
syncSaltRef.current = syncSalt;
```

Remove the `masterPasswordRef.current` line and the entire MEK pre-derivation block. No replacement needed — sync will be configured later via the sync settings screen which collects the master password.

- [ ] **Step 4: Simplify lock**

Replace the lock function (lines 219-236) with:

```typescript
const lock = useCallback(() => {
  syncDisconnectRef.current?.();
  syncDisconnectRef.current = null;
  syncEngineRef.current = null;
  setSyncConfig(null);
  storeRef.current.getState().lock();
  setItems([]);
  setStatus('locked');
}, []);
```

Removed: `mekRef` zeroing, `syncSaltRef` clearing, `masterPasswordRef` zeroing.

- [ ] **Step 5: Rewrite initSyncAfterUnlock**

Replace the entire `initSyncAfterUnlock` (lines 325-390) with:

```typescript
const initSyncAfterUnlock = useCallback(async () => {
  const dek = storeRef.current.getState().getDEK();
  const config = await loadSyncConfigFromFile(dek);
  setSyncConfig(config);
  setVaultMismatchInfo(null);

  if (config.provider === 'none' || !config.masterPassword) return;

  const urlPrefix = config.provider === 'webdav' && config.webdav ? config.webdav.url : null;
  await setSyncUrlPrefix(urlPrefix);

  const header = storeRef.current.getState().header!;
  const vaultHeaderBytes = serializeVaultHeader(header);

  // Determine sync salt from remote preamble or generate new
  const adapter = createAdapterFromConfig(config, {});
  if (!adapter) return;

  let syncSalt: Uint8Array;
  let mekArgon2Params = header.argon2Params;
  try {
    const remoteBlob = await adapter.readVaultBlob();
    if (remoteBlob && remoteBlob.length >= PREAMBLE_SIZE) {
      const preamble = readPreambleFromBlob(remoteBlob);
      validateArgon2Params(preamble.argon2Params);
      syncSalt = preamble.syncSalt;
      mekArgon2Params = preamble.argon2Params;
    } else {
      syncSalt = generateSyncSalt();
    }
  } catch {
    syncSalt = generateSyncSalt();
  }

  const mek = await deriveMEK(config.masterPassword, syncSalt, mekArgon2Params);

  const engine = createSyncEngineFromConfig(
    config,
    syncableStore,
    {},
    mek,
    syncSalt,
    vaultHeaderBytes,
    header.argon2Params,
    handleVaultMismatch,
  );
  if (engine) {
    syncEngineRef.current = engine;
    syncDisconnectRef.current = initSyncEngine(engine, storeRef.current);
  }
}, [syncableStore, handleVaultMismatch]);
```

Key change: reads `config.masterPassword` instead of receiving it as a parameter. No `mekRef`/`syncSaltRef` storage — MEK is a local variable.

- [ ] **Step 6: Update unlock**

Replace the `unlock` function (lines 392-403):

```typescript
const unlock = useCallback(
  async (masterPassword: string) => {
    const storedItems = await loadAllEncryptedItems();
    const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
    await storeRef.current.getState().unlock(masterPassword, encryptedArrays);
    syncItems();
    setStatus('unlocked');
    await initSyncAfterUnlock();
  },
  [syncItems, initSyncAfterUnlock],
);
```

Removed: `masterPasswordRef` assignment and `masterPassword` argument to `initSyncAfterUnlock`.

- [ ] **Step 7: Update unlockWithPin and unlockWithBiometric**

In `unlockWithPin` (line 432), the call is already `await initSyncAfterUnlock()` — no change needed. Remove the comment on lines 430-431:

```typescript
// PIN unlock has no master password — MEK derivation is skipped, so the sync
// engine won't be created. Sync resumes on next master password unlock.
```

In `unlockWithBiometric` (line 466), the call is already `await initSyncAfterUnlock()` — no change needed. Remove the comment on lines 464-465:

```typescript
// Biometric unlock has no master password — MEK derivation is skipped, so the
// sync engine won't be created. Sync resumes on next master password unlock.
```

- [ ] **Step 8: Rewrite saveSyncConfigAction**

Replace the entire `saveSyncConfigAction` (lines 489-561) with:

```typescript
const saveSyncConfigAction = useCallback(
  async (config: SyncConfig) => {
    const dek = storeRef.current.getState().getDEK();
    await saveSyncConfigToFile(config, dek);
    setSyncConfig(config);
    setVaultMismatchInfo(null);

    // Teardown old engine
    syncDisconnectRef.current?.();
    syncDisconnectRef.current = null;
    syncEngineRef.current = null;

    if (config.provider !== 'none' && config.masterPassword) {
      const urlPrefix = config.provider === 'webdav' && config.webdav ? config.webdav.url : null;
      await setSyncUrlPrefix(urlPrefix);

      const header = storeRef.current.getState().header!;
      const vaultHeaderBytes = serializeVaultHeader(header);
      const adapter = createAdapterFromConfig(config, {});

      let syncSalt: Uint8Array;
      let mekArgon2Params = header.argon2Params;
      if (adapter) {
        try {
          const remoteBlob = await adapter.readVaultBlob();
          if (remoteBlob && remoteBlob.length >= PREAMBLE_SIZE) {
            const preamble = readPreambleFromBlob(remoteBlob);
            validateArgon2Params(preamble.argon2Params);
            syncSalt = preamble.syncSalt;
            mekArgon2Params = preamble.argon2Params;
          } else {
            syncSalt = generateSyncSalt();
          }
        } catch {
          syncSalt = generateSyncSalt();
        }
      } else {
        syncSalt = generateSyncSalt();
      }

      const mek = await deriveMEK(config.masterPassword, syncSalt, mekArgon2Params);

      const engine = createSyncEngineFromConfig(
        config,
        syncableStore,
        {},
        mek,
        syncSalt,
        vaultHeaderBytes,
        header.argon2Params,
        handleVaultMismatch,
      );
      if (engine) {
        syncEngineRef.current = engine;
        syncDisconnectRef.current = connectSyncEngine(storeRef.current, engine);
      }
    } else {
      await setSyncUrlPrefix(null);
    }
  },
  [syncableStore, handleVaultMismatch],
);
```

Key change: no `masterPassword` parameter, reads from `config.masterPassword`. No `mekRef`/`syncSaltRef` storage.

- [ ] **Step 9: Update replaceRemoteVault**

In `replaceRemoteVault` (lines 257-323), replace the MEK availability check (lines 265-266):

```typescript
if (!mekRef.current || !syncSaltRef.current)
  return { success: false, error: 'MEK not available — lock and unlock first' };
```

With on-demand MEK derivation from the sync config:

```typescript
if (!config.masterPassword)
  return { success: false, error: 'Master password not available in sync config' };

// Derive MEK on demand from sync config
const header = storeRef.current.getState().header!;
const syncSalt = generateSyncSalt();
const mek = await deriveMEK(config.masterPassword, syncSalt, header.argon2Params);
```

Then update the references from `mekRef.current`/`syncSaltRef.current` to `mek`/`syncSalt` throughout the function. Also update the engine creation block (lines 299-312) to use the local `mek` and `syncSalt` variables.

After the `deleteCloudVault` call, update to:

```typescript
const vaultHeaderBytes = serializeVaultHeader(header);
await deleteCloudVault(adapter, mek, syncSalt, vaultHeaderBytes, header.argon2Params);
```

And the engine creation:

```typescript
const engine = createSyncEngineFromConfig(
  config,
  syncableStore,
  {},
  mek,
  syncSalt,
  vaultHeaderBytes,
  header.argon2Params,
  handleVaultMismatch,
);
```

- [ ] **Step 10: Update restoreFromCloudAction**

In `restoreFromCloudAction` (lines 575-653), make two changes:

1. Save masterPassword into the sync config (line 614, replace):

```typescript
await saveSyncConfigToFile(config, dek);
```

With:

```typescript
const configWithPassword: SyncConfig = { ...config, masterPassword };
await saveSyncConfigToFile(configWithPassword, dek);
setSyncConfig(configWithPassword);
```

2. Remove line 598 (`masterPasswordRef.current = new TextEncoder().encode(masterPassword);`)

3. In the error catch block (lines 644-648), remove the `mekRef` cleanup:

```typescript
if (mekRef.current) {
  mekRef.current.fill(0);
  mekRef.current = null;
}
syncSaltRef.current = null;
```

Replace with just:

```typescript
// MEK is a local variable, will be GC'd
```

- [ ] **Step 11: Simplify resetVault**

In `resetVault` (lines 655-724), remove lines 660-668:

```typescript
if (mekRef.current) {
  mekRef.current.fill(0);
  mekRef.current = null;
}
syncSaltRef.current = null;
if (masterPasswordRef.current) {
  masterPasswordRef.current.fill(0);
  masterPasswordRef.current = null;
}
```

- [ ] **Step 12: Add validateMasterPassword callback**

Add after `triggerSync`:

```typescript
const validateMasterPassword = useCallback(async (password: string): Promise<boolean> => {
  const header = storeRef.current.getState().header;
  if (!header) return false;
  try {
    await unlockVault(header, password);
    return true;
  } catch {
    return false;
  }
}, []);
```

- [ ] **Step 13: Update provider value**

In the provider value block (line 843), remove `syncReady`:

```typescript
        syncReady: mekRef.current !== null || masterPasswordRef.current !== null,
```

And add `validateMasterPassword` to the provider value:

```typescript
        validateMasterPassword,
```

- [ ] **Step 14: Clean up unused imports**

Remove unused imports that were only needed for the removed refs. Check if `deriveMEK`, `generateSyncSalt`, `readPreambleFromBlob`, `validateArgon2Params`, `PREAMBLE_SIZE`, `createAdapterFromConfig` are still used — they are (in `initSyncAfterUnlock`, `saveSyncConfigAction`, `replaceRemoteVault`). Keep them.

- [ ] **Step 15: Run desktop tests**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/desktop test`
Expected: Some tests may fail due to `syncReady` removal — we'll fix those in Task 4.

- [ ] **Step 16: Commit**

```bash
git add apps/desktop/src/lib/vault-context.tsx
git commit -m "refactor(desktop): simplify vault context — read master password from SyncConfig, remove MEK/password refs"
```

---

## Chunk 3: Desktop SyncSettingsScreen — Master Password Input

### Task 3: Add master password field, remove password prompt modal

**Files:**

- Modify: `apps/desktop/src/screens/SyncSettingsScreen.tsx`

- [ ] **Step 1: Remove password prompt modal and syncReady logic**

Remove from the destructuring (around line 24):

```typescript
  const { ..., syncReady, ... } = useVault();
```

Remove state variables (around lines 39-41):

```typescript
const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
const [vaultPassword, setVaultPassword] = useState('');
const [pendingConfig, setPendingConfig] = useState<SyncConfig | null>(null);
```

Remove the `handlePasswordConfirm` function (around lines 107-113).

Remove the password modal JSX (around lines 569-640).

- [ ] **Step 2: Add master password state variable**

Add alongside the other WebDAV state variables:

```typescript
const [masterPassword, setMasterPassword] = useState('');
```

- [ ] **Step 3: Update canConnect validation**

Replace the existing `canConnect` (around line 60):

```typescript
const canConnect =
  syncProvider === 'webdav' &&
  webdavUrl.trim() !== '' &&
  webdavUsername.trim() !== '' &&
  webdavPassword.trim() !== '';
```

With:

```typescript
const canConnect =
  syncProvider === 'webdav' &&
  webdavUrl.trim() !== '' &&
  webdavUsername.trim() !== '' &&
  webdavPassword.trim() !== '' &&
  masterPassword.trim() !== '';
```

- [ ] **Step 4: Add master password validation import**

Add `unlockVault` to the existing `@keykeykey/core` import at the top of the file:

```typescript
import {
  // ... existing imports ...
  unlockVault,
} from '@keykeykey/core';
```

`unlockVault(header, masterPassword)` derives the KEK from the master password and attempts to unwrap the DEK. It throws if the password is wrong. We use it to validate the master password before saving it to the sync config.

- [ ] **Step 5: Simplify handleConnect with validation**

Replace `handleConnect` (around lines 96-105):

```typescript
const handleConnect = async () => {
  if (!canConnect) return;
  setConnecting(true);
  setSyncError(null);
  try {
    // Validate master password against vault header before saving
    const header = storeRef.current?.getState().header;
    if (header) {
      try {
        await unlockVault(header, masterPassword);
      } catch {
        setSyncError('Incorrect master password');
        setConnecting(false);
        return;
      }
    }

    const config: SyncConfig = {
      provider: syncProvider,
      masterPassword,
      webdav: { url: webdavUrl, username: webdavUsername, password: webdavPassword },
    };
    await saveSyncConfig(config);
    const result = await triggerSync();
    if (result.error) {
      setSyncError(result.error);
    } else {
      setLastSynced(result.lastSynced);
    }
  } catch (e) {
    setSyncError(e instanceof Error ? e.message : 'Failed to connect');
  } finally {
    setConnecting(false);
  }
};
```

Key changes: validates master password against vault header before saving. `masterPassword` is included in the config. No `syncReady` check. No password prompt modal.

Note: `storeRef` is not directly available in SyncSettingsScreen. The validation needs access to the vault header. There are two approaches:

1. Expose a `validateMasterPassword(password: string) => Promise<boolean>` function from vault context
2. Use `unlockVault` directly by adding the vault store header to the context

Approach 1 is cleaner. Add to `VaultContextType`:

```typescript
validateMasterPassword: (password: string) => Promise<boolean>;
```

And implement in VaultProvider:

```typescript
const validateMasterPassword = useCallback(async (password: string): Promise<boolean> => {
  const header = storeRef.current.getState().header;
  if (!header) return false;
  try {
    await unlockVault(header, password);
    return true;
  } catch {
    return false;
  }
}, []);
```

Then in SyncSettingsScreen's handleConnect:

```typescript
// Validate master password
const valid = await validateMasterPassword(masterPassword);
if (!valid) {
  setSyncError('Incorrect master password');
  setConnecting(false);
  return;
}
```

- [ ] **Step 6: Update handleDisconnect**

Add `setMasterPassword('')` to the disconnect handler.

- [ ] **Step 7: Add master password TextInput to the WebDAV form**

In the WebDAV config form section (after the Password TextInput, around line 339), add:

```tsx
<TextInput
  label="Master Password"
  value={masterPassword}
  onChangeText={setMasterPassword}
  placeholder="Enter your vault master password"
  secureTextEntry
  data-testid="sync-master-password"
/>
```

- [ ] **Step 8: Run desktop build**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/desktop build`
Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/screens/SyncSettingsScreen.tsx
git commit -m "feat(desktop): add master password field to sync settings, remove password prompt modal"
```

---

## Chunk 4: Desktop Test Updates

### Task 4: Update SyncSettingsScreen and SettingsScreen tests

**Files:**

- Modify: `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx`
- Modify: `apps/desktop/src/screens/__tests__/SettingsScreen.test.tsx`

- [ ] **Step 1: Update SyncSettingsScreen test mock**

In `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx`, update the `useVault` mock to remove `syncReady` and change `saveSyncConfig` signature:

Find the mock setup and remove `syncReady: true`. The mock's `saveSyncConfig` should now only take `(config)`, not `(config, masterPassword?)`.

- [ ] **Step 2: Update test assertions for master password**

Update the "calls saveSyncConfig with WebDAV config" test. After filling WebDAV fields, also fill the master password field:

```typescript
fireEvent.change(screen.getByTestId('sync-master-password'), {
  target: { value: 'my-master-password' },
});
```

And update the assertion to expect `masterPassword` in the config:

```typescript
await waitFor(() => {
  expect(mockSaveSyncConfig).toHaveBeenCalledWith({
    provider: 'webdav',
    masterPassword: 'my-master-password',
    webdav: { url: 'https://dav.example.com', username: 'user', password: 'pass' },
  });
});
```

- [ ] **Step 3: Add test for Connect disabled without master password**

```typescript
it('Connect button is disabled until master password is filled', () => {
  renderSyncSettings();
  const select = screen.getByRole('combobox');
  fireEvent.change(select, { target: { value: 'webdav' } });

  // Fill WebDAV fields but not master password
  fireEvent.change(screen.getByPlaceholderText(/dav\.example\.com/), {
    target: { value: 'https://dav.example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('Username'), {
    target: { value: 'user' },
  });
  fireEvent.change(screen.getByPlaceholderText('Password'), {
    target: { value: 'pass' },
  });

  // Still disabled — missing master password
  expect(screen.getByText('Connect').closest('button')).toHaveProperty('disabled', true);
});
```

- [ ] **Step 4: Remove password prompt modal tests (if any exist)**

Search for and remove any tests related to `showPasswordPrompt`, `vaultPassword`, `handlePasswordConfirm`.

- [ ] **Step 5: Update SettingsScreen test mock**

In `apps/desktop/src/screens/__tests__/SettingsScreen.test.tsx`, if the mock includes `syncReady`, remove it.

- [ ] **Step 6: Run all desktop tests**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/desktop test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx apps/desktop/src/screens/__tests__/SettingsScreen.test.tsx
git commit -m "test(desktop): update sync settings tests for master password field, remove syncReady"
```

---

## Chunk 5: Mobile Vault Context — Implement Sync with MEK from Config

### Task 5: Wire sync engine in mobile vault context

**Files:**

- Modify: `apps/mobile/lib/vault-context.tsx`

- [ ] **Step 1: Add sync imports**

Add these imports to `apps/mobile/lib/vault-context.tsx`. The file already imports `SyncConfig`, `SyncableStore`, `SyncEngine` from `@keykeykey/core/sync` (lines 45-46). Add the missing ones:

```typescript
import {
  deriveMEK,
  generateSyncSalt,
  readPreambleFromBlob,
  validateArgon2Params,
  PREAMBLE_SIZE,
  createAdapterFromConfig,
  connectSyncEngine,
} from '@keykeykey/core/sync';
import type { VaultMismatchInfo } from '@keykeykey/core/sync';
import { createSyncEngineFromConfig, initSyncEngine } from './sync';
```

Also add `connectSyncEngine` to the re-exports in `apps/mobile/lib/sync.ts` (line 6):

```typescript
export {
  createSyncEngineFromConfig,
  initSyncEngine,
  connectSyncEngine,
} from '@keykeykey/core/sync';
```

- [ ] **Step 2: Add handleVaultMismatch callback**

Mobile's vault context does not have `handleVaultMismatch`. Add it after the `lock` callback (after line 194), along with the state variable:

Add state (after line 105):

```typescript
const [vaultMismatchInfo, setVaultMismatchInfo] = useState<VaultMismatchInfo | null>(null);
```

Add callback (after `lock`):

```typescript
const handleVaultMismatch = useCallback((info: VaultMismatchInfo) => {
  syncDisconnectRef.current?.();
  syncDisconnectRef.current = null;
  syncEngineRef.current = null;
  setVaultMismatchInfo(info);
}, []);
```

Note: `syncableStore` already exists at line 114 — no need to add it.

- [ ] **Step 3: Rewrite initSyncAfterUnlock**

Replace the TODO-stub `initSyncAfterUnlock` (lines 196-208) with:

```typescript
const initSyncAfterUnlock = useCallback(async () => {
  const dek = storeRef.current.getState().getDEK();
  const config = await loadSyncConfigFromFile(dek);
  setSyncConfig(config);
  setVaultReplaced(false);

  if (config.provider === 'none' || !config.masterPassword) return;

  const header = storeRef.current.getState().header!;
  const vaultHeaderBytes = serializeVaultHeader(header);

  const adapter = createAdapterFromConfig(config, {});
  if (!adapter) return;

  let syncSalt: Uint8Array;
  let mekArgon2Params = header.argon2Params;
  try {
    const remoteBlob = await adapter.readVaultBlob();
    if (remoteBlob && remoteBlob.length >= PREAMBLE_SIZE) {
      const preamble = readPreambleFromBlob(remoteBlob);
      validateArgon2Params(preamble.argon2Params);
      syncSalt = preamble.syncSalt;
      mekArgon2Params = preamble.argon2Params;
    } else {
      syncSalt = generateSyncSalt();
    }
  } catch {
    syncSalt = generateSyncSalt();
  }

  const mek = await deriveMEK(config.masterPassword, syncSalt, mekArgon2Params);

  const engine = createSyncEngineFromConfig(
    config,
    syncableStore,
    {},
    mek,
    syncSalt,
    vaultHeaderBytes,
    header.argon2Params,
    handleVaultMismatch,
  );
  if (engine) {
    syncEngineRef.current = engine;
    syncDisconnectRef.current = initSyncEngine(engine, storeRef.current);
  }
}, [syncableStore, handleVaultMismatch]);
```

- [ ] **Step 4: Rewrite saveSyncConfigAction**

Replace the TODO-stub `saveSyncConfigAction` (lines 398-413) with:

```typescript
const saveSyncConfigAction = useCallback(
  async (config: SyncConfig) => {
    const dek = storeRef.current.getState().getDEK();
    await saveSyncConfigToFile(config, dek);
    setSyncConfig(config);

    // Teardown old engine
    syncDisconnectRef.current?.();
    syncDisconnectRef.current = null;
    syncEngineRef.current = null;

    if (config.provider !== 'none' && config.masterPassword) {
      const header = storeRef.current.getState().header!;
      const vaultHeaderBytes = serializeVaultHeader(header);
      const adapter = createAdapterFromConfig(config, {});

      let syncSalt: Uint8Array;
      let mekArgon2Params = header.argon2Params;
      if (adapter) {
        try {
          const remoteBlob = await adapter.readVaultBlob();
          if (remoteBlob && remoteBlob.length >= PREAMBLE_SIZE) {
            const preamble = readPreambleFromBlob(remoteBlob);
            validateArgon2Params(preamble.argon2Params);
            syncSalt = preamble.syncSalt;
            mekArgon2Params = preamble.argon2Params;
          } else {
            syncSalt = generateSyncSalt();
          }
        } catch {
          syncSalt = generateSyncSalt();
        }
      } else {
        syncSalt = generateSyncSalt();
      }

      const mek = await deriveMEK(config.masterPassword, syncSalt, mekArgon2Params);

      const engine = createSyncEngineFromConfig(
        config,
        syncableStore,
        {},
        mek,
        syncSalt,
        vaultHeaderBytes,
        header.argon2Params,
        handleVaultMismatch,
      );
      if (engine) {
        syncEngineRef.current = engine;
        syncDisconnectRef.current = connectSyncEngine(storeRef.current, engine);
      }
    }
  },
  [syncableStore, handleVaultMismatch],
);
```

- [ ] **Step 5: Run mobile tests**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/mobile test`
Expected: Existing tests pass (sync wiring is additive). Some tests may need mock updates — if tests mock `useVault`, add `vaultMismatchInfo: null` to the mock.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/vault-context.tsx apps/mobile/lib/sync.ts
git commit -m "feat(mobile): implement sync engine with MEK derivation from SyncConfig"
```

---

## Chunk 6: Mobile Sync Settings Screen — Master Password Input

### Task 6: Add master password field to mobile sync settings

**Files:**

- Modify: `apps/mobile/app/settings/sync.tsx`
- Modify: `apps/mobile/__tests__/screens/sync-settings.test.tsx`

- [ ] **Step 1: Add master password state**

In `apps/mobile/app/settings/sync.tsx`, add state variable:

```typescript
const [masterPassword, setMasterPassword] = useState('');
```

- [ ] **Step 2: Update canConnect**

Add `masterPassword.trim() !== ''` to the `canConnect` condition.

- [ ] **Step 3: Include masterPassword in handleConnect config with validation**

In `handleConnect`, add master password validation before building the config. Add `validateMasterPassword` to the `useVault()` destructuring. Then update the function:

```typescript
const handleConnect = async () => {
  if (syncProvider !== 'webdav') return;
  setConnecting(true);
  setSyncError(null);
  try {
    // Validate master password
    const valid = await validateMasterPassword(masterPassword);
    if (!valid) {
      setSyncError('Incorrect master password');
      setConnecting(false);
      return;
    }

    const config: SyncConfig = {
      provider: 'webdav',
      masterPassword,
      webdav: {
        url: webdavUrl.trim(),
        username: webdavUsername.trim(),
        password: webdavPassword,
      },
    };
    await saveSyncConfig(config);
    setLastSynced(new Date().toISOString());
  } catch (e) {
    setSyncError(e instanceof Error ? e.message : 'Failed to connect');
  } finally {
    setConnecting(false);
  }
};
```

Note: Also add `validateMasterPassword` to the mobile `VaultContextType` (line 86) and implement it in the VaultProvider, same as desktop Task 2 Step 12. Import `unlockVault` from `@keykeykey/core`.

- [ ] **Step 4: Clear masterPassword on disconnect**

In `handleDisconnect`, add `setMasterPassword('')`.

- [ ] **Step 5: Add TextInput for master password**

In the WebDAV form section, after the Password TextInput, add:

```tsx
<TextInput
  label="Master Password"
  value={masterPassword}
  onChangeText={setMasterPassword}
  placeholder="Enter your vault master password"
  isPassword
  testID="sync-master-password"
/>
```

- [ ] **Step 6: Update mobile sync settings tests**

In `apps/mobile/__tests__/screens/sync-settings.test.tsx`, update the "calls saveSyncConfig on Connect" test:

Add after filling WebDAV fields:

```typescript
fireEvent.changeText(getByTestId('sync-master-password'), 'my-master-password');
```

Update the assertion:

```typescript
expect(mockSaveSyncConfig).toHaveBeenCalledWith({
  provider: 'webdav',
  masterPassword: 'my-master-password',
  webdav: { url: 'https://dav.example.com', username: 'user', password: 'pass' },
});
```

- [ ] **Step 7: Run mobile tests**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/mobile test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/app/settings/sync.tsx apps/mobile/__tests__/screens/sync-settings.test.tsx
git commit -m "feat(mobile): add master password field to sync settings screen"
```

---

## Chunk 7: Core — Add mergeWithRemoteVault Function

### Task 7: Implement merge logic in core sync module

**Files:**

- Create: `packages/core/src/sync/merge.ts`
- Create: `packages/core/src/sync/merge.test.ts`
- Modify: `packages/core/src/sync/index.ts`

The merge function downloads the remote vault, decrypts its items using the remote DEK (derived from the master password + remote vault header), and returns the decrypted plaintext items. The caller (vault context) then merges them with local items using LWW.

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/sync/merge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mergeItemSets } from './merge.js';
import type { VaultItem } from '../models/vault-item.js';

function makeItem(overrides: Partial<VaultItem> & { id: string }): VaultItem {
  return {
    type: 'credential',
    name: 'Test',
    username: '',
    password: '',
    url: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as VaultItem;
}

describe('mergeItemSets', () => {
  it('should include items only in local', () => {
    const local = [makeItem({ id: 'local-1', name: 'Local Only' })];
    const remote: VaultItem[] = [];
    const result = mergeItemSets(local, remote);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].id).toBe('local-1');
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
  });

  it('should include items only in remote', () => {
    const local: VaultItem[] = [];
    const remote = [makeItem({ id: 'remote-1', name: 'Remote Only' })];
    const result = mergeItemSets(local, remote);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].id).toBe('remote-1');
    expect(result.added).toBe(1);
  });

  it('should take remote item when it has newer updatedAt', () => {
    const local = [makeItem({ id: 'shared-1', name: 'Old', updatedAt: '2026-01-01T00:00:00Z' })];
    const remote = [makeItem({ id: 'shared-1', name: 'New', updatedAt: '2026-02-01T00:00:00Z' })];
    const result = mergeItemSets(local, remote);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].name).toBe('New');
    expect(result.updated).toBe(1);
  });

  it('should keep local item when it has newer updatedAt', () => {
    const local = [
      makeItem({ id: 'shared-1', name: 'Newer Local', updatedAt: '2026-03-01T00:00:00Z' }),
    ];
    const remote = [
      makeItem({ id: 'shared-1', name: 'Older Remote', updatedAt: '2026-01-01T00:00:00Z' }),
    ];
    const result = mergeItemSets(local, remote);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0].name).toBe('Newer Local');
    expect(result.updated).toBe(0);
  });

  it('should keep local item when updatedAt is equal', () => {
    const ts = '2026-01-01T00:00:00Z';
    const local = [makeItem({ id: 'shared-1', name: 'Local', updatedAt: ts })];
    const remote = [makeItem({ id: 'shared-1', name: 'Remote', updatedAt: ts })];
    const result = mergeItemSets(local, remote);
    expect(result.merged[0].name).toBe('Local');
  });

  it('should handle mixed case: some local-only, some remote-only, some shared', () => {
    const local = [
      makeItem({ id: 'a', name: 'Local A', updatedAt: '2026-01-01T00:00:00Z' }),
      makeItem({ id: 'b', name: 'Shared B old', updatedAt: '2026-01-01T00:00:00Z' }),
    ];
    const remote = [
      makeItem({ id: 'b', name: 'Shared B new', updatedAt: '2026-02-01T00:00:00Z' }),
      makeItem({ id: 'c', name: 'Remote C', updatedAt: '2026-01-01T00:00:00Z' }),
    ];
    const result = mergeItemSets(local, remote);
    expect(result.merged).toHaveLength(3);
    expect(result.merged.find((i) => i.id === 'a')!.name).toBe('Local A');
    expect(result.merged.find((i) => i.id === 'b')!.name).toBe('Shared B new');
    expect(result.merged.find((i) => i.id === 'c')!.name).toBe('Remote C');
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/merge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement merge.ts**

Create `packages/core/src/sync/merge.ts`:

```typescript
import type { VaultItem } from '../models/vault-item.js';

export interface MergeResult {
  /** The merged set of items (union of local + remote, LWW per-item). */
  merged: VaultItem[];
  /** Number of remote-only items added. */
  added: number;
  /** Number of items where remote was newer and replaced local. */
  updated: number;
}

/**
 * Merge two sets of vault items using Last-Write-Wins per-item.
 *
 * For items present on both sides (matched by ID), the one with the most
 * recent `updatedAt` wins. Ties go to the local item.
 * Items unique to either side are included in the result.
 *
 * @param localItems - Items from the local vault
 * @param remoteItems - Items from the remote vault (already decrypted)
 * @returns The merged item set with counts of added/updated items
 */
export function mergeItemSets(localItems: VaultItem[], remoteItems: VaultItem[]): MergeResult {
  const merged = new Map<string, VaultItem>();
  let added = 0;
  let updated = 0;

  // Start with all local items
  for (const item of localItems) {
    merged.set(item.id, item);
  }

  // Merge remote items
  for (const remoteItem of remoteItems) {
    const localItem = merged.get(remoteItem.id);
    if (!localItem) {
      // Remote-only item: add it
      merged.set(remoteItem.id, remoteItem);
      added++;
    } else if (new Date(remoteItem.updatedAt) > new Date(localItem.updatedAt)) {
      // Remote is newer: replace
      merged.set(remoteItem.id, remoteItem);
      updated++;
    }
    // else: local is newer or same, keep local
  }

  return { merged: Array.from(merged.values()), added, updated };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core vitest run src/sync/merge.test.ts`
Expected: PASS

- [ ] **Step 5: Export from index.ts**

Add to `packages/core/src/sync/index.ts`:

```typescript
export { mergeItemSets } from './merge.js';
export type { MergeResult } from './merge.js';
```

- [ ] **Step 6: Run all core tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync/merge.ts packages/core/src/sync/merge.test.ts packages/core/src/sync/index.ts
git commit -m "feat(sync): add mergeItemSets function with LWW conflict resolution"
```

---

## Chunk 8: Desktop — Vault Mismatch Resolution (Replace Local + Merge)

### Task 8: Add mergeRemoteVault and replaceLocalVault to desktop vault context, update mismatch dialog

**Files:**

- Modify: `apps/desktop/src/lib/vault-context.tsx`
- Modify: `apps/desktop/src/screens/SyncSettingsScreen.tsx`

The vault store's `addItem` generates new UUIDs and `updateItem` overwrites `updatedAt` with `now`. For merge, we need to import items preserving their original IDs and timestamps. We'll use `setState` directly on the Zustand store to inject merged items.

- [ ] **Step 1: Add mergeRemoteVault to VaultContextType**

In `apps/desktop/src/lib/vault-context.tsx`, add to `VaultContextType`:

```typescript
mergeRemoteVault: () =>
  Promise<{ success: boolean; error?: string; added?: number; updated?: number }>;
```

- [ ] **Step 2: Add mergeItemSets import**

Add to the `@keykeykey/core/sync` import:

```typescript
import { mergeItemSets } from '@keykeykey/core/sync';
```

- [ ] **Step 3: Implement mergeRemoteVault callback**

Add after `replaceRemoteVault`:

```typescript
const mergeRemoteVault = useCallback(async (): Promise<{
  success: boolean;
  error?: string;
  added?: number;
  updated?: number;
}> => {
  try {
    const config = syncConfig;
    if (!config || config.provider === 'none' || !config.masterPassword)
      return { success: false, error: 'No sync configured or master password missing' };

    const adapter = createAdapterFromConfig(config, {});
    if (!adapter) return { success: false, error: 'Could not create adapter' };

    // 1. Download and decrypt remote vault
    const { header: remoteHeader, encryptedItems } = await restoreFromCloudCore(
      adapter,
      config.masterPassword,
    );

    // 2. Decrypt remote items using a temporary store with the remote DEK
    const tempStore = createVaultStore();
    tempStore.getState().loadHeader(remoteHeader);
    await tempStore.getState().unlock(config.masterPassword, encryptedItems);
    const remoteItems = tempStore.getState().items;

    // 3. Merge remote items into local items (LWW)
    const localItems = storeRef.current.getState().items;
    const { merged, added, updated } = mergeItemSets(localItems, remoteItems);

    // 4. Replace local items with merged set (preserves original IDs and timestamps)
    storeRef.current.setState({ items: merged });

    // 5. Persist all merged items to local storage
    for (const item of merged) {
      const encrypted = storeRef.current.getState().encryptItem(item);
      await saveEncryptedItem(
        item.id,
        item.type,
        toBase64(encrypted),
        item.createdAt,
        item.updatedAt,
      );
    }

    // 6. Update UI
    syncItems();
    setVaultMismatchInfo(null);

    // 7. Re-create sync engine and trigger sync to push merged state
    syncDisconnectRef.current?.();
    syncDisconnectRef.current = null;
    syncEngineRef.current = null;

    // Generate new sync salt for the merged vault
    const header = storeRef.current.getState().header!;
    const syncSalt = generateSyncSalt();
    const mek = await deriveMEK(config.masterPassword, syncSalt, header.argon2Params);
    const vaultHeaderBytes = serializeVaultHeader(header);

    const engine = createSyncEngineFromConfig(
      config,
      syncableStore,
      {},
      mek,
      syncSalt,
      vaultHeaderBytes,
      header.argon2Params,
      handleVaultMismatch,
    );
    if (engine) {
      syncEngineRef.current = engine;
      syncDisconnectRef.current = initSyncEngine(engine, storeRef.current);
    }

    return { success: true, added, updated };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}, [syncConfig, syncableStore, handleVaultMismatch, syncItems]);
```

- [ ] **Step 4: Update replaceRemoteVault to use restoreFromCloudAction for replace-local**

The existing "Restore Remote Vault" button navigates to `/restore`. Instead, we can reuse `restoreFromCloudAction` directly. Add to `VaultContextType` if not present:

```typescript
replaceLocalVault: () => Promise<{ success: boolean; error?: string }>;
```

Implement:

```typescript
const replaceLocalVault = useCallback(async (): Promise<{
  success: boolean;
  error?: string;
}> => {
  try {
    const config = syncConfig;
    if (!config || config.provider === 'none' || !config.masterPassword)
      return { success: false, error: 'No sync configured or master password missing' };

    // Reuse restoreFromCloud — it downloads remote vault and replaces local
    const result = await restoreFromCloudAction(config, config.masterPassword);
    if (result.success) {
      setVaultMismatchInfo(null);
    }
    return result;
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}, [syncConfig, restoreFromCloudAction]);
```

- [ ] **Step 5: Add to provider value**

Add `mergeRemoteVault` and `replaceLocalVault` to the provider value block.

- [ ] **Step 6: Update SyncSettingsScreen mismatch dialog**

In `apps/desktop/src/screens/SyncSettingsScreen.tsx`:

Add `mergeRemoteVault` and `replaceLocalVault` to the `useVault()` destructuring.

Add state for merge/replace operations:

```typescript
const [merging, setMerging] = useState(false);
const [replacingLocal, setReplacingLocal] = useState(false);
```

Add handler functions:

```typescript
const handleMismatchMerge = async () => {
  setMerging(true);
  setSyncError(null);
  try {
    const result = await mergeRemoteVault();
    if (result.success) {
      setLastSynced(new Date().toISOString());
    } else {
      setSyncError(result.error ?? 'Merge failed');
    }
  } catch (e) {
    setSyncError(e instanceof Error ? e.message : String(e));
  } finally {
    setMerging(false);
  }
};

const handleMismatchReplaceLocal = async () => {
  setReplacingLocal(true);
  setSyncError(null);
  try {
    const result = await replaceLocalVault();
    if (result.success) {
      setLastSynced(new Date().toISOString());
    } else {
      setSyncError(result.error ?? 'Replace failed');
    }
  } catch (e) {
    setSyncError(e instanceof Error ? e.message : String(e));
  } finally {
    setReplacingLocal(false);
  }
};
```

Replace the mismatch dialog buttons section. When `canRestore` is true (vault IDs differ, decryption succeeded — three options):

```tsx
{vaultMismatchInfo.canRestore && (
  <>
    <Button
      title={merging ? 'Merging...' : 'Merge Vaults'}
      onPress={handleMismatchMerge}
      variant="primary"
      loading={merging}
      disabled={merging || replacingLocal || replacingRemote}
    />
    <Button
      title={replacingLocal ? 'Replacing...' : 'Replace Local with Remote'}
      onPress={handleMismatchReplaceLocal}
      variant="secondary"
      loading={replacingLocal}
      disabled={merging || replacingLocal || replacingRemote}
    />
  </>
)}
<Button
  title={replacingRemote ? 'Replacing...' : 'Replace Remote with Local'}
  onPress={handleMismatchReplace}
  variant="danger"
  loading={replacingRemote}
  disabled={merging || replacingLocal || replacingRemote}
/>
<Button
  title="Cancel"
  onPress={handleMismatchCancel}
  variant="secondary"
  disabled={merging || replacingLocal || replacingRemote}
/>
```

Remove the old "Restore Remote Vault" button that navigated to `/restore`.

- [ ] **Step 7: Run desktop tests**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/desktop test`
Expected: PASS (may need to update mocks in SyncSettingsScreen tests for new context shape).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/lib/vault-context.tsx apps/desktop/src/screens/SyncSettingsScreen.tsx
git commit -m "feat(desktop): add merge and replace-local vault mismatch resolution options"
```

---

## Chunk 9: Final Verification

### Task 9: Build, test, format, lint

- [ ] **Step 1: Build shared packages**

```bash
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
```

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: All packages pass.

- [ ] **Step 3: Run format**

```bash
pnpm format
pnpm format:check
```

- [ ] **Step 4: Run lint**

```bash
pnpm lint
```

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: formatting and lint fixes"
```
