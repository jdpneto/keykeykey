# Password History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve old passwords when a credential's password changes, up to 20 entries, with UI to browse and copy historical passwords.

**Architecture:** Add a `passwordHistory` array field to the Credential Zod schema. The vault store's `updateItem()` automatically captures the old password before overwriting. All three app UIs (desktop, mobile, extension) show a "Password History" section at the bottom of the credential detail screen.

**Tech Stack:** Zod (schema), Zustand (store), React (desktop/extension UI), React Native (mobile UI), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-21-password-history-design.md`

---

### Task 1: Add `passwordHistory` to the Credential schema

**Files:**

- Modify: `packages/core/src/models/credential.ts:13-24`
- Modify: `packages/core/src/models/models.test.ts`

- [ ] **Step 1: Write failing tests for passwordHistory schema**

Add to the `CredentialSchema` describe block in `packages/core/src/models/models.test.ts`:

```typescript
it('should default passwordHistory to empty array when missing', () => {
  const credential = {
    ...validBase,
    type: 'credential' as const,
    username: 'user',
    password: 'pass',
  };
  const result = CredentialSchema.parse(credential);
  expect(result.passwordHistory).toEqual([]);
});

it('should accept credential with passwordHistory entries', () => {
  const credential = {
    ...validBase,
    type: 'credential' as const,
    username: 'user',
    password: 'pass',
    passwordHistory: [
      { password: 'old-pass-1', changedAt: new Date().toISOString() },
      { password: 'old-pass-2', changedAt: new Date().toISOString() },
    ],
  };
  const result = CredentialSchema.safeParse(credential);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.passwordHistory).toHaveLength(2);
  }
});

it('should reject passwordHistory with more than 20 entries', () => {
  const entries = Array.from({ length: 21 }, (_, i) => ({
    password: `pass-${i}`,
    changedAt: new Date().toISOString(),
  }));
  const credential = {
    ...validBase,
    type: 'credential' as const,
    username: 'user',
    password: 'pass',
    passwordHistory: entries,
  };
  const result = CredentialSchema.safeParse(credential);
  expect(result.success).toBe(false);
});

it('should reject passwordHistory entry without changedAt', () => {
  const credential = {
    ...validBase,
    type: 'credential' as const,
    username: 'user',
    password: 'pass',
    passwordHistory: [{ password: 'old' }],
  };
  const result = CredentialSchema.safeParse(credential);
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- --run src/models/models.test.ts`
Expected: FAIL — `passwordHistory` not defined on schema

- [ ] **Step 3: Add passwordHistory field to CredentialSchema**

In `packages/core/src/models/credential.ts`, add the field after `appIdentifiers` (line 22):

```typescript
export const CredentialSchema = z
  .object({
    ...baseVaultItemFields,
    type: z.literal('credential'),
    url: z.string().url().optional(),
    username: z.string().min(1),
    password: z.string().min(1),
    notes: z.string().optional(),
    totp: z.string().optional(),
    appIdentifiers: z.array(appIdentifierString).optional(),
    passwordHistory: z
      .array(
        z.object({
          password: z.string(),
          changedAt: z.string().datetime(),
        }),
      )
      .max(20)
      .default([]),
  })
  .passthrough();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- --run src/models/models.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/models/credential.ts packages/core/src/models/models.test.ts
git commit -m "feat(core): add passwordHistory field to Credential schema"
```

---

### Task 2: Add password history logic to `updateItem()`

**Files:**

- Modify: `packages/core/src/store/vault-store.ts:180-194`
- Modify: `packages/core/src/store/vault-store.test.ts`

- [ ] **Step 1: Write failing tests for password history in updateItem**

Add to the `vault store` describe block in `packages/core/src/store/vault-store.test.ts`:

```typescript
describe('password history', () => {
  it('should save old password to history when password changes', async () => {
    const header = await createVaultHeader(MASTER_PASSWORD, recoveryKey, TEST_PARAMS);
    store.getState().unlock(header, MASTER_PASSWORD, TEST_PARAMS);

    const id = store.getState().addItem(makeCredential({ password: 'original' }));
    store.getState().updateItem(id, { password: 'new-password' });

    const item = store.getState().items.find((i) => i.id === id);
    expect(item).toBeDefined();
    expect(item!.type).toBe('credential');
    if (item!.type === 'credential') {
      expect(item!.passwordHistory).toHaveLength(1);
      expect(item!.passwordHistory[0].password).toBe('original');
      expect(item!.passwordHistory[0].changedAt).toBe(item!.updatedAt);
    }
  });

  it('should not add history when password does not change', async () => {
    const header = await createVaultHeader(MASTER_PASSWORD, recoveryKey, TEST_PARAMS);
    store.getState().unlock(header, MASTER_PASSWORD, TEST_PARAMS);

    const id = store.getState().addItem(makeCredential({ password: 'same' }));
    store.getState().updateItem(id, { name: 'Updated Name' });

    const item = store.getState().items.find((i) => i.id === id);
    if (item!.type === 'credential') {
      expect(item!.passwordHistory).toHaveLength(0);
    }
  });

  it('should not add history when same password is re-saved', async () => {
    const header = await createVaultHeader(MASTER_PASSWORD, recoveryKey, TEST_PARAMS);
    store.getState().unlock(header, MASTER_PASSWORD, TEST_PARAMS);

    const id = store.getState().addItem(makeCredential({ password: 'same' }));
    store.getState().updateItem(id, { password: 'same' });

    const item = store.getState().items.find((i) => i.id === id);
    if (item!.type === 'credential') {
      expect(item!.passwordHistory).toHaveLength(0);
    }
  });

  it('should accumulate multiple password changes in order', async () => {
    const header = await createVaultHeader(MASTER_PASSWORD, recoveryKey, TEST_PARAMS);
    store.getState().unlock(header, MASTER_PASSWORD, TEST_PARAMS);

    const id = store.getState().addItem(makeCredential({ password: 'v1' }));
    store.getState().updateItem(id, { password: 'v2' });
    store.getState().updateItem(id, { password: 'v3' });
    store.getState().updateItem(id, { password: 'v4' });

    const item = store.getState().items.find((i) => i.id === id);
    if (item!.type === 'credential') {
      expect(item!.passwordHistory).toHaveLength(3);
      expect(item!.passwordHistory[0].password).toBe('v1');
      expect(item!.passwordHistory[1].password).toBe('v2');
      expect(item!.passwordHistory[2].password).toBe('v3');
      expect(item!.password).toBe('v4');
    }
  });

  it('should cap history at 20 entries, dropping oldest', async () => {
    const header = await createVaultHeader(MASTER_PASSWORD, recoveryKey, TEST_PARAMS);
    store.getState().unlock(header, MASTER_PASSWORD, TEST_PARAMS);

    const id = store.getState().addItem(makeCredential({ password: 'v0' }));
    for (let i = 1; i <= 25; i++) {
      store.getState().updateItem(id, { password: `v${i}` });
    }

    const item = store.getState().items.find((i) => i.id === id);
    if (item!.type === 'credential') {
      expect(item!.passwordHistory).toHaveLength(20);
      // 26 total passwords (v0-v25), current is v25
      // History: v0-v24 = 25 entries, capped to newest 20 = v5-v24
      expect(item!.passwordHistory[0].password).toBe('v5');
      expect(item!.passwordHistory[19].password).toBe('v24');
      expect(item!.password).toBe('v25');
    }
  });

  it('should not affect non-credential items', async () => {
    const header = await createVaultHeader(MASTER_PASSWORD, recoveryKey, TEST_PARAMS);
    store.getState().unlock(header, MASTER_PASSWORD, TEST_PARAMS);

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
    // Should not throw
    store.getState().updateItem(id, { cardholderName: 'Jane' });
    const item = store.getState().items.find((i) => i.id === id);
    expect(item!.type).toBe('card');
    expect((item as any).passwordHistory).toBeUndefined();
  });

  it('should clear password history when set to empty array', async () => {
    const header = await createVaultHeader(MASTER_PASSWORD, recoveryKey, TEST_PARAMS);
    store.getState().unlock(header, MASTER_PASSWORD, TEST_PARAMS);

    const id = store.getState().addItem(makeCredential({ password: 'v1' }));
    store.getState().updateItem(id, { password: 'v2' });
    store.getState().updateItem(id, { password: 'v3' });

    let item = store.getState().items.find((i) => i.id === id);
    if (item!.type === 'credential') {
      expect(item!.passwordHistory).toHaveLength(2);
    }

    // Clear history
    store.getState().updateItem(id, { passwordHistory: [] } as any);

    item = store.getState().items.find((i) => i.id === id);
    if (item!.type === 'credential') {
      expect(item!.passwordHistory).toHaveLength(0);
      expect(item!.password).toBe('v3'); // current password unchanged
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- --run src/store/vault-store.test.ts`
Expected: FAIL — history not being populated

- [ ] **Step 3: Implement password history logic in updateItem**

In `packages/core/src/store/vault-store.ts`, replace the `updateItem` implementation (lines 180-194):

```typescript
updateItem: (id: string, updates: Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>) => {
  requireUnlocked();

  const now = new Date().toISOString();

  set((state) => ({
    items: state.items.map((item) => {
      if (item.id !== id) return item;

      let mergedUpdates = { ...updates, updatedAt: now };

      // Track password history for credentials
      if (
        item.type === 'credential' &&
        'password' in updates &&
        updates.password !== undefined &&
        updates.password !== item.password
      ) {
        const historyEntry = { password: item.password, changedAt: now };
        const currentHistory = item.passwordHistory ?? [];
        const newHistory = [...currentHistory, historyEntry].slice(-20);
        mergedUpdates = { ...mergedUpdates, passwordHistory: newHistory };
      }

      const updated = { ...item, ...mergedUpdates };
      // Validate the updated item
      VaultItemSchema.parse(updated);
      return updated as VaultItem;
    }),
  }));
},
```

Key points:

- `.slice(-20)` keeps the last 20 entries (dropping oldest from the front) — simpler than push + shift.
- `item.passwordHistory ?? []` handles old blobs that don't have the field yet (before Zod parse adds the default).
- History is added to `mergedUpdates` so it's included in the spread, not a separate operation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- --run src/store/vault-store.test.ts`
Expected: PASS

- [ ] **Step 5: Run full core test suite**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass (schema changes are backward-compatible)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store/vault-store.ts packages/core/src/store/vault-store.test.ts
git commit -m "feat(core): track password history on credential updates"
```

---

### Task 3: Verify search excludes password history

**Files:**

- Modify: `packages/core/src/store/vault-store.test.ts`

The current `search()` implementation (vault-store.ts:204-222) only searches `name`, `url`, `username`, `appIdentifiers`, and `tags`. It does **not** search `password` or `passwordHistory`, so no code changes are needed. We just need a test to lock this behavior.

- [ ] **Step 1: Write test to verify search does not match on password history**

Add to the `vault store` describe block:

```typescript
it('should not return credentials when search matches password history', async () => {
  const header = await createVaultHeader(MASTER_PASSWORD, recoveryKey, TEST_PARAMS);
  store.getState().unlock(header, MASTER_PASSWORD, TEST_PARAMS);

  const id = store
    .getState()
    .addItem(makeCredential({ name: 'My Login', password: 'unique-secret-xyz' }));
  store.getState().updateItem(id, { password: 'new-password' });

  // Search for the old password that's now in history
  const results = store.getState().search('unique-secret-xyz');
  expect(results).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core test -- --run src/store/vault-store.test.ts`
Expected: PASS (search already excludes password fields)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/store/vault-store.test.ts
git commit -m "test(core): verify search excludes password history"
```

---

### Task 4: Verify export excludes password history

**Files:**

- Check: `packages/core/src/export/` (find the export implementation)

First check if export is implemented yet. Per the exploration, export may not exist yet. If it does not exist, skip this task — the spec notes that export must use a field allowlist, which will be enforced when export is built.

If export exists:

- [ ] **Step 1: Find the export implementation**

Run: `find packages/core/src/export -type f -name '*.ts' 2>/dev/null || echo 'no export directory'`

- [ ] **Step 2: Write test verifying passwordHistory is excluded from CSV export**

If export exists, add a test that creates a credential with password history, exports to CSV, and asserts `passwordHistory` does not appear in the output.

- [ ] **Step 3: Run test and verify**

- [ ] **Step 4: Commit if changes were made**

---

### Task 5: Add Password History UI to desktop detail screen

**Files:**

- Modify: `apps/desktop/src/screens/ItemDetailScreen.tsx`

- [ ] **Step 1: Add the Password History section**

In `apps/desktop/src/screens/ItemDetailScreen.tsx`, add a `PasswordHistory` component and render it after the fields and timestamps sections, before the action buttons. Only render for credentials with `passwordHistory.length > 0`.

Add state for history visibility and reveal:

```typescript
const [historyOpen, setHistoryOpen] = useState(false);
const [historyRevealed, setHistoryRevealed] = useState<Set<number>>(new Set());
```

Add the history section between the timestamps `div` (line 161) and the actions `div` (line 164):

```tsx
{
  /* Password History */
}
{
  item.type === 'credential' && item.passwordHistory && item.passwordHistory.length > 0 && (
    <div style={{ marginBottom: 32 }}>
      <button
        onClick={() => {
          setHistoryOpen(!historyOpen);
          if (historyOpen) setHistoryRevealed(new Set());
        }}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: theme.colors.textSecondary,
          fontSize: theme.typography.sizes.sm,
          padding: 0,
          textDecoration: 'underline',
        }}
      >
        Password History ({item.passwordHistory.length})
      </button>
      {historyOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {[...item.passwordHistory].reverse().map((entry, index) => {
            const isRevealed = historyRevealed.has(index);
            const displayPassword = isRevealed
              ? entry.password
              : '\u2022'.repeat(Math.min(entry.password.length, 20));
            return (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  backgroundColor: theme.colors.surface,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radii.sm,
                }}
              >
                <div style={{ flex: 1 }}>
                  <span
                    className={isRevealed ? 'mono' : undefined}
                    style={{
                      fontSize: theme.typography.sizes.sm,
                      color: theme.colors.text,
                      wordBreak: 'break-all',
                    }}
                  >
                    {displayPassword}
                  </span>
                  <div
                    style={{
                      fontSize: theme.typography.sizes.xs,
                      color: theme.colors.textSecondary,
                      marginTop: 2,
                    }}
                  >
                    Changed on {new Date(entry.changedAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setHistoryRevealed((prev) => {
                      const next = new Set(prev);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    });
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: theme.colors.textSecondary,
                    display: 'flex',
                    padding: 2,
                  }}
                >
                  {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button
                  onClick={() => handleCopy(`history-${index}`, entry.password)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color:
                      copiedField === `history-${index}`
                        ? theme.colors.success
                        : theme.colors.textSecondary,
                    display: 'flex',
                    padding: 2,
                  }}
                >
                  {copiedField === `history-${index}` ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            );
          })}
          <button
            onClick={() => {
              if (window.confirm('Clear all password history for this credential?')) {
                updateItem(item.id, { passwordHistory: [] } as any);
                setHistoryOpen(false);
              }
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: theme.colors.danger,
              fontSize: theme.typography.sizes.xs,
              padding: '4px 0',
              textAlign: 'left',
            }}
          >
            Clear History
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build and verify no type errors**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/desktop build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/screens/ItemDetailScreen.tsx
git commit -m "feat(desktop): add password history section to credential detail"
```

---

### Task 6: Add Password History UI to mobile detail screen

**Files:**

- Modify: `apps/mobile/app/item/[id].tsx`

- [ ] **Step 1: Read the current mobile detail screen**

Read `apps/mobile/app/item/[id].tsx` fully to understand the component structure, styling patterns, and how sensitive fields are displayed with reveal/copy.

- [ ] **Step 2: Add the Password History section**

Use React Native components (`View`, `Text`, `Pressable`). Add as the **last item** before the action buttons, only for credentials with `passwordHistory.length > 0`.

Key implementation details:

- **State:** Add `historyOpen` (boolean) and `historyRevealed` (Set<number>) state, same as desktop. Reset `historyRevealed` when closing.
- **Toggle button:** A `Pressable` with text "Password History (N)" — use the existing `textSecondary` color and `xs` font size from the theme (`t`).
- **History list:** Use `.map()` (not FlatList — the list is at most 20 items inside a ScrollView). Reverse the array for newest-first display.
- **Each entry:** A `View` row with masked/revealed password text + "Changed on [date]" subtitle. Use `Ionicons` for eye/eye-off toggle (matching the existing password reveal pattern in the file). Copy via the existing `copyToClipboard` helper which already handles haptics + 30-second auto-clear.
- **Clear History:** A danger-colored `Pressable` at the bottom. Use `Alert.alert` with Cancel/Clear buttons for confirmation, then call `updateItem(item.id, { passwordHistory: [] } as any)`.

- [ ] **Step 3: Verify no type errors**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/mobile test`
Expected: Pass

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/item/\\[id\\].tsx
git commit -m "feat(mobile): add password history section to credential detail"
```

---

### Task 7: Add Password History UI to extension detail screen

**Files:**

- Modify: `apps/extension/src/popup/screens/CredentialDetailScreen.tsx`

- [ ] **Step 1: Read the current extension detail screen**

Read `apps/extension/src/popup/screens/CredentialDetailScreen.tsx` fully to understand the component structure and styling patterns.

- [ ] **Step 2: Add the Password History section**

**Important architectural differences from desktop:**

- The extension uses `sendMessage()` from `../hooks/useMessage.js` for store mutations, NOT direct `updateItem()` calls. For clear history: `sendMessage({ type: 'UPDATE_ITEM', id: item.id, updates: { passwordHistory: [] } })`.
- The extension uses a `<CopyButton>` component for clipboard operations, not a manual `handleCopy` function. Reuse `<CopyButton>` for each history entry.
- The `item` prop is typed as `VaultItem` (union type). Use a type guard (`item.type === 'credential'`) before accessing `passwordHistory`.

Add as the **last section** before action buttons, only for credentials with history. Use the existing `sectionStyle`, `labelStyle`, and `valueStyle` patterns from the file. Keep the layout compact (extension popup has limited viewport). Use inline styles matching the existing theme patterns.

For reveal toggle: add local `showHistory` and `historyRevealed` (Set<number>) state. Use eye/eye-off text buttons matching the existing `showPassword` toggle pattern in the file.

For clear history: `sendMessage({ type: 'UPDATE_ITEM', id: item.id, updates: { passwordHistory: [] } })` with a `window.confirm` prompt, then call `onRefresh()`.

- [ ] **Step 3: Build and verify**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/extension build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/popup/screens/CredentialDetailScreen.tsx
git commit -m "feat(extension): add password history section to credential detail"
```

---

### Task 8: Run full test suite and format

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: Run linter and formatter**

Run: `pnpm lint && pnpm format`
Expected: No lint errors, formatting applied

- [ ] **Step 4: Run critical E2E tests**

Run: `cd e2e && npx playwright test --grep @critical`
Expected: Critical tests pass

- [ ] **Step 5: Final commit if formatting changes**

```bash
git add -A
git commit -m "style: format password history changes"
```
