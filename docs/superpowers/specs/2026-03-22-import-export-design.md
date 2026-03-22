# Import & Export Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

Add CSV import UI integration, CSV export, and encrypted vault backup across all three platforms (desktop, extension, mobile). The core import pipeline already exists (`packages/core/src/import/`); this spec covers wiring it to the UI, building the export counterpart, and adding encrypted backup/restore.

## 1. CSV Export (`packages/core/src/export`)

### API

```typescript
/** Serialize headers + rows into an RFC 4180 CSV string. */
function serializeCsv(headers: string[], rows: string[][]): string;

/** Export credential-type vault items to CSV. */
function exportToCsv(items: VaultItem[]): string;
```

### Behavior

- Filters to `credential` type only (cards and secure notes excluded)
- Columns: `name,url,username,password,notes,totp,folder,favorite`
- `tags` array → semicolon-delimited string in `folder` column (e.g., `"work;banking"`) to avoid data loss on round-trip. On import, semicolons are split back into tags.
- `favorite` boolean → `"true"` / `"false"` string
- RFC 4180 quoting: fields containing commas, quotes, or newlines are double-quoted; internal quotes escaped as `""`
- UTF-8 BOM prefix (`\uFEFF`) for Excel compatibility
- `passwordHistory` explicitly excluded — uses a field allowlist, not object spread
- `appIdentifiers` excluded — Android app bundle IDs don't map to standard password CSV formats. This means round-tripping through CSV loses app identifier data.

### `serializeCsv()`

Reusable CSV serializer — the inverse of the existing `parseCsv()`. Handles quoting and escaping per RFC 4180.

## 2. Encrypted Export/Import (`packages/core/src/export-import-zip`)

### Vault Sync Structure

The sync system stores the vault as:

- `vault.enc` — single encrypted blob containing the sync manifest + vault header (preamble + XChaCha20-Poly1305 ciphertext)
- `items/{id}` — one encrypted file per vault item, stored by UUID

The encrypted backup exports this exact structure.

### Encryption Approach

Standard ZIP libraries (including `fflate`) do not support AES-256 ZIP encryption. Instead, we use a two-layer approach:

1. **Inner layer:** `fflate` creates a standard uncompressed ZIP containing the vault files (which are already encrypted with XChaCha20-Poly1305)
2. **Outer layer:** The entire ZIP is encrypted with XChaCha20-Poly1305 using a key derived from the zip password via Argon2id. The file format is: `[16-byte salt][16-byte Argon2 params][ciphertext of ZIP]`

The resulting file uses a `.keykeykey` extension. To manually extract to WebDAV, users import through the app (which decrypts the outer layer and extracts the standard ZIP contents). The vault files inside are the exact same format as sync — they can be placed directly into a WebDAV directory.

**`fflate`** (MIT license) — lightweight, pure JS, handles ZIP compression/decompression. Works in browser/Node/React Native. No encryption features needed from it since we handle encryption ourselves.

### Export Flow

1. Collect vault files: read `vault.enc` blob + all encrypted item blobs from the sync adapter or local storage
2. Bundle into a ZIP via `fflate` (standard, unencrypted ZIP)
3. Encrypt the ZIP bytes: Argon2id(zip password, random salt) → key → XChaCha20-Poly1305
4. Return `[salt][params][ciphertext]` as `Uint8Array` — platform handles file save dialog

### Import Flow

1. Receive file bytes + zip password
2. Read preamble (salt + Argon2 params) → derive key via Argon2id → decrypt to get ZIP bytes
3. Extract ZIP via `fflate` → vault files (`vault.enc` + `items/{id}`)
4. Two modes:
   - **Replace**: wipe local vault, replace with extracted vault files. The imported vault becomes the active vault — user must know the master password of the imported vault to unlock it afterward. Argon2 params, recovery key, and sync config all come from the imported vault. Local sync config is cleared (user must re-configure).
   - **Merge**: user must provide the master password for the imported vault (to decrypt items). Argon2id derivation runs (~15-20s on desktop) — show progress indicator. If wrong password → clear error: "Invalid master password for the imported vault. Please try again." Once decrypted, use field-based duplicate detection (see Section 3) to merge items into the local vault, skipping duplicates.

### API

```typescript
/** Collect vault files from the sync adapter into a map. */
function collectVaultFiles(adapter: ISyncAdapter): Promise<Map<string, Uint8Array>>;

/** Bundle vault files into an encrypted backup file. */
function exportEncryptedBackup(
  vaultFiles: Map<string, Uint8Array>,
  zipPassword: string,
): Promise<Uint8Array>;

/** Decrypt and extract vault files from an encrypted backup. */
function importEncryptedBackup(
  fileBytes: Uint8Array,
  zipPassword: string,
): Promise<Map<string, Uint8Array>>;
```

The `vaultFiles` map uses relative paths as keys: `"vault.enc"`, `"items/{uuid}"`, etc. These are collected via `collectVaultFiles()` which reads from the `ISyncAdapter` interface (or equivalent local storage).

## 3. Duplicate Detection & Merge Logic (`packages/core/src/import/merge.ts`)

Shared across CSV import and encrypted import merge mode. This uses **field-based deduplication**, not the ID-based LWW used by sync. The distinction:

- **Sync merge** (`mergeManifestsV2`): merges by item UUID using Last-Write-Wins timestamps. Used for ongoing sync between the same vault on multiple devices.
- **Import merge** (`findDuplicates`): merges by field values. Used when importing from external sources (CSV) or from a different vault (encrypted backup) where item UUIDs will differ.

### API

```typescript
interface MergeResult {
  /** Items that should be imported (no duplicates found). */
  toImport: VaultItem[];
  /** Items skipped because a duplicate exists. */
  skipped: VaultItem[];
}

function findDuplicates(incoming: VaultItem[], existing: VaultItem[]): MergeResult;
```

### Matching Rules

- **Credentials**: match on `username` + `password` + `url` (all three equal; URL normalized)
- **Cards**: match on `cardholderName` + `number` (exact match)
- **Secure notes**: match on `name` + `content` (exact match)

### URL Normalization

Strip trailing slashes, strip `www.` prefix, lowercase the hostname. Example: `https://www.Example.com/` matches `https://example.com`.

### No Partial Matching

An item either matches exactly (skip) or doesn't (import). Simple and predictable.

## 4. UI — Settings Integration (All Platforms)

### Settings Screen Changes

In the **Sync** section of Settings on desktop (where the existing disabled "Export Vault" row lives), and the equivalent section on extension and mobile:

1. **"Import Passwords"** row (Upload icon) → navigates to Import screen
2. **"Export Vault"** row (Download icon) → replaces existing disabled placeholder → navigates to Export screen

### Import Screen

Two tabs/sections at the top: **"From CSV"** and **"From Encrypted Backup"**.

#### CSV Tab

1. File picker button → select `.csv` file
2. Auto-detect source → shown as badge (e.g., "Detected: Chrome") with dropdown to override (Chrome, Firefox, Bitwarden, iCloud, 1Password)
3. Merge/Replace toggle (default: merge)
4. Preview: "Found X credentials, Y skipped"
5. Confirm button → items added to vault
6. Success toast: "Imported X items, Y duplicates skipped, Z rows skipped (invalid)"

#### Encrypted Backup Tab

1. File picker button → select `.keykeykey` file
2. Zip password input
3. Merge/Replace toggle
4. If merge: master password input for the imported vault (to decrypt items for duplicate detection). Show progress indicator during Argon2id derivation ("Decrypting vault..."). On wrong password: "Invalid master password for the imported vault. Please try again."
5. Confirm button
6. Success toast with count

### Export Screen

Two sections: **"Export as CSV"** and **"Export Encrypted Backup"**.

#### CSV Section

1. Warning text: "This will export X credentials in plaintext. The file will not be encrypted."
2. Export button → file save dialog
3. Only credential-type items exported

#### Encrypted Backup Section

1. Zip password input + confirm field
2. Export button → file save dialog (default filename: `keykeykey-backup-YYYY-MM-DD.keykeykey`)
3. All vault item types included (credentials, cards, secure notes) — the vault directory contains everything

### Platform File Handling

| Platform        | Import (file pick)     | Export (file save)                           |
| --------------- | ---------------------- | -------------------------------------------- |
| Desktop (Tauri) | `dialog.open()`        | `dialog.save()` + Rust filesystem write      |
| Extension       | `<input type="file">`  | `browser.downloads.download()` with blob URL |
| Mobile          | `expo-document-picker` | `expo-sharing` / `expo-file-system`          |

## 5. Module Structure

### New Core Modules

```
packages/core/src/
  export/
    csv-serializer.ts    — serializeCsv(headers, rows)
    exporter.ts          — exportToCsv(items)
    index.ts             — re-exports
  export-import-zip/
    encrypted-export.ts  — exportEncryptedBackup(vaultFiles, zipPassword)
    encrypted-import.ts  — importEncryptedBackup(fileBytes, zipPassword)
    index.ts             — re-exports
  import/
    merge.ts             — findDuplicates(incoming, existing), URL normalization
    (existing files unchanged)
```

### New package.json Exports

```json
{
  "./export": { "import": "./dist/export/index.js", "types": "./dist/export/index.d.ts" },
  "./export-import-zip": {
    "import": "./dist/export-import-zip/index.js",
    "types": "./dist/export-import-zip/index.d.ts"
  },
  "./import": { "import": "./dist/import/index.js", "types": "./dist/import/index.d.ts" }
}
```

Note: `./import` already exists as a module but is not in `package.json` exports — needs adding.

### tsup Entry Points

Add to `packages/core/tsup.config.ts` `entry` array:

```
'src/export/index.ts',
'src/export-import-zip/index.ts',
'src/import/index.ts',
```

### New Dependency

- `fflate` (MIT license) added to `packages/core` for ZIP compression/decompression

### New App Screens

All three platforms get:

- `ImportScreen` — new screen/route
- `ExportScreen` — new screen/route

## 6. Security Considerations

- **CSV export requires unlocked vault** — function takes decrypted `VaultItem[]`
- **User confirmation before CSV export** — plaintext warning dialog
- **Encrypted backup uses Argon2id + XChaCha20-Poly1305** — same proven crypto as the vault itself
- **No auto-export** — always user-initiated
- **`passwordHistory` excluded from CSV export** — uses field allowlist
- **`appIdentifiers` excluded from CSV export** — not part of standard password CSV formats
- **Zip password separate from master password** — users can share backups without revealing master password
- **Wrong master password on merge import** — clear error message after Argon2id derivation completes
- **Replace mode clears sync config** — prevents accidental sync to someone else's cloud storage

## 7. Testing

### CSV Export

- Verify RFC 4180 output (quoting, escaping, CRLF line endings)
- Verify UTF-8 BOM present
- Verify only credentials exported
- Verify `passwordHistory` excluded
- Verify `appIdentifiers` excluded
- Round-trip: export → re-import via Chrome parser → all fields match
- Fields with commas, quotes, newlines properly escaped
- Empty fields produce correct CSV
- Multiple tags → semicolon-delimited folder → re-import splits back to tags

### Encrypted Export/Import

- Round-trip: export → import (replace) → vault matches
- Wrong zip password → clear error
- Wrong master password on merge → clear error after Argon2id
- Replace mode: local vault fully replaced, sync config cleared
- Merge mode: duplicates skipped, new items added
- Extracted ZIP contents match sync directory format (vault.enc + items/{id})

### Merge/Duplicate Detection

- Credential duplicate: same username + password + URL → skipped
- Card duplicate: same cardholder + number → skipped
- Secure note duplicate: same name + content → skipped
- URL normalization: `https://www.Example.com/` matches `https://example.com`
- Non-duplicate items imported correctly
- Mixed types in single import handled correctly

### UI (E2E)

- Import CSV flow end-to-end on each platform
- Export CSV flow end-to-end on each platform
- Encrypted backup round-trip on each platform
- Merge vs replace toggle behavior
- Source auto-detection badge shown correctly
- Source override dropdown works
- Error states: invalid CSV, wrong password, corrupt zip
- Progress indicator during Argon2id derivation on encrypted merge import
