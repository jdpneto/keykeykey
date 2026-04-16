# PR-A — Mobile testID Prep Design

**Parent:** `2026-04-16-mobile-e2e-maestro-design.md`
**Scope:** Mechanical prep — add the `testID` props that Maestro needs
to drive §1–§14 on the mobile app. No behavior change. No Maestro
code. Independently mergeable and trivially revertible.

## Why this is its own PR

- **Safety:** touches ~15 screen files. Landing flows on top of
  missing testIDs would conflate "is Maestro the right tool?" with
  "did we forget a testID?" If PR-A is clean and the app still boots +
  tests pass, PR-B is free to focus on harness quality.
- **Reviewability:** pure prop additions. No logic, no renders
  changed. Reviewer can scan diffs mechanically.
- **Rollback:** one `git revert <sha>` undoes everything with zero
  knock-on to Maestro flows (which don't exist yet).

## Naming convention

Match desktop `data-testid` names 1:1 where the screens overlap.
Desktop's list is documented in `CLAUDE.md` and serves as the source
of truth. For mobile-only screens (PIN pad, autofill toggle, recovery
key acknowledge), introduce new IDs using the same `{area}-{action}`
shape.

For React Native, `testID="setup-password"` on the `<TextInput>` /
interactive element. Do not use `accessibilityLabel` for test IDs —
it's locale-sensitive and collides with VoiceOver/TalkBack.

## File-by-file inventory

### `apps/mobile/app/setup.tsx` — Create Vault

| testID                  | Element                                  |
| ----------------------- | ---------------------------------------- |
| `setup-password`        | Master password `<TextInput>`            |
| `setup-confirm`         | Confirm password `<TextInput>`           |
| `setup-submit`          | "Create Vault" button                    |
| `setup-restore-cloud`   | "Restore from Cloud" link / button       |

### `apps/mobile/app/recovery.tsx` — Recovery key acknowledgement

| testID                  | Element                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `recovery-copy`         | "Copy to Clipboard" button                                   |
| `recovery-continue`     | "I've Saved It — Continue" button (implicit acknowledgement) |

The screen has no separate acknowledge checkbox; the Continue button's
label carries the acknowledgement semantics. PR-B Maestro flows will
tap `recovery-continue` directly after `setup-submit` lands on this
screen.

### `apps/mobile/app/unlock.tsx` — Unlock

The screen has three modes (biometric / pin / password); only one
renders at a time. PIN entry uses a plain `<TextInput keyboardType="number-pad">`,
not a PinPad grid.

| testID                      | Element                                                |
| --------------------------- | ------------------------------------------------------ |
| `unlock-password`           | Master password `<TextInput>` (password mode)          |
| `unlock-submit`             | "Unlock" Button (password mode)                        |
| `unlock-pin-input`          | PIN `<TextInput>` (pin mode)                           |
| `unlock-pin-submit`         | "Unlock" Button (pin mode)                             |
| `unlock-biometric-retry`    | "Retry Biometrics" Button (biometric mode)             |
| `unlock-use-biometric`      | "Use Biometrics" mode switch Button                    |
| `unlock-use-pin`            | "Use PIN" mode switch Button                           |
| `unlock-use-password`       | "Use Master Password" mode switch Button               |
| `unlock-reset-link`         | "Reset Vault?" TouchableOpacity link                   |
| `unlock-reset-cancel`       | "Cancel" TouchableOpacity in reset confirm             |
| `unlock-reset-confirm`      | "Reset Vault" destructive TouchableOpacity             |

### `apps/mobile/app/restore.tsx` — Restore from Cloud

| testID                       | Element                             |
| ---------------------------- | ----------------------------------- |
| `restore-provider`           | Provider picker                     |
| `restore-webdav-url`         | WebDAV URL `<TextInput>`            |
| `restore-webdav-username`    | WebDAV username                     |
| `restore-webdav-password`    | WebDAV password                     |
| `restore-master-password`    | Master password                     |
| `restore-submit`             | "Restore Vault" button              |
| `restore-next`               | "Next" button (between steps)       |

### `apps/mobile/app/(tabs)/index.tsx` — Vault list

| testID                  | Element                                  |
| ----------------------- | ---------------------------------------- |
| `vault-add-button`      | "+" button (header or FAB)               |
| `vault-search`          | Search `<TextInput>`                     |
| `vault-item-{id}`       | Each `<ItemCard>` — dynamic, via prop    |
| `vault-lock-button`     | "Lock Vault" action                      |

### `apps/mobile/components/ItemCard.tsx`

Accept a `testID` prop, apply to the pressable root as
`testID={testID ?? \`vault-item-\${item.id}\`}`. The caller in
`(tabs)/index.tsx` passes the id-based testID by default.

### `apps/mobile/app/item/add.tsx` — Add item

| testID                  | Element                                  |
| ----------------------- | ---------------------------------------- |
| `add-tab-login`         | "Login" tab trigger                      |
| `add-tab-card`          | "Card" tab trigger                       |
| `add-tab-note`          | "Note" tab trigger                       |
| `add-name`              | Name `<TextInput>` (all three tabs)      |
| `add-url`               | URL (login)                              |
| `add-username`          | Username (login)                         |
| `add-password`          | Password (login)                         |
| `add-notes`             | Notes (login + card)                     |
| `add-cardholder`        | Cardholder (card)                        |
| `add-cardnumber`        | Card number (card)                       |
| `add-month`             | Expiry month (card)                      |
| `add-year`              | Expiry year (card)                       |
| `add-cvv`               | CVV (card)                               |
| `add-content`           | Content (note)                           |
| `add-save`              | "Save" header button                     |
| `add-cancel`            | "Cancel" header button                   |
| `add-generate`          | "Generate" button next to password field |

### `apps/mobile/app/item/edit.tsx` — Edit item

Same testIDs as `add.tsx` (same form component). If `edit.tsx` reuses
`add.tsx`'s form, adding testIDs in one place covers both.

### `apps/mobile/app/item/[id].tsx` — Item detail

| testID                      | Element                              |
| --------------------------- | ------------------------------------ |
| `detail-copy-username`      | Copy username button                 |
| `detail-copy-password`      | Copy password button                 |
| `detail-reveal-password`    | Eye / reveal toggle                  |
| `detail-edit`               | "Edit" action                        |
| `detail-delete`             | "Delete" action                      |
| `detail-password-history`   | "Password History (N)" link          |
| `detail-totp-code`          | TOTP code display (if present)       |
| `detail-totp-copy`          | TOTP copy button                     |

### `apps/mobile/components/TotpCodeDisplay.tsx`

Accept optional `testID` prop → `detail-totp-code`.

### `apps/mobile/app/(tabs)/generator.tsx`

| testID                  | Element                                  |
| ----------------------- | ---------------------------------------- |
| `gen-password-output`   | Generated password `<Text>`              |
| `gen-regenerate`        | Regenerate button                        |
| `gen-copy`              | Copy button                              |
| `gen-mode-random`       | Random tab                               |
| `gen-mode-passphrase`   | Passphrase tab                           |
| `gen-length-slider`     | Length slider                            |

### `apps/mobile/app/(tabs)/settings.tsx` — Settings root

| testID                   | Element                                 |
| ------------------------ | --------------------------------------- |
| `settings-sync`          | "Cloud Sync" row                        |
| `settings-import`        | "Import Passwords" row                  |
| `settings-export`        | "Export Vault" row                      |
| `settings-security`      | "Security" / PIN row                    |
| `settings-reset-vault`   | "Reset Vault" danger-zone button        |
| `settings-reset-confirm` | Confirm button on reset-vault dialog    |
| `settings-lock-vault`    | "Lock Vault" action (if present here)   |

### `apps/mobile/app/settings/sync.tsx`

| testID                  | Element                                  |
| ----------------------- | ---------------------------------------- |
| `sync-provider`         | Provider picker                          |
| `sync-webdav-url`       | WebDAV URL                               |
| `sync-webdav-username`  | WebDAV username                          |
| `sync-webdav-password`  | WebDAV password                          |
| `sync-master-password`  | Master password (vault)                  |
| `sync-connect`          | "Connect" button                         |
| `sync-disconnect`       | "Disconnect" button                      |
| `sync-now`              | "Sync Now" button                        |
| `sync-status`           | Status line ("Last synced: …")           |
| `sync-conflict-merge`         | "Merge Vaults" button on conflict dialog         |
| `sync-conflict-replace-local` | "Replace Local with Remote" button               |
| `sync-conflict-replace-remote`| "Replace Remote with Local" button               |
| `sync-conflict-cancel`        | "Cancel" button on conflict dialog               |

### `apps/mobile/app/settings/import.tsx`

| testID                  | Element                                  |
| ----------------------- | ---------------------------------------- |
| `import-tab-csv`        | "From CSV" tab                           |
| `import-tab-encrypted`  | "From Encrypted Backup" tab              |
| `import-pick-file`      | File picker trigger                      |
| `import-source-badge`   | "Source: Chrome" / etc. badge            |
| `import-mode-merge`     | "Merge" mode option                      |
| `import-mode-add-all`   | "Add All" mode option                    |
| `import-start`          | "Import" button                          |
| `import-backup-password`| Backup password (encrypted tab)          |
| `import-master-password`| Master password (encrypted tab)          |

### `apps/mobile/app/settings/export.tsx`

| testID                  | Element                                  |
| ----------------------- | ---------------------------------------- |
| `export-tab-csv`        | "Export as CSV" tab                      |
| `export-tab-encrypted`  | "Encrypted Backup" tab                   |
| `export-csv-submit`     | "Export CSV" button                      |
| `export-backup-password`| Backup password                          |
| `export-backup-confirm` | Confirm backup password                  |
| `export-backup-submit`  | "Export Backup" button                   |
| `export-confirm-dialog` | Plaintext-warning confirmation dialog    |

### PIN-setting modal (inside `(tabs)/settings.tsx`)

PIN setup is triggered by tapping the "PIN Unlock" toggle row; the
setup form renders in a `<Modal>`. PIN entry uses a plain `<TextInput
keyboardType="number-pad">`, not a PinPad grid.

| testID              | Element                                                |
| ------------------- | ------------------------------------------------------ |
| `pin-unlock-switch` | The PIN Unlock toggle row (pre-existing before PR-A)   |
| `pin-set-close`     | Close (X) `<Pressable>` in modal header                |
| `pin-set-input`     | Initial PIN `<TextInput>`                              |
| `pin-confirm-input` | Confirm PIN `<TextInput>`                              |
| `pin-set-submit`    | "Enable PIN Unlock" Button (primary action)            |
| `pin-set-cancel`    | "Cancel" Button in the modal                           |

### Reusable components

- `apps/mobile/components/Button.tsx` → already forwards arbitrary
  props; verify `testID` passes through. Add explicit `testID?: string`
  prop if needed.
- `apps/mobile/components/TextInput.tsx` → same. Ensure `testID` is
  forwarded to the underlying RN `<TextInput>`.
- `apps/mobile/components/QuickUnlockPrompt.tsx` → add a
  `quick-unlock-biometric` testID on the biometric button (deferred
  usage but cheap to add now).

## Out of scope for PR-A

- Any new logic.
- Any snapshot test updates (snapshot tests don't read testID).
- Autofill targets (`apps/mobile/targets/`) — no testID needed until
  §15 is in scope.
- Tauri desktop or extension — already covered by existing data-testid.

## Acceptance criteria

1. `pnpm --filter @keykeykey/mobile test` passes (Jest suite
   unaffected).
2. `pnpm --filter @keykeykey/mobile lint` passes.
3. Manual smoke on iOS sim: app boots, create vault → add login →
   lock → unlock succeeds with no visible change vs. main.
4. Manual smoke on Android emulator: same.
5. `git diff main --stat` shows only prop additions — no new files,
   no logic changes.

## Files touched

- `apps/mobile/app/setup.tsx`
- `apps/mobile/app/recovery.tsx`
- `apps/mobile/app/unlock.tsx`
- `apps/mobile/app/restore.tsx`
- `apps/mobile/app/(tabs)/index.tsx`
- `apps/mobile/app/(tabs)/generator.tsx`
- `apps/mobile/app/(tabs)/settings.tsx`
- `apps/mobile/app/item/add.tsx`
- `apps/mobile/app/item/edit.tsx`
- `apps/mobile/app/item/[id].tsx`
- `apps/mobile/app/settings/sync.tsx`
- `apps/mobile/app/settings/import.tsx`
- `apps/mobile/app/settings/export.tsx`
- `apps/mobile/components/ItemCard.tsx`
- `apps/mobile/components/Button.tsx`
- `apps/mobile/components/TextInput.tsx`
- `apps/mobile/components/TotpCodeDisplay.tsx`
- `apps/mobile/components/QuickUnlockPrompt.tsx`

Estimated ~18 files, ~40 testID props.

## Rollback plan

`git revert <sha>`. Zero knock-on effects because no Maestro flows
exist yet. If a follow-up PR (PR-B) has already landed, revert that
first, then revert PR-A.
