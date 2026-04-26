# Password History Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-entry "Restore" action to the existing Password History UI on desktop, mobile, and extension, so users can swap a current password for a previous one in a single click. Bring documentation and test coverage (manual smoke + E2E) up to parity with the shipped feature.

**Architecture:** Single dedicated store action `restorePasswordFromHistory` driven by a pure `rebuildAfterRestore` helper that the extension popup also reuses (it must hand-roll the `UPDATE_ITEM` payload because state is in the popup but persistence happens in the background service worker). Standard swap semantics (chosen entry leaves history, current goes to end of history; net length unchanged). No master re-auth — matches existing edit posture.

**Tech Stack:** TypeScript ESM monorepo (Turborepo + pnpm). Core: Zustand vanilla store, Vitest, Zod. Desktop: Tauri 2 + React + Vite + Vitest. Mobile: Expo Router + React Native + Jest (jest-expo) + Maestro. Extension: Manifest V3 + CRXJS + React + Vite + Vitest. Cross-extension E2E: Playwright.

**Spec reference:** `docs/superpowers/specs/2026-04-26-password-history-restore-design.md`

---

## File Structure

**Created:**

- `packages/core/src/store/password-history.ts` — pure helper `rebuildAfterRestore`
- `packages/core/src/store/__tests__/password-history.test.ts` — helper unit tests (or `password-history.test.ts` next to source — match the project convention; `vault-store.test.ts` lives next to `vault-store.ts`, so use `packages/core/src/store/password-history.test.ts`)
- `apps/extension/src/popup/screens/__tests__/CredentialDetailScreen.test.tsx` — first test for this screen
- `e2e/extension/password-history.spec.ts` — Playwright E2E
- `e2e/mobile/flows/password-history.yaml` — Maestro flow (tagged `critical`)

**Modified:**

- `packages/core/src/store/vault-store.ts` — add `restorePasswordFromHistory` action + types in `VaultActions`
- `packages/core/src/store/index.ts` — re-export `rebuildAfterRestore` (the helper) for the extension popup
- `packages/core/src/store/vault-store.test.ts` — extend the existing `password history` describe block with restore cases
- `apps/desktop/src/screens/ItemDetailScreen.tsx` — third icon button (Restore) per history row
- `apps/desktop/src/lib/vault-context.tsx` — expose `restorePasswordFromHistory` through the context (mirror `updateItem` wiring)
- `apps/desktop/src/screens/__tests__/` — extend `VaultListScreen.test.tsx` is wrong — there is no `ItemDetailScreen.test.tsx` yet. Create one alongside the existing screen tests.
- `apps/mobile/app/item/[id].tsx` — third Pressable (Restore) per history row
- `apps/mobile/lib/vault-context.tsx` — expose `restorePasswordFromHistory`
- `apps/mobile/__tests__/screens/` — add `item-detail.test.tsx` (or extend the closest existing test if there is one)
- `apps/extension/src/popup/screens/CredentialDetailScreen.tsx` — third per-row button (Restore) using `rebuildAfterRestore` to build the `UPDATE_ITEM` payload
- `base-test-flow.md` — insert §16 "Password history" + table rows
- `IMPLEMENTATION_STATUS.md` — refresh §16 row
- `implementationplan.md` — extend §16 password-history bullet

---

## Task 1: Pure `rebuildAfterRestore` helper (TDD)

**Files:**

- Create: `packages/core/src/store/password-history.ts`
- Create: `packages/core/src/store/password-history.test.ts`
- Modify: `packages/core/src/store/index.ts` (re-export)

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/store/password-history.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rebuildAfterRestore } from './password-history.js';

describe('rebuildAfterRestore', () => {
  const NOW = '2026-04-26T10:00:00.000Z';

  it('moves the chosen entry out and appends current to the end', () => {
    const history = [
      { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
      { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
      { password: 'p3', changedAt: '2026-04-22T10:00:00.000Z' },
    ];
    const result = rebuildAfterRestore('current', history, 0, NOW);

    expect(result).not.toBeNull();
    expect(result!.password).toBe('p1');
    expect(result!.passwordHistory).toEqual([
      { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
      { password: 'p3', changedAt: '2026-04-22T10:00:00.000Z' },
      { password: 'current', changedAt: NOW },
    ]);
  });

  it('keeps history length unchanged', () => {
    const history = [
      { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
      { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
    ];
    const result = rebuildAfterRestore('current', history, 1, NOW);
    expect(result!.passwordHistory).toHaveLength(2);
  });

  it('returns null (no-op) when chosen entry equals current', () => {
    const history = [
      { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
      { password: 'same', changedAt: '2026-04-21T10:00:00.000Z' },
    ];
    const result = rebuildAfterRestore('same', history, 1, NOW);
    expect(result).toBeNull();
  });

  it('throws on negative historyIndex', () => {
    const history = [{ password: 'p1', changedAt: NOW }];
    expect(() => rebuildAfterRestore('current', history, -1, NOW)).toThrow(/index out of range/i);
  });

  it('throws on out-of-range historyIndex', () => {
    const history = [{ password: 'p1', changedAt: NOW }];
    expect(() => rebuildAfterRestore('current', history, 1, NOW)).toThrow(/index out of range/i);
  });

  it('throws on empty history', () => {
    expect(() => rebuildAfterRestore('current', [], 0, NOW)).toThrow(/index out of range/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test password-history`
Expected: FAIL with "Cannot find module './password-history.js'" (or similar import error).

- [ ] **Step 3: Write the helper**

Create `packages/core/src/store/password-history.ts`:

```ts
/**
 * Pure helper for the "restore previous password" action.
 *
 * Returns the new (`password`, `passwordHistory`) pair after swapping the
 * credential's current password with the entry at `historyIndex`. The chosen
 * entry leaves history; the displaced current password is appended to the end
 * (newest position). Net history length is unchanged.
 *
 * Returns `null` when the chosen entry's password equals the current password
 * — this is a no-op and the caller should skip the mutation entirely.
 *
 * Throws `RangeError` when `historyIndex` is outside `[0, history.length - 1]`.
 *
 * Used by both the core vault store action and the extension popup, which has
 * to construct the `UPDATE_ITEM` IPC payload itself (state lives in the popup
 * but persistence happens in the background service worker).
 */
export interface PasswordHistoryEntry {
  password: string;
  changedAt: string;
}

export interface RebuildResult {
  password: string;
  passwordHistory: PasswordHistoryEntry[];
}

export function rebuildAfterRestore(
  currentPassword: string,
  history: PasswordHistoryEntry[],
  historyIndex: number,
  now: string,
): RebuildResult | null {
  if (historyIndex < 0 || historyIndex >= history.length) {
    throw new RangeError(`rebuildAfterRestore: historyIndex out of range (${historyIndex})`);
  }
  const chosen = history[historyIndex];
  if (chosen.password === currentPassword) return null;

  const remaining = history.filter((_, i) => i !== historyIndex);
  const passwordHistory = [...remaining, { password: currentPassword, changedAt: now }];
  return { password: chosen.password, passwordHistory };
}
```

- [ ] **Step 4: Re-export from the store barrel**

Edit `packages/core/src/store/index.ts`:

```ts
/**
 * Vault state management using Zustand (vanilla).
 *
 * @module store
 */

export { createVaultStore } from './vault-store.js';
export type {
  VaultState,
  VaultActions,
  VaultStore,
  VaultStatus,
  SearchOptions,
  VaultItemType,
} from './vault-store.js';
export { rebuildAfterRestore } from './password-history.js';
export type { PasswordHistoryEntry, RebuildResult } from './password-history.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test password-history`
Expected: PASS — 6/6 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store/password-history.ts \
        packages/core/src/store/password-history.test.ts \
        packages/core/src/store/index.ts
git commit -m "feat(core): rebuildAfterRestore helper for password-history restore"
```

---

## Task 2: Store action `restorePasswordFromHistory` (TDD)

**Files:**

- Modify: `packages/core/src/store/vault-store.ts:38-95` (`VaultActions` type)
- Modify: `packages/core/src/store/vault-store.ts:230-259` (action implementations)
- Modify: `packages/core/src/store/vault-store.test.ts` (extend `password history` describe block, near line 521)

- [ ] **Step 1: Write the failing tests**

Open `packages/core/src/store/vault-store.test.ts`. The existing `describe('password history', () => { ... })` block (lines 521-637) uses these conventions: a top-level `store` constant set up in an outer `beforeEach`, the constant `MASTER_PASSWORD`, and the helper `makeCredential({ password })` for `addItem` input. Mirror them.

Append the following sub-block at the end of the existing `describe('password history', () => { ... })` block (right before its closing `})`):

```ts
describe('restorePasswordFromHistory', () => {
  // Helper: set up an unlocked store with a credential whose
  // history is [{password: 'p1'}, {password: 'p2'}] and whose
  // current password is 'p3'.
  async function setupWithHistory() {
    await store.getState().unlock(MASTER_PASSWORD, []);
    const id = store.getState().addItem(makeCredential({ password: 'p1' }));
    store.getState().updateItem(id, { password: 'p2' });
    store.getState().updateItem(id, { password: 'p3' });
    return id;
  }

  it('moves the chosen entry out and appends current to the end', async () => {
    const id = await setupWithHistory();
    // Pre: history = [p1, p2], current = p3.
    store.getState().restorePasswordFromHistory(id, 0); // restore p1
    const item = store.getState().items.find((i) => i.id === id);
    expect(item!.type).toBe('credential');
    if (item!.type === 'credential') {
      expect(item!.password).toBe('p1');
      expect(item!.passwordHistory.map((e) => e.password)).toEqual(['p2', 'p3']);
    }
  });

  it('keeps history length unchanged', async () => {
    const id = await setupWithHistory();
    store.getState().restorePasswordFromHistory(id, 1); // restore p2
    const item = store.getState().items.find((i) => i.id === id);
    if (item!.type === 'credential') {
      expect(item!.passwordHistory).toHaveLength(2);
    }
  });

  it('is a no-op when chosen entry equals current', async () => {
    await store.getState().unlock(MASTER_PASSWORD, []);
    const id = store.getState().addItem(makeCredential({ password: 'a' }));
    store.getState().updateItem(id, { password: 'b' });
    // history = [a], current = b. Now manually re-set current to 'a' so
    // history[0] === current.
    store.getState().updateItem(id, { password: 'a' });
    // After that update: history = [a, b], current = a.
    const beforeUpdatedAt = store.getState().items.find((i) => i.id === id)!.updatedAt;
    store.getState().restorePasswordFromHistory(id, 0); // history[0] === current → no-op
    const item = store.getState().items.find((i) => i.id === id);
    if (item!.type === 'credential') {
      expect(item!.password).toBe('a');
      expect(item!.passwordHistory).toHaveLength(2);
      expect(item!.updatedAt).toBe(beforeUpdatedAt); // unchanged on no-op
    }
  });

  it('throws when the vault is locked', async () => {
    const id = await setupWithHistory();
    store.getState().lock();
    expect(() => store.getState().restorePasswordFromHistory(id, 0)).toThrow(/Vault is locked/);
  });

  it('throws when the item id does not exist', async () => {
    await store.getState().unlock(MASTER_PASSWORD, []);
    expect(() => store.getState().restorePasswordFromHistory('nonexistent-id', 0)).toThrow(
      /not found/,
    );
  });

  it('throws when the item is not a credential', async () => {
    await store.getState().unlock(MASTER_PASSWORD, []);
    const id = store.getState().addItem({
      type: 'card' as const,
      name: 'Test Card',
      tags: [],
      favorite: false,
      cardholderName: 'John',
      number: '4111111111111111',
      expirationMonth: 12,
      expirationYear: 2030,
      cvv: '123',
    });
    expect(() => store.getState().restorePasswordFromHistory(id, 0)).toThrow(/not a credential/);
  });

  it('throws on out-of-range historyIndex', async () => {
    const id = await setupWithHistory();
    expect(() => store.getState().restorePasswordFromHistory(id, 99)).toThrow(
      /index out of range/i,
    );
    expect(() => store.getState().restorePasswordFromHistory(id, -1)).toThrow(
      /index out of range/i,
    );
  });

  it('preserves createdAt and refreshes updatedAt on a real swap', async () => {
    const id = await setupWithHistory();
    const before = store.getState().items.find((i) => i.id === id)!;
    const beforeCreatedAt = before.createdAt;
    const beforeUpdatedAt = before.updatedAt;
    // Wait one tick so the new ISO timestamp differs.
    await new Promise((r) => setTimeout(r, 5));
    store.getState().restorePasswordFromHistory(id, 0);
    const after = store.getState().items.find((i) => i.id === id)!;
    expect(after.createdAt).toBe(beforeCreatedAt);
    expect(after.updatedAt).not.toBe(beforeUpdatedAt);
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(
      new Date(beforeUpdatedAt).getTime(),
    );
  });
});
```

> **Note on the no-op setup:** The test "is a no-op when chosen entry equals current" relies on `updateItem` appending to history when password changes back. Concretely after `addItem({password: 'a'})` → `updateItem({password: 'b'})` → `updateItem({password: 'a'})`, history is `[a, b]` and current is `a`. Restoring `history[0]` (which is `a`) hits the no-op branch because `chosen.password === current.password`. If the no-op semantics ever change, this test will start failing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test vault-store`
Expected: FAIL — `restorePasswordFromHistory is not a function` (or undefined).

- [ ] **Step 3: Add the action to the store types**

Edit `packages/core/src/store/vault-store.ts:38-95`. Inside the `VaultActions` type, after `deleteItem`, add:

```ts
  /**
   * Restore a credential's current password from a history entry. The chosen
   * entry leaves history; the displaced current password is appended to the
   * end (newest). Net history length unchanged.
   *
   * No-op when the chosen entry's password equals the current password.
   * Throws if the vault is locked, the item does not exist, the item is not a
   * credential, or `historyIndex` is out of bounds.
   */
  restorePasswordFromHistory: (id: string, historyIndex: number) => void;
```

- [ ] **Step 4: Implement the action**

Edit `packages/core/src/store/vault-store.ts`. Add the import at the top:

```ts
import { rebuildAfterRestore } from './password-history.js';
```

Then inside the `return createStore<VaultStore>()(...)` action object, after `deleteItem` (around line 267), add:

```ts
    restorePasswordFromHistory: (id: string, historyIndex: number) => {
      requireUnlocked();
      const now = new Date().toISOString();

      set((state) => ({
        items: state.items.map((item) => {
          if (item.id !== id) return item;
          if (item.type !== 'credential') {
            throw new Error('restorePasswordFromHistory: item is not a credential');
          }
          const history = item.passwordHistory ?? [];
          const result = rebuildAfterRestore(item.password, history, historyIndex, now);
          if (result === null) return item; // no-op

          const updated = {
            ...item,
            password: result.password,
            passwordHistory: result.passwordHistory,
            updatedAt: now,
          };
          return VaultItemSchema.parse(updated) as VaultItem;
        }),
      }));

      // If the id never matched any item, the map above is a no-op. Surface
      // that to the caller — every other mutating action implicitly tolerates
      // a missing id, but restore should not silently swallow it.
      const found = get().items.find((i) => i.id === id);
      if (!found) {
        throw new Error(`restorePasswordFromHistory: item not found (${id})`);
      }
    },
```

> **Subtle note for the implementer:** the missing-id check has to happen _after_ `set`, because `set` runs synchronously and we want to throw a meaningful error (not the inscrutable Zod failure that happens when the helper runs against a non-credential). The test "throws on missing item" verifies this.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test vault-store`
Expected: PASS — all `password history` cases (existing + 8 new) green.

- [ ] **Step 6: Verify the full core suite still passes**

Run: `pnpm --filter @keykeykey/core test`
Expected: PASS — every test in the core package.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/store/vault-store.ts \
        packages/core/src/store/vault-store.test.ts
git commit -m "feat(core/store): restorePasswordFromHistory action"
```

---

## Task 3: Desktop UI — Restore button on each history row

**Files:**

- Modify: `apps/desktop/src/lib/vault-context.tsx:62-95` (type), `:600-680` (provider value)
- Modify: `apps/desktop/src/screens/ItemDetailScreen.tsx:175-300` (history section)
- Create: `apps/desktop/src/screens/__tests__/ItemDetailScreen.test.tsx`

- [ ] **Step 1: Wire `restorePasswordFromHistory` through the vault context**

In `apps/desktop/src/lib/vault-context.tsx`, find the `VaultContextType` interface (around line 62 — sibling to `updateItem`). Add:

```ts
  restorePasswordFromHistory: (id: string, historyIndex: number) => void;
```

In the same file, near line 607 where `updateItem` is wired with `useCallback`, add a parallel binding:

```ts
const restorePasswordFromHistory = useCallback((id: string, historyIndex: number) => {
  storeRef.current.getState().restorePasswordFromHistory(id, historyIndex);
}, []);
```

Then add `restorePasswordFromHistory` to the provider value object (around line 678).

- [ ] **Step 2: Add the Restore button to ItemDetailScreen**

Open `apps/desktop/src/screens/ItemDetailScreen.tsx`. At the top, the import block already pulls icons from `lucide-react`. Add `RotateCcw`:

```ts
import { Eye, EyeOff, Copy, Check, RotateCcw } from 'lucide-react';
```

Pull `restorePasswordFromHistory` from `useVault()` at the top of the component (line ~13):

```ts
const { items, updateItem, removeItem, restorePasswordFromHistory } = useVault();
```

In the history section (lines 175-300), inside the per-row JSX (after the existing reveal-toggle and copy buttons, around line 274), add a third icon button. The existing row already has `index` from the `.map((entry, index) => { ... })` callback, where `index` is the **reversed** index (newest first). The store action needs the **original** index, which is `item.passwordHistory.length - 1 - index`. Add this constant near the start of the row callback (right after `const isRevealed = historyRevealed.has(index)`):

```ts
const originalIndex = item.passwordHistory.length - 1 - index;
```

Then add the Restore button after the existing Copy button:

```tsx
<button
  onClick={() => {
    restorePasswordFromHistory(item.id, originalIndex);
    toast.show('Password restored — previous moved to history.');
  }}
  aria-label="Restore this password"
  title="Restore this password"
  style={{
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: theme.colors.textSecondary,
    display: 'flex',
    padding: 2,
  }}
>
  <RotateCcw size={16} />
</button>
```

`toast` is already in scope (`const toast = useToast()` at line 15).

- [ ] **Step 3: Write the failing screen test**

Create `apps/desktop/src/screens/__tests__/ItemDetailScreen.test.tsx`. Mirror the harness pattern of `VaultListScreen.test.tsx` in the same directory (read it first to copy the mocking style — `vi.mock` for `useVault` and `useToast`, etc.).

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ItemDetailScreen } from '../ItemDetailScreen';
// Mocks: see VaultListScreen.test.tsx for the exact mock shape.

const mockRestore = vi.fn();
const mockToastShow = vi.fn();

vi.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    items: [
      {
        id: 'cred-1',
        type: 'credential',
        name: 'GitHub',
        username: 'me',
        password: 'curr',
        passwordHistory: [
          { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
          { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
        ],
        tags: [],
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-21T10:00:00.000Z',
      },
    ],
    updateItem: vi.fn(),
    removeItem: vi.fn(),
    restorePasswordFromHistory: mockRestore,
  }),
}));

vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: mockToastShow }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe('ItemDetailScreen — password history restore', () => {
  beforeEach(() => {
    mockRestore.mockClear();
    mockToastShow.mockClear();
  });

  it('renders a Restore button per history row', () => {
    render(
      <MemoryRouter initialEntries={['/item/cred-1']}>
        <Routes>
          <Route path="/item/:id" element={<ItemDetailScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /password history/i }));
    const restoreButtons = screen.getAllByRole('button', { name: /restore this password/i });
    expect(restoreButtons).toHaveLength(2);
  });

  it('calls restorePasswordFromHistory with the original index when clicked', () => {
    render(
      <MemoryRouter initialEntries={['/item/cred-1']}>
        <Routes>
          <Route path="/item/:id" element={<ItemDetailScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /password history/i }));
    const restoreButtons = screen.getAllByRole('button', { name: /restore this password/i });
    // The list renders newest-first (index 0 in the rendered list = index 1 in
    // the original passwordHistory array — i.e. p2). Click the first row.
    fireEvent.click(restoreButtons[0]);
    expect(mockRestore).toHaveBeenCalledWith('cred-1', 1);
    expect(mockToastShow).toHaveBeenCalledWith(expect.stringMatching(/Password restored/));
  });
});
```

> **Note for implementer:** `useToast` lives in `apps/desktop/src/components/ui/Toast.tsx` (verified). If the existing screen tests in `__tests__/` don't mock it (because they don't render anything that calls it), it's fine to drop the mock — the test renders `ItemDetailScreen` which calls `useToast()` at line 15, so the mock IS required.

- [ ] **Step 4: Run the desktop suite**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/desktop test`
Expected: PASS — including the two new tests.

- [ ] **Step 5: Format**

Run: `pnpm format`

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/lib/vault-context.tsx \
        apps/desktop/src/screens/ItemDetailScreen.tsx \
        apps/desktop/src/screens/__tests__/ItemDetailScreen.test.tsx
git commit -m "feat(desktop): per-row Restore button in password history"
```

---

## Task 4: Mobile UI — Restore button on each history row

**Files:**

- Modify: `apps/mobile/lib/vault-context.tsx:73-95` (type), `:545-900` (provider value)
- Modify: `apps/mobile/app/item/[id].tsx:200-300` (history section)
- Create: `apps/mobile/__tests__/screens/item-detail.test.tsx` (or extend the closest existing test if one exists)

- [ ] **Step 1: Wire `restorePasswordFromHistory` through the vault context**

In `apps/mobile/lib/vault-context.tsx`, mirror the desktop change (Task 3, Step 1). Find the `updateItem` definition around line 556 and add a parallel `restorePasswordFromHistory` `useCallback`. Add the type to `VaultContextType` (line ~73) and the value to the provider object (line ~892).

- [ ] **Step 2: Add the Restore button to `app/item/[id].tsx`**

Open `apps/mobile/app/item/[id].tsx`. Pull `restorePasswordFromHistory` from `useVault()` (line ~15):

```ts
const { items, removeItem, updateItem, restorePasswordFromHistory } = useVault();
```

In the history section (lines 204-292), inside the per-row JSX after the existing reveal and copy `Pressable`s (around line 261), add the third Pressable. The map callback is `[...item.passwordHistory].reverse().map((entry, idx) => ...)` so `idx` is the reversed index. Compute `originalIndex` near the top of the row:

```ts
const originalIndex = item.passwordHistory.length - 1 - idx;
```

Then add the button:

```tsx
<Pressable
  onPress={() => {
    restorePasswordFromHistory(item.id, originalIndex);
    Alert.alert('Restored', 'Previous password moved to history');
  }}
  accessibilityLabel="Restore this password"
  testID={`history-restore-${originalIndex}`}
  style={styles.fieldBtn}
>
  <Ionicons name="refresh-outline" size={18} color={t.colors.textSecondary} />
</Pressable>
```

`Alert` is already imported at the top of the file (line 2).

- [ ] **Step 3: Write the failing screen test**

Look first at `apps/mobile/__tests__/` for the closest pattern. If `screens/` is empty, create `apps/mobile/__tests__/screens/item-detail.test.tsx`:

```tsx
import { render, fireEvent } from '@testing-library/react-native';
import ItemDetailScreen from '../../app/item/[id]';

const mockRestore = jest.fn();

jest.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    items: [
      {
        id: 'cred-1',
        type: 'credential',
        name: 'GitHub',
        username: 'me',
        password: 'curr',
        passwordHistory: [
          { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
          { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
        ],
        tags: [],
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-21T10:00:00.000Z',
      },
    ],
    removeItem: jest.fn(),
    updateItem: jest.fn(),
    restorePasswordFromHistory: mockRestore,
  }),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'cred-1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});

describe('ItemDetailScreen — password history restore (mobile)', () => {
  beforeEach(() => mockRestore.mockClear());

  it('calls restorePasswordFromHistory with the original index when tapped', () => {
    const { getByTestId } = render(<ItemDetailScreen />);
    fireEvent.press(getByTestId('detail-password-history'));
    // Reversed-list index 0 = original index 1.
    fireEvent.press(getByTestId('history-restore-1'));
    expect(mockRestore).toHaveBeenCalledWith('cred-1', 1);
  });
});
```

> **Note for implementer:** If the existing mobile screens in `__tests__/screens/` use a different setup (e.g. a custom render helper, a theme provider wrap), follow that pattern — a quick `ls apps/mobile/__tests__/screens/` and a peek at an existing file is the fastest way to align.

- [ ] **Step 4: Run the mobile suite**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/mobile test`
Expected: PASS — including the new test.

- [ ] **Step 5: Format**

Run: `pnpm format`

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/vault-context.tsx \
        apps/mobile/app/item/\[id\].tsx \
        apps/mobile/__tests__/screens/item-detail.test.tsx
git commit -m "feat(mobile): per-row Restore button in password history"
```

---

## Task 5: Extension UI — Restore button using shared helper

**Files:**

- Modify: `apps/extension/src/popup/screens/CredentialDetailScreen.tsx`
- Create: `apps/extension/src/popup/screens/__tests__/CredentialDetailScreen.test.tsx`

The extension popup persists via the background service worker (`sendMessage({ type: 'UPDATE_ITEM', ... })`), so it cannot call the store action directly. It uses the shared `rebuildAfterRestore` helper from `@keykeykey/core/store` to build the payload.

- [ ] **Step 1: Add the Restore handler**

Edit `apps/extension/src/popup/screens/CredentialDetailScreen.tsx`. Add the import at the top of the file:

```ts
import { rebuildAfterRestore } from '@keykeykey/core/store';
```

Inside the component, add a handler near the existing `handleClearHistory` (around line 82):

```ts
const handleRestore = async (originalIndex: number) => {
  if (item.type !== 'credential') return;
  const history = item.passwordHistory ?? [];
  const result = rebuildAfterRestore(
    item.password,
    history,
    originalIndex,
    new Date().toISOString(),
  );
  if (result === null) return; // no-op
  await sendMessage({
    type: 'UPDATE_ITEM',
    id: item.id,
    updates: { password: result.password, passwordHistory: result.passwordHistory },
  });
  setHistoryRevealed(new Set());
  onRefresh();
};
```

- [ ] **Step 2: Add the Restore button to each history row**

In `renderPasswordHistory` (around line 90+), inside the per-row JSX (around line 175 — after the existing Show/Hide button and `<CopyButton ... />`), add a new button. The row's local index is `idx` (reversed) and the helper expects the original index, computed earlier as `const originalIndex = history.length - 1 - idx;` (already exists at line 127).

```tsx
<button
  onClick={() => handleRestore(originalIndex)}
  aria-label="Restore this password"
  title="Restore this password"
  style={{
    background: 'none',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.sm,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    color: theme.colors.textSecondary,
    cursor: 'pointer',
    fontSize: theme.typography.sizes.xs,
  }}
>
  Restore
</button>
```

- [ ] **Step 3: Write the failing screen test**

Create `apps/extension/src/popup/screens/__tests__/CredentialDetailScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CredentialDetailScreen } from '../CredentialDetailScreen';

const mockSendMessage = vi.fn().mockResolvedValue({ ok: true });

vi.mock('../../hooks/useMessage.js', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

const baseItem = {
  id: 'cred-1',
  type: 'credential' as const,
  name: 'GitHub',
  username: 'me',
  password: 'curr',
  passwordHistory: [
    { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
    { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
  ],
  tags: [],
  url: undefined,
  notes: undefined,
  appIdentifiers: undefined,
  totp: undefined,
  favorite: false,
  createdAt: '2026-04-20T10:00:00.000Z',
  updatedAt: '2026-04-21T10:00:00.000Z',
};

describe('CredentialDetailScreen — password history restore', () => {
  beforeEach(() => mockSendMessage.mockClear());

  it('sends UPDATE_ITEM with the rebuilt payload when Restore is clicked', async () => {
    render(
      <CredentialDetailScreen
        item={baseItem}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    // Expand the history.
    fireEvent.click(screen.getByRole('button', { name: /^show$/i }));
    // Two restore buttons appear (one per entry, reversed-list order).
    const restoreButtons = screen.getAllByRole('button', { name: /restore this password/i });
    expect(restoreButtons).toHaveLength(2);
    // Click the first row (reversed index 0 → original index 1 → 'p2').
    fireEvent.click(restoreButtons[0]);

    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'UPDATE_ITEM',
        id: 'cred-1',
        updates: {
          password: 'p2',
          passwordHistory: [
            { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
            // displaced 'curr' lands at the end with the call's timestamp
            expect.objectContaining({ password: 'curr' }),
          ],
        },
      }),
    );
  });
});
```

> **Note for implementer:** the props passed to `CredentialDetailScreen` (`onBack`, `onEdit`, `onRefresh`) come from the screen's actual `Props` interface — line 10-15 of `CredentialDetailScreen.tsx`. If the props differ, adjust the test and skip props that aren't required. The test asserts on the `UPDATE_ITEM` payload shape only.

- [ ] **Step 4: Run the extension suite**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/extension test`
Expected: PASS — including the new screen test.

- [ ] **Step 5: Format**

Run: `pnpm format`

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/popup/screens/CredentialDetailScreen.tsx \
        apps/extension/src/popup/screens/__tests__/CredentialDetailScreen.test.tsx
git commit -m "feat(extension): per-row Restore button in password history"
```

---

## Task 6: Extension Playwright E2E — `password-history.spec.ts`

**Files:**

- Create: `e2e/extension/password-history.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/extension/password-history.spec.ts`:

```ts
import { test, expect, setupAndUnlock } from '../fixtures/extension.js';

test.describe('Password history (Chromium)', () => {
  test.beforeEach(async ({ popup }) => {
    await setupAndUnlock(popup);
  });

  test('restores a previous password and updates the history list @critical', async ({ popup }) => {
    // 1. Add a credential with password 'p1'.
    await popup.getByLabel('Add item').click();
    await popup.getByPlaceholder('Item name').fill('GitHub');
    await popup.getByPlaceholder('user@example.com').fill('me');
    await popup.getByPlaceholder('Password').fill('p1');
    await popup.getByRole('button', { name: /^save$/i }).click();
    await expect(popup.getByText('GitHub')).toBeVisible({ timeout: 10_000 });

    // 2. Open detail → Edit → change to 'p2'.
    await popup.getByText('GitHub').click();
    await popup.getByRole('button', { name: /^edit$/i }).click();
    await popup.getByPlaceholder('Password').fill('p2');
    await popup.getByRole('button', { name: /^save$/i }).click();

    // 3. Edit again → change to 'p3'.
    await popup.getByRole('button', { name: /^edit$/i }).click();
    await popup.getByPlaceholder('Password').fill('p3');
    await popup.getByRole('button', { name: /^save$/i }).click();

    // 4. History is now [p1, p2]; current is p3.
    await popup.getByRole('button', { name: /^show$/i }).click();
    await expect(popup.getByText(/Password History \(2\)/i)).toBeVisible();

    // 5. Reveal both history entries to confirm contents.
    const showButtons = popup.getByRole('button', { name: /^show$/i });
    // The first Show button toggles the section open (already done). The
    // remaining `Show` rows are per-entry reveals.
    await showButtons.nth(1).click();
    await showButtons.nth(2).click();
    await expect(popup.getByText('p1')).toBeVisible();
    await expect(popup.getByText('p2')).toBeVisible();

    // 6. Click Restore on the first row (reversed-list order = p2 = original
    //    index 1).
    await popup
      .getByRole('button', { name: /restore this password/i })
      .first()
      .click();

    // 7. Current password is now p2, and history is [p1, p3].
    //    Re-open the history section and verify.
    await popup.getByRole('button', { name: /^show$/i }).click();
    await expect(popup.getByText(/Password History \(2\)/i)).toBeVisible();
    // Reveal both rows again.
    const reveals = popup.getByRole('button', { name: /^show$/i });
    await reveals.nth(1).click();
    await reveals.nth(2).click();
    await expect(popup.getByText('p1')).toBeVisible();
    await expect(popup.getByText('p3')).toBeVisible();

    // 8. The current-password field should now be 'p2'. Toggle it visible
    //    and check.
    await popup
      .getByRole('button', { name: /show password/i })
      .first()
      .click();
    await expect(popup.getByText('p2')).toBeVisible();
  });
});
```

> **Note for implementer:** the exact `getByRole`/`getByPlaceholder` selectors above mirror the patterns in `e2e/extension/vault-crud.spec.ts:1-62`. If a selector doesn't match (e.g. button text differs), fix it to match the actual DOM. The `Show` toggle being reused for both the section and per-row reveals is real — the existing `CredentialDetailScreen.tsx:121` shows "Show"/"Hide" for the section header.

- [ ] **Step 2: Build the extension**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/extension build`

- [ ] **Step 3: Run the new spec**

Run: `cd e2e && npx playwright install chromium --with-deps && npx playwright test extension/password-history --project=extension`
Expected: PASS — single test, ~30 s.

- [ ] **Step 4: Run the full @critical suite to verify no regression**

Run: `cd e2e && npx playwright test --project=extension --grep @critical`
Expected: PASS — every prior @critical test plus the new one.

- [ ] **Step 5: Commit**

```bash
git add e2e/extension/password-history.spec.ts
git commit -m "test(extension/e2e): password history restore @critical"
```

---

## Task 7: Mobile Maestro flow — `password-history.yaml`

**Files:**

- Create: `e2e/mobile/flows/password-history.yaml`

- [ ] **Step 1: Write the flow**

Create `e2e/mobile/flows/password-history.yaml`. Follow the exact shape of `e2e/mobile/flows/vault-crud.yaml`:

```yaml
appId: com.keykeykey.app
tags:
  - critical
---
# §16 — Password history: edit a credential's password twice, then restore
# the older password from the history list. Verify the swap.

- runFlow:
    file: ../helpers/_create-vault.yaml
    env:
      MASTER_PASSWORD: test1234

- runFlow:
    file: ../helpers/_add-login.yaml
    env:
      ITEM_NAME: GitHub
      ITEM_URL: https://github.com
      ITEM_USERNAME: claude-test
      ITEM_PASSWORD: p1

- extendedWaitUntil:
    visible: GitHub
    timeout: 10000

# Open the credential detail.
- tapOn: GitHub

# Edit → change password to p2.
- tapOn: Edit
- tapOn:
    id: add-password
- eraseText
- inputText: p2
- tapOn: Save
- extendedWaitUntil:
    visible: GitHub
    timeout: 10000

# Edit again → change password to p3.
- tapOn: GitHub
- tapOn: Edit
- tapOn:
    id: add-password
- eraseText
- inputText: p3
- tapOn: Save
- extendedWaitUntil:
    visible: GitHub
    timeout: 10000

# Reopen the credential, expand history.
- tapOn: GitHub
- tapOn:
    id: detail-password-history

# Two history rows visible (counts may include the count badge "Password History (2)").
- assertVisible: 'Password History (2)'

# Tap Restore on the first row (reversed-list = p2 = original index 1).
- tapOn:
    id: history-restore-1

# Toast confirms the swap.
- assertVisible: Restored

# Re-open the history (the dialog dismissed it) and confirm the new state:
# current is p2 (visible in the masked password field after toggling reveal),
# history rows now contain p1 and p3.
- tapOn:
    id: detail-password-history
- assertVisible: 'Password History (2)'
```

> **Note for implementer:** if the credential edit flow or the password-field test ID (`add-password`) differs on mobile, grep for the actual test ID — `apps/mobile/components/ItemForm.tsx` or similar — and fix the `id:` lines. The IDs used elsewhere in `flows/vault-crud.yaml` and `helpers/_add-login.yaml` are authoritative.

- [ ] **Step 2: Run the flow against a booted simulator (manual verification step)**

Boot a simulator per `base-test-flow.md` §1 and install the dev build per §2. Then:

Run: `pnpm e2e:mobile:ios -- --include-tags=critical`
Expected: every flow PASS, including the new `password-history`.

If on a CI-only machine, this step is best-effort — the operator should run it locally before merging.

- [ ] **Step 3: Commit**

```bash
git add e2e/mobile/flows/password-history.yaml
git commit -m "test(mobile/e2e): Maestro flow for password history restore"
```

---

## Task 8: Documentation — base-test-flow §16, IMPLEMENTATION_STATUS, implementationplan

**Files:**

- Modify: `base-test-flow.md` — insert §16 + table rows
- Modify: `IMPLEMENTATION_STATUS.md` — refresh §16 row
- Modify: `implementationplan.md` — extend §16 password-history bullet

- [ ] **Step 1: Add §16 to `base-test-flow.md`**

Open `base-test-flow.md`. Find the "### §15. Autofill (mobile only)" section (around line 629). After §15 ends and before "## Known issues / quirks", insert:

```md
### §16. Password history (view, restore, clear)

**Automated:** `e2e/mobile/flows/password-history.yaml` (iOS + Android,
critical). Extension parity in `e2e/extension/password-history.spec.ts`
(@critical).

The password-history feature auto-tracks every password change on a
credential (capped at 20 entries). The Restore action lets the user swap
the current password for any history entry in one click — chosen entry
leaves history, displaced current password is appended at the end. Net
history length unchanged. No master-password re-auth.

- From a vault containing a Login (e.g. the `GitHub` item from §2), edit
  the credential and change its password to `p2`, then edit again and
  change to `p3`.
- Reopen the credential. Tap/click the "Password History (2)" header to
  expand it.
- Each row shows a masked password, a "Changed on YYYY-MM-DD" line, and
  three icon buttons: reveal, copy, **Restore**.
- Tap/click **Restore** on the older row (the `p1`/`p2` entry, depending
  on what you set up).
- Expected: a toast / alert "Password restored — previous moved to
  history." (desktop/extension) or "Restored / Previous password moved to
  history" (mobile alert). The current password is now the chosen entry's
  password. The history list still has 2 entries: the entry that was NOT
  chosen, and the displaced `p3` at the end (newest position).
- Tap/click "Clear History" → confirm. History is empty.

**Cross-platform notes:**

- **Desktop**: `lucide-react` `RotateCcw` icon next to the eye and copy
  icons.
- **Mobile**: Ionicons `refresh-outline` icon. The action surfaces a
  native `Alert.alert('Restored', ...)` confirmation.
- **Extension**: text "Restore" button to match the existing
  Show/Hide / Copy text-button typography on this screen.
```

In the **"Mobile automation — Maestro"** critical-subset table (around lines 151-160), add a row:

```md
| §16 password history | `flows/password-history.yaml` | yes |
```

In the **"E2E automation — what's covered where"** table near the end of the file (around lines 671-684), add a row:

```md
| §16 password history (view, restore, clear) | `e2e/extension/password-history.spec.ts` |
```

- [ ] **Step 2: Refresh `IMPLEMENTATION_STATUS.md` §16 row**

Open `IMPLEMENTATION_STATUS.md`. Find the §16 row in the status table (around line 35):

```md
| 16 | Password history | ✅ | Schema + store + tests + export-exclusion all done |
```

Replace with:

```md
| 16 | Password history (view, restore, clear) | ✅ | Schema + store + restore action + UI on all 3 platforms + E2E + base-test-flow §16 |
```

- [ ] **Step 3: Extend `implementationplan.md` §16 bullet**

Open `implementationplan.md`. Search for the §16 / password history bullet. Add the restore-action mention to the existing description (e.g. append "+ per-entry Restore action wired through the vault store; one-click swap with no master-password re-auth").

> **Note for implementer:** if `implementationplan.md` does not currently have a §16 entry but uses §11 (Notes) or another section to mention password history, add the restore note there instead. Search for "passwordHistory" / "password history" — the section is wherever that text lives.

- [ ] **Step 4: Run prettier on the docs**

Run: `pnpm format`
Expected: prettier reformats the three markdown files in place if needed.

- [ ] **Step 5: Verify `pnpm format:check` is clean**

Run: `pnpm format:check`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add base-test-flow.md IMPLEMENTATION_STATUS.md implementationplan.md
git commit -m "docs: §16 password history (restore + manual smoke)"
```

---

## Final verification

After all 8 tasks land, run the full local check before opening a PR:

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: every workspace builds.

- [ ] **Step 2: Run all unit tests**

Run: `pnpm test`
Expected: every package's test suite green (core ≥937, desktop ≥83, extension ≥221, mobile ≥179, ui pre-existing).

> **Counts are floors, not exact targets.** Earlier-PR runs reported
> core 932, desktop 81, extension 219, mobile 177; this plan adds at
> least 6 core + 2 desktop + 1 mobile + 2 extension tests, hence the
> floors. If a count is unexpectedly lower, investigate before
> committing.

- [ ] **Step 3: Run the @critical Playwright suite**

Run: `cd e2e && npx playwright test --project=extension --grep @critical`
Expected: PASS — including the new `password-history` test.

- [ ] **Step 4: (Optional, local-only) run Maestro on a booted device**

Run: `pnpm e2e:mobile:ios -- --include-tags=critical` (or `:android`)
Expected: every flow PASS, including `password-history.yaml`.

- [ ] **Step 5: Open a PR**

Push the branch and open a PR with the title `feat: password history restore (core + 3 platforms + tests + docs)`. The body should reference both the spec (`docs/superpowers/specs/2026-04-26-password-history-restore-design.md`) and this plan.

---

## Self-review notes (post-write)

- **Spec coverage:** R1-R8 + N1-N4 are all covered: R1 (Restore button on each row — Tasks 3-5), R2 (helper + store action — Tasks 1-2), R3 (no-op assertion in helper test + store test — Tasks 1-2), R4 (toast/alert in each platform's UI step), R5 (no confirmation — explicit in Tasks 3-5), R6 (locked-throws test — Task 2), R7 (credential-only — store action and UI condition — Tasks 2-5), R8 (createdAt/updatedAt assertion — Task 2). N1 (no schema change — confirmed nothing in `models/credential.ts` is modified). N2 (no new IPC — extension uses `UPDATE_ITEM` — Task 5). N3 (no re-auth — explicit). N4 (cap unchanged — net history unchanged in helper, no test required because nothing about cap is touched).
- **Placeholders:** none (the only "TBD-shaped" content is the implementer-note about matching the existing test-helper pattern in Task 2 step 1, which gives an explicit `vault-store.test.ts:521-637` line range to mirror).
- **Type consistency:** `restorePasswordFromHistory` signature `(id: string, historyIndex: number) => void` is identical in the store, the desktop context, the mobile context. The extension goes through `sendMessage({ type: 'UPDATE_ITEM', ... })` and never adds the action name to its IPC types, by design (N2).
- **Naming:** `rebuildAfterRestore` (helper) vs `restorePasswordFromHistory` (action) — distinct names by purpose: helper rebuilds the data, action drives the store. Both are referenced consistently throughout.
