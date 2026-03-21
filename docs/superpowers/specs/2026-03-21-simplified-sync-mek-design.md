# Simplified Sync MEK — Master Password in SyncConfig

## Problem

The current sync encryption design derives the MEK (Manifest Encryption Key) from the master password during vault unlock. The master password is held in a ref (`masterPasswordRef`) and used to derive MEK on-demand. This creates several edge cases:

1. **PIN/biometric unlock has no sync.** MEK requires the master password, which isn't available after PIN or biometric unlock. The desktop works around this with a password prompt modal in `SyncSettingsScreen` — awkward UX.
2. **Master password flows through too many code paths.** `unlock()`, `setupVault()`, `saveSyncConfigAction()`, `initSyncAfterUnlock()`, and `restoreFromCloudAction()` all need the master password for MEK derivation, each with slightly different handling.
3. **Mobile hasn't implemented sync at all** because of this complexity — `initSyncAfterUnlock()` has a TODO comment deferring MEK integration.
4. **`saveSyncConfigAction` takes an optional `masterPassword` parameter** to handle the case where MEK isn't available (PIN unlock). This leaks complexity into the UI layer.

## Solution

Store the master password inside the encrypted `SyncConfig` blob (already encrypted with the DEK via XChaCha20-Poly1305). When the user configures sync, they must enter their master password. On any unlock path (password, PIN, biometric), the DEK is available → decrypt sync config → read master password → derive MEK → create sync engine. No edge cases.

## Design

### 1. SyncConfig Type

Add `masterPassword` to both the Zod schema and the inferred TypeScript type in `packages/core/src/sync/sync-config.ts`:

```typescript
// In SyncConfigSchema (Zod object):
masterPassword: z.string().optional(),

// The TypeScript type is z.infer<typeof SyncConfigSchema>, so the field
// is automatically available as SyncConfig.masterPassword?: string
```

The field is `optional` because `provider: 'none'` configs don't need it. The Zod schema must include the field — otherwise `SyncConfigSchema.parse()` in `decryptSyncConfig()` will silently strip it.

### 2. Sync Settings Screen — Master Password Input

Both desktop and mobile sync settings screens add a **Master Password** input field to the connect form. The field is required before the Connect button is enabled.

**Validation:** Before saving, validate the master password by attempting to derive the KEK and verifying it can unwrap the vault header's encrypted DEK blob. If validation fails, show an error ("Incorrect master password"). If it succeeds, save the password into the `SyncConfig`.

**No vault = no sync settings.** The sync settings screen is only reachable when a vault exists (after "Create Vault" or "Restore from Cloud"). This is already the case — sync settings is behind the vault unlock gate.

**Test IDs:** Add `data-testid="sync-master-password"` to the master password input on both platforms (this ID is already reserved in CLAUDE.md).

### 3. Desktop Vault Context Simplification

Remove the following from `apps/desktop/src/lib/vault-context.tsx`:

- `masterPasswordRef` — no longer needed for sync
- `mekRef` / `syncSaltRef` as persistent refs — MEK is derived on-demand from config
- The `masterPassword` parameter on `saveSyncConfigAction`
- The `syncReady` / `needsPassword` / password prompt modal logic

Simplify `initSyncAfterUnlock()`:

```
initSyncAfterUnlock():
  1. Load sync config (decrypt with DEK)
  2. If config.provider === 'none' or !config.masterPassword → return (no sync)
  3. Read remote vault blob preamble (or generate new sync salt)
  4. deriveMEK(config.masterPassword, syncSalt, argon2Params)
  5. Create SyncEngine with MEK
  6. Connect auto-sync
```

This function no longer takes `masterPassword` as a parameter. It reads it from the config. It works identically for password unlock, PIN unlock, and biometric unlock.

### 4. Mobile Vault Context

Implement sync following the same pattern as the simplified desktop. `initSyncAfterUnlock()` reads the master password from the decrypted sync config. No special handling for biometric/PIN.

### 5. Core Sync Engine

`SyncEngine` constructor interface is unchanged — it still receives `mek`, `syncSalt`, `vaultHeaderBytes`, `argon2Params`. The change in where the master password comes from is purely on the platform side.

However, the vault mismatch handling (Section 6) requires changes to `SyncEngine`:

- Replace `onVaultReplaced` / `onVaultMismatch` with a callback that provides the three resolution options
- Add a `mergeVaults()` method that takes remote items + local items, applies LWW per-item, and returns the merged set
- After merge, run a normal sync cycle to push the merged state

### 6. First Sync & Vault Mismatch Resolution

When the user connects to a sync provider and the first sync runs, one of four scenarios occurs:

| Scenario                                | Behavior                                                |
| --------------------------------------- | ------------------------------------------------------- |
| No remote vault blob exists             | Normal first sync — push local vault to cloud           |
| Decryption succeeds, same vault ID      | Normal sync — merge per-item with LWW                   |
| Decryption succeeds, different vault ID | Show resolution dialog (see below)                      |
| Decryption fails                        | Show resolution dialog with limited options (see below) |

**Resolution dialog when decryption succeeds but vault IDs differ:**

Three options:

1. **Replace remote** — Delete all remote items. Push local vault to cloud. Remote vault ID becomes the local one.
2. **Replace local** — Download remote vault header + items. Replace local vault entirely (same as restore-from-cloud). Local vault ID becomes the remote one.
3. **Merge** — Take the union of both item sets. For items present on both sides (matched by ID), the most recent `updatedAt` wins. Items unique to either side are added to the merged result. After merge, sync runs immediately to push the merged state to cloud so all devices converge.

**Resolution dialog when decryption fails:**

One option:

1. **Replace remote** — The remote blob was encrypted with a different master password (a different vault entirely). Delete all remote data and push the local vault.

No replace-local or merge options because the remote data can't be read.

### 7. Restore from Cloud

Unchanged. The restore flow happens before sync is configured (on the setup screen). The user enters their master password directly on the restore screen. MEK is derived from that input. After restore completes and the vault is unlocked, if the user then configures sync, the master password is saved into `SyncConfig` as part of the normal connect flow.

## Known Constraints

**Master password rotation:** If a "Change Master Password" feature is added in the future, it must also update `SyncConfig.masterPassword` and re-derive the MEK. Otherwise the stored password becomes stale and sync will fail on subsequent unlocks. This is deferred — password change is not yet implemented.

## Security Considerations

The master password is stored encrypted with the DEK (XChaCha20-Poly1305). The DEK is protected by either:

- The master password itself (via Argon2id KDF) — circular but not exploitable: you need the DEK to read the master password, and you need the master password to get the DEK.
- Biometric/PIN-cached DEK in the platform secure enclave — the OS protects access.

The encrypted sync config blob at rest can only be decrypted by someone who already has the DEK. This is the same trust model as the existing sync config (which already stores WebDAV passwords encrypted with the DEK).

## What Gets Removed

- `masterPasswordRef` in desktop vault-context
- `mekRef` / `syncSaltRef` as long-lived refs (they become local variables in `initSyncAfterUnlock`)
- MEK pre-derivation in `setupVault()` (no longer needed — MEK is derived when sync is configured)
- Password prompt modal in `SyncSettingsScreen` (`syncReady`, `needsPassword`, modal state)
- The optional `masterPassword` parameter on `saveSyncConfigAction` — signature becomes `saveSyncConfig: (config: SyncConfig) => Promise<void>` (update `VaultContextType` accordingly)
- Special-case PIN/biometric unlock paths for sync
- The `console.warn('Mobile sync engine creation deferred')` TODO in mobile vault-context

## Files Changed

### Modified

| File                                                             | Changes                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/sync/sync-config.ts`                          | Add `masterPassword?: string` to `SyncConfig` type                                                                       |
| `apps/desktop/src/lib/vault-context.tsx`                         | Remove `masterPasswordRef`, `mekRef`/`syncSaltRef` refs, simplify `initSyncAfterUnlock`, simplify `saveSyncConfigAction` |
| `apps/desktop/src/screens/SyncSettingsScreen.tsx`                | Add master password input field, remove password prompt modal, add validation                                            |
| `apps/mobile/lib/vault-context.tsx`                              | Implement `initSyncAfterUnlock` with MEK derivation from config                                                          |
| `apps/mobile/app/settings/sync.tsx`                              | Add master password input field, add validation                                                                          |
| `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx` | Update tests for master password field, remove modal tests                                                               |
| `apps/mobile/__tests__/screens/sync-settings.test.tsx`           | Update tests for master password field                                                                                   |
| `packages/core/src/sync/sync-engine.ts`                          | Update vault mismatch callback to support three resolution options, add merge logic                                      |
| `apps/desktop/src/screens/SyncSettingsScreen.tsx`                | Update mismatch dialog: replace-remote / replace-local / merge (three buttons)                                           |

### Unchanged

| File                                   | Reason                     |
| -------------------------------------- | -------------------------- |
| `packages/core/src/sync/vault-blob.ts` | Encryption logic unchanged |
| `packages/core/src/sync/restore.ts`    | Restore flow unchanged     |
