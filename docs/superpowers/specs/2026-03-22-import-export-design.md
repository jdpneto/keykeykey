# Import & Export Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

Add CSV import UI integration, CSV export, and encrypted vault backup (ZIP with AES-256) across all three platforms (desktop, extension, mobile). The core import pipeline already exists (`packages/core/src/import/`); this spec covers wiring it to the UI, building the export counterpart, and adding encrypted backup/restore.

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
- `tags` array → first tag becomes `folder` (matches import's reverse mapping)
- `favorite` boolean → `"true"` / `"false"` string
- RFC 4180 quoting: fields containing commas, quotes, or newlines are double-quoted; internal quotes escaped as `""`
- UTF-8 BOM prefix (`\uFEFF`) for Excel compatibility
- `passwordHistory` explicitly excluded — uses a field allowlist, not object spread

### `serializeCsv()`

Reusable CSV serializer — the inverse of the existing `parseCsv()`. Handles quoting and escaping per RFC 4180.

## 2. Encrypted Export/Import (`packages/core/src/export-import-zip`)

### Export Flow

1. Read the vault directory files (header + all encrypted item blobs) — same format as what lives on disk/WebDAV
2. Bundle into a ZIP with AES-256 encryption using the user-provided zip password
3. Return the zip as `Uint8Array` — platform handles the file save dialog

### Import Flow

1. Receive zip bytes + zip password → extract vault directory
2. Two modes:
   - **Replace**: wipe local vault, replace with extracted files, user unlocks with their master password afterward
   - **Merge**: decrypt both local vault (already unlocked) and imported vault (needs master password for the imported vault). Use the same merge logic as sync — deduplicate by matching items, skip duplicates, add new items

### API

```typescript
/** Bundle vault directory into a password-protected ZIP. */
function exportEncryptedZip(
  vaultFiles: Map<string, Uint8Array>,
  zipPassword: string
): Promise<Uint8Array>;

/** Extract vault directory from a password-protected ZIP. */
function importEncryptedZip(
  zipBytes: Uint8Array,
  zipPassword: string
): Promise<Map<string, Uint8Array>>;
```

### Library

`fflate` — lightweight, pure JS, supports ZIP AES-256 encryption, works in browser/Node/React Native.

### Portability

The zip contains the exact same vault directory format used by sync. Users can manually unzip to a WebDAV folder for manual sync recovery.

## 3. Duplicate Detection & Merge Logic (`packages/core/src/import/merge.ts`)

Shared across CSV import and encrypted import merge mode.

### API

```typescript
interface MergeResult {
  /** Items that should be imported (no duplicates found). */
  toImport: VaultItem[];
  /** Items skipped because a duplicate exists. */
  skipped: VaultItem[];
}

function findDuplicates(
  incoming: VaultItem[],
  existing: VaultItem[]
): MergeResult;
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

In the **Data** section of Settings on desktop, extension, and mobile:

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

1. File picker button → select `.zip` file
2. Zip password input
3. Merge/Replace toggle
4. If merge: master password input for the imported vault (to decrypt items for duplicate detection)
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
2. Export button → file save dialog
3. All vault item types included (credentials, cards, secure notes) — the vault directory contains everything

### Platform File Handling

| Platform | Import (file pick) | Export (file save) |
|----------|-------------------|-------------------|
| Desktop (Tauri) | `dialog.open()` | `dialog.save()` + Rust filesystem write |
| Extension | `<input type="file">` | `browser.downloads.download()` with blob URL |
| Mobile | `expo-document-picker` | `expo-sharing` / `expo-file-system` |

## 5. Module Structure

### New Core Modules

```
packages/core/src/
  export/
    csv-serializer.ts    — serializeCsv(headers, rows)
    exporter.ts          — exportToCsv(items)
    index.ts             — re-exports
  export-import-zip/
    encrypted-export.ts  — exportEncryptedZip(vaultFiles, zipPassword)
    encrypted-import.ts  — importEncryptedZip(zipBytes, zipPassword)
    index.ts             — re-exports
  import/
    merge.ts             — findDuplicates(incoming, existing), URL normalization
    (existing files unchanged)
```

### New package.json Exports

```json
{
  "./export": { "import": "./dist/export/index.js", "types": "./dist/export/index.d.ts" },
  "./export-import-zip": { "import": "./dist/export-import-zip/index.js", "types": "./dist/export-import-zip/index.d.ts" },
  "./import": { "import": "./dist/import/index.js", "types": "./dist/import/index.d.ts" }
}
```

Note: `./import` already exists as a module but is not in `package.json` exports — needs adding.

### New Dependency

- `fflate` added to `packages/core` for ZIP with AES-256

### New App Screens

All three platforms get:
- `ImportScreen` — new screen/route
- `ExportScreen` — new screen/route

## 6. Security Considerations

- **CSV export requires unlocked vault** — function takes decrypted `VaultItem[]`
- **User confirmation before CSV export** — plaintext warning dialog
- **Encrypted export uses AES-256** via ZIP encryption — standard, universally compatible
- **No auto-export** — always user-initiated
- **`passwordHistory` excluded from CSV export** — uses field allowlist
- **Zip password separate from master password** — users can share backups without revealing master password

## 7. Testing

### CSV Export
- Verify RFC 4180 output (quoting, escaping, CRLF line endings)
- Verify UTF-8 BOM present
- Verify only credentials exported
- Verify `passwordHistory` excluded
- Round-trip: export → re-import via Chrome parser → all fields match
- Fields with commas, quotes, newlines properly escaped
- Empty fields produce correct CSV

### Encrypted Export/Import
- Round-trip: export zip → import zip → vault matches
- Wrong zip password → clear error
- Replace mode: local vault fully replaced
- Merge mode: duplicates skipped, new items added
- Zip contents match vault directory format (extractable to WebDAV)

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
