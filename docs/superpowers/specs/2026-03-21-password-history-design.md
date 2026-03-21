# Password History Design Spec

## Overview

When a user changes a credential's password, the old password is preserved in a history list on the credential itself. This lets users recover previous passwords (e.g., after a site revert, or when a service still uses an old password somewhere).

## Data Model

Add `passwordHistory` to the `Credential` Zod schema:

```typescript
passwordHistory: z.array(
  z.object({
    password: z.string(),
    changedAt: z.string().datetime(), // when this password was replaced (not when it was set)
  }),
)
  .max(20)
  .default([]);
```

- **Stores:** old password string + ISO 8601 timestamp of when the password was replaced by a new one.
- **Cap:** 20 entries per credential. When the 21st is added, the oldest (index 0) is dropped.
- **Default:** `[]` — backward-compatible with existing credential blobs (Zod's `.default()` fills in the empty array when the field is missing on parse).
- **Storage order:** Chronological — oldest at index 0, newest at the end. UI displays in reverse.

## Store Logic

In `updateItem()`, when a credential's `password` field changes:

1. Read the current `password` from the existing credential.
2. Compute `now` — the same timestamp used for `updatedAt`.
3. Push `{ password: currentPassword, changedAt: now }` onto `passwordHistory`.
4. If `passwordHistory.length > 20`, drop the oldest entry (index 0). This cap must be enforced **before** Zod validation (which has `.max(20)` as a safety net).
5. Apply the new password and updated history together.

**Guards:**

- Only triggers for `credential` type items.
- Only triggers when the new password differs from the current one (no duplicates on no-op saves).
- `addItem()` (including imports) does **not** trigger history — fresh inserts start with `[]`.

## UI Integration

All platforms (desktop, mobile, extension):

- **Credential detail screen:** A "Password History (N)" button/link as the **last item** on the screen, below notes. Hidden when `N === 0`.
- **Expanding/opening** shows entries in reverse chronological order (newest first):
  - Each row: masked password (dots) + "Changed on [date]"
  - Reveal toggle (eye icon) to show the actual password, with the same auto-hide timeout as the current password reveal
  - Copy button per entry
- **Clear History:** A "Clear History" action (with confirmation) to purge all history entries for security hygiene (e.g., after a breach rotation).
- **Clipboard auto-clear:** Copying a historical password follows the same 30-second auto-clear as the current password.
- **Search exclusion:** `passwordHistory` entries must **not** be included in the vault search index. Only current credential fields (name, url, username, tags) are searchable.

## Import, Export & Sync

- **Import:** Imported credentials start with `passwordHistory: []`. No CSV format includes history.
- **Export:** `passwordHistory` is **not** included in CSV export. The export implementation must use an explicit field allowlist (not spread the whole object) to prevent `passwordHistory` leaking via `.passthrough()`. Keeps the CSV compatible with other password managers.
- **Sync:** No special handling. History is part of the credential blob — encrypts, syncs, and merges like any other field. Last-Write-Wins on the whole credential applies.
  - **Known limitation:** LWW at the item level means concurrent edits on different devices can silently drop history. Example: Device A changes the password (gaining a history entry), Device B edits a tag without the new password, Device B syncs later with a newer `updatedAt` — Device A's history entry is lost. This is accepted as a trade-off of the current item-level merge strategy. Field-level merge for `passwordHistory` could be added later if sync conflict resolution evolves.

## Backward Compatibility

Old credential blobs without `passwordHistory` are fully compatible. Zod's `.default([])` fills in an empty array when the field is missing during parse. No migration required.

## Security Considerations

- **Encrypted at rest:** History is part of the credential blob — encrypted with the DEK like all other fields.
- **Search exclusion:** Historical passwords are never indexed or searchable.
- **Export exclusion:** Historical passwords are never included in CSV exports. Export must use a field allowlist.
- **Memory surface:** Password history increases the number of password strings in memory when the vault is unlocked (up to 20 additional per credential). This is an extension of the existing limitation that decrypted items live in the JS heap and cannot be reliably zeroed. The impact is bounded by the 20-entry cap.

## Testing

- **Schema:** Verify `passwordHistory` defaults to `[]` when missing (backward compat). Verify `.max(20)` rejects arrays over 20.
- **Store logic:** Verify history is pushed when password changes. Verify history is **not** pushed when password stays the same. Verify oldest entry is dropped at the 21-entry boundary. Verify non-credential items (Card, SecureNote) are unaffected. Verify `changedAt` matches the `updatedAt` timestamp.
- **Round-trip:** Create credential → update password 3 times → verify history has 3 entries with correct passwords and timestamps in order.
- **Cap enforcement:** Update password 25 times → verify only the 20 most recent are kept.
- **Export:** Verify `passwordHistory` is not included in CSV output.
- **Import:** Verify imported credentials have empty history.
- **Search:** Verify old passwords in history are not returned by vault search.
- **Clear history:** Verify clearing history sets `passwordHistory` to `[]`.
