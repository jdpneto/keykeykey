# Password History Restore — Design

**Date:** 2026-04-26
**Status:** Approved (brainstorm) — ready for implementation plan
**Owner:** core/store + 3 platforms + tests + docs

## Context

Password history is already shipped on all three platforms:

- **Schema** — `passwordHistory` is part of `CredentialSchema` (`packages/core/src/models/credential.ts`), capped at 20 entries.
- **Auto-tracking** — `vault-store.ts` `updateItem` appends the previous password to history whenever the new `password` differs from the current one.
- **Export** — CSV exporter in `packages/core/src/export/exporter.ts` excludes `passwordHistory` deliberately.
- **UI** — Each platform's item-detail screen renders a collapsible "Password History (N)" section with per-entry reveal-toggle, copy, and a "Clear History" action:
  - `apps/desktop/src/screens/ItemDetailScreen.tsx`
  - `apps/mobile/app/item/[id].tsx`
  - `apps/extension/src/popup/screens/CredentialDetailScreen.tsx`

What is **missing**:

1. **No restore action.** A user who realizes a current password is wrong can see the previous one in the history but has no way to swap back without copy-pasting it into the edit form.
2. **`base-test-flow.md` has no §16.** The manual smoke test makes no mention of password history, even though it is a shipped, user-facing feature.
3. **No platform-level E2E coverage.** Only core unit tests cover the behavior.

This design adds the restore action, brings the manual test flow up to parity with the shipped feature, and adds E2E coverage on extension (Playwright) and mobile (Maestro).

## Requirements

### Functional

- **R1.** A user viewing a credential's detail screen MAY click a per-entry "Restore" affordance on any history row. On click, that history entry's password becomes the credential's current password.
- **R2.** When the swap happens, the previously-current password is appended to history at the end (newest-most position) and the chosen entry is removed from history. Net history length unchanged.
- **R3.** If the chosen entry's password equals the current password, the action is a no-op (the call returns without mutating the item, and no toast fires).
- **R4.** A success toast appears on the platform's standard toast surface: "Password restored — previous moved to history."
- **R5.** No confirmation dialog. The action is fully reversible (the displaced password sits at the top of history; the user can restore it again).
- **R6.** Restore requires an unlocked vault. Calling on a locked vault throws (`Vault is locked`), matching every other mutating action.
- **R7.** Restore is credential-only. Cards and secure notes have no `passwordHistory`, so the affordance never renders for them.
- **R8.** `updatedAt` MUST be refreshed on a successful restore (treat it like any password edit). `createdAt` is never touched.

### Non-functional

- **N1.** No new wire-format fields. The Zod `CredentialSchema` is unchanged.
- **N2.** No new IPC message types in the extension. The popup forwards through the existing `UPDATE_ITEM` handler with the rebuilt `password` + `passwordHistory` payload.
- **N3.** No master-password re-auth. Matches the existing edit posture (a regular password change requires only an unlocked vault).
- **N4.** History cap stays at 20. Because R2 keeps history length unchanged, the cap is structurally never tested by restore; it is still asserted by an existing test.

## Design

### Core API

Add a single dedicated action on the vault store rather than overloading `updateItem`.

```ts
// packages/core/src/store/vault-store.ts
export type VaultActions = {
  // ... existing ...

  /**
   * Restore a credential's current password from a history entry. The chosen
   * entry is removed from history and the previously-current password is
   * appended to history (newest position). Net history length unchanged.
   *
   * No-op when the chosen entry already equals the current password.
   *
   * Throws if the vault is locked, the item does not exist, the item is not a
   * credential, or `historyIndex` is out of bounds.
   */
  restorePasswordFromHistory: (id: string, historyIndex: number) => void;
};
```

**Rationale for a dedicated action vs. extending `updateItem`:**

- `updateItem` is generic — adding a "restore" flag bloats its surface and risks future drift between the in-store rebuild and any platform that hand-rolls the rebuild.
- A dedicated action is one well-bounded unit (one purpose, one input shape, one set of error cases). It's testable in isolation and the platforms can call it without thinking about the history-rebuild rules.
- The store stays the source of truth for history-rebuild semantics. The platforms never construct a `passwordHistory` array directly.

**Implementation sketch:**

```ts
restorePasswordFromHistory: (id, historyIndex) => {
  requireUnlocked();
  const now = new Date().toISOString();

  set((state) => ({
    items: state.items.map((item) => {
      if (item.id !== id) return item;
      if (item.type !== 'credential') {
        throw new Error('restorePasswordFromHistory: item is not a credential');
      }
      const history = item.passwordHistory ?? [];
      if (historyIndex < 0 || historyIndex >= history.length) {
        throw new Error('restorePasswordFromHistory: index out of range');
      }
      const chosen = history[historyIndex];
      if (chosen.password === item.password) return item; // no-op

      const remaining = history.filter((_, i) => i !== historyIndex);
      const newHistory = [...remaining, { password: item.password, changedAt: now }];

      return VaultItemSchema.parse({
        ...item,
        password: chosen.password,
        passwordHistory: newHistory,
        updatedAt: now,
      }) as VaultItem;
    }),
  }));
};
```

### UI

#### Desktop (`apps/desktop/src/screens/ItemDetailScreen.tsx`)

- Add a third icon button per history row, alongside the existing eye and copy buttons.
- Icon: `lucide-react` `RotateCcw`, size 16.
- `aria-label="Restore this password"`, native tooltip via `title`.
- On click: `restorePasswordFromHistory(item.id, originalIndex)` where `originalIndex` is `history.length - 1 - reversedIndex` (the desktop screen renders newest-first).
- Toast via the existing toast/copy-feedback channel; if no toast exists today, render a brief inline "Restored" pill that auto-dismisses after 2 s, mirroring how copy feedback already works.

#### Mobile (`apps/mobile/app/item/[id].tsx`)

- Add a third `Pressable` in `styles.historyActions`, between (or after) the existing eye and copy buttons.
- Icon: Ionicons `refresh-outline`, size 18.
- `accessibilityLabel="Restore this password"`.
- On click: `restorePasswordFromHistory(item.id, originalIndex)`. The mobile screen also renders newest-first; same index math.
- Toast via the existing `Alert.alert` or the lighter `ToastAndroid` / iOS `Alert` pattern already used by clipboard copy. Reuse whatever the existing "Password copied" surfacing is.

#### Extension (`apps/extension/src/popup/screens/CredentialDetailScreen.tsx`)

- Add a "Restore" text button next to the existing per-row Show/Hide and Copy buttons. Text-not-icon to match the existing button typography on this screen.
- On click: `sendMessage({ type: 'UPDATE_ITEM', id: item.id, updates: { password, passwordHistory } })` with the rebuilt payload — but this is **the only place** that should hand-roll the rebuild, and it is fragile. Better: add a thin client helper that does the rebuild using the same logic as the store, OR have the popup call back into a vault-context method that internally uses the core store.
- **Decision:** the extension popup uses the in-popup vault store for reads (item-detail data) but persists via the background service worker. The cleanest path is for the popup to compute the new `password` + `passwordHistory` and send `UPDATE_ITEM`. To avoid duplicating the rebuild rule, expose a pure helper from `@keykeykey/core/store`:

```ts
// packages/core/src/store/password-history.ts
export function rebuildAfterRestore(
  current: string,
  history: { password: string; changedAt: string }[],
  historyIndex: number,
  now: string,
): { password: string; passwordHistory: { password: string; changedAt: string }[] } | null;
```

Returns `null` for the no-op case. The store's `restorePasswordFromHistory` is a thin wrapper around this helper; the popup uses the helper directly to construct the `UPDATE_ITEM` payload. Both call sites stay consistent because they share the helper.

### Tests

#### Core unit (`packages/core/src/store/vault-store.test.ts`)

Extend the existing `password history` describe block:

- restore moves chosen entry out of history and pushes current to the end (newest)
- displaced password appears at end with `changedAt === item.updatedAt` from the call
- net history length unchanged
- no-op when chosen entry password equals current
- throws when vault is locked
- throws when item id missing
- throws when item is not a credential (use a card)
- throws when `historyIndex` is out of range (negative, >= length)
- preserves `createdAt`; updates `updatedAt`

#### Core unit — pure helper (`packages/core/src/store/password-history.test.ts`)

If we extract `rebuildAfterRestore`, give it its own test file:

- standard rebuild — chosen entry out, current to end
- no-op returns `null` when chosen password === current
- throws on out-of-range index

#### Extension popup unit

- `apps/extension/src/popup/screens/CredentialDetailScreen.test.tsx` (or extend an existing test file): clicking the new Restore button dispatches `UPDATE_ITEM` with the expected `{ password, passwordHistory }` payload.
- Background handler test (`items.test.ts` or equivalent): no new message type; existing `UPDATE_ITEM` handler is untouched, but assert that a payload that updates both `password` and `passwordHistory` together round-trips.

#### Desktop vitest

- `apps/desktop/src/screens/__tests__/ItemDetailScreen.test.tsx` (or sibling): clicking the new Restore button calls the vault-context's restore method (or `updateItem` if we keep the path symmetric); the toast/inline feedback appears.

#### Mobile Jest

- `apps/mobile/__tests__/screens/item-detail.test.tsx` (new or existing) — render the screen with a credential that has 2 history entries; tap the Restore icon; assert the store action was called with the expected index.

#### Extension E2E (Playwright)

- New file `e2e/extension/password-history.spec.ts`, tagged `@critical`:
  - create vault, add a credential with password `p1`
  - edit the credential, set password to `p2` — assert history has 1 entry (`p1`)
  - edit again, set password to `p3` — assert history has 2 entries (`p1`, `p2`)
  - open detail, expand history, click Restore on `p1`
  - assert current password is now `p1`, history is `[p2, p3]` (in that order; `p3` at the end as newest)

#### Mobile E2E (Maestro)

- New flow `e2e/mobile/flows/password-history.yaml`, tagged `critical`:
  - create vault, add a credential, edit the password twice
  - open detail, expand history
  - tap Restore on the older entry
  - assert via the visible password (after toggling reveal) and the history list count

### Docs

#### `base-test-flow.md`

Insert §16 between §15 (Autofill) and "Known issues / quirks". Reuse the section template (testIDs, expected outcomes, automation pointer):

```
### §16. Password history (view, restore, clear)

**Automated:** `e2e/mobile/flows/password-history.yaml` (iOS + Android).

- From a vault containing a Login item, edit the password twice (e.g. `p1` → `p2` → `p3`).
- Reopen the credential. Expand "Password History (2)".
  - Each row shows a masked password, a "Changed on YYYY-MM-DD" line, and three icon buttons: reveal, copy, **Restore**.
- Tap **Restore** on the `p1` row.
- Expected: toast "Password restored — previous moved to history." Current password is now `p1`. History becomes `p2`, `p3` (oldest first; `p3` at the end).
- Tap "Clear History" → confirm. History is empty.

**Cross-platform notes:**
- **Desktop**: lucide RotateCcw icon next to the eye and copy icons.
- **Mobile**: Ionicons refresh-outline.
- **Extension**: text "Restore" button.
```

Also add rows to:

- The "Mobile automation — Maestro" critical-subset table (§16, `flows/password-history.yaml`, critical: yes).
- The "E2E automation — what's covered where" table (§16, `e2e/extension/password-history.spec.ts`).

#### `implementationplan.md`

Update §16 bullet (or add one) to mention the per-entry Restore action.

#### `IMPLEMENTATION_STATUS.md`

Update §16 row with the restore-action note. Confirm section description still reads accurately after the addition.

## Failure modes & recovery

- **Out-of-range index** — should be unreachable from the UI (we only render rows that exist), but the store throws if a buggy caller passes a stale index. The thrown error bubbles to the platform's error boundary.
- **Locked vault between render and click** — auto-lock fires while the user has the detail screen open, then they click Restore. The store throws `Vault is locked`. Platforms already redirect on locked-during-action (see PR #79); the same path catches this.
- **Schema validation failure** — should never happen because the rebuilt item is structurally identical to a normal `updateItem` mutation. If it does, the Zod parse throws and the store mutation is rejected (no partial update).

## Out of scope (explicit)

- No master-password re-auth before restore (matches existing edit posture).
- No "restore and clear remaining history" combo action.
- No history for card CVV/PIN (already excluded; this design does not change that).
- No bulk restore / bulk delete history operations.
- No history search.
- No history for `secure-note` content (history is password-specific).

## Open questions

None. Brainstorm signed off.
