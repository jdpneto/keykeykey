# Mobile E2E — PR-A: testID Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `testID` props needed by Maestro to drive §1–§14 of `base-test-flow.md` on the mobile app — mechanical prop additions, no behavior change.

**Architecture:** The four reusable components (`Button`, `ItemCard`, `TotpCodeDisplay`, `QuickUnlockPrompt`) gain an optional `testID` prop that forwards to their underlying RN `<Pressable>` / wrapper. `TextInput` already forwards all extra props to the native `<RNTextInput>`, so screens pass `testID="…"` directly. Screens then get explicit `testID` props on every element Maestro will tap, matching the desktop `data-testid` naming 1:1 where overlap exists.

**Tech Stack:** React Native 0.76, Expo 52, `@testing-library/react-native`, Jest (jest-expo preset)

**Spec:** `docs/superpowers/specs/2026-04-16-mobile-e2e-pr-a-testid-prep-design.md`

**Rollback plan:** `git revert` the PR. No Maestro flows exist yet, so zero knock-on.

---

## File Structure

Every task below **modifies** existing files. No new files are created in PR-A. Files by area:

- `apps/mobile/components/Button.tsx` — extend Props, forward testID
- `apps/mobile/components/ItemCard.tsx` — accept + forward testID
- `apps/mobile/components/TotpCodeDisplay.tsx` — accept + forward testID
- `apps/mobile/components/QuickUnlockPrompt.tsx` — accept + forward testID
- `apps/mobile/app/setup.tsx` — add testIDs
- `apps/mobile/app/recovery.tsx` — add testIDs
- `apps/mobile/app/unlock.tsx` — add testIDs
- `apps/mobile/app/restore.tsx` — add testIDs
- `apps/mobile/app/(tabs)/index.tsx` — add testIDs
- `apps/mobile/app/(tabs)/generator.tsx` — add testIDs
- `apps/mobile/app/(tabs)/settings.tsx` — add testIDs
- `apps/mobile/app/item/add.tsx` — add testIDs
- `apps/mobile/app/item/edit.tsx` — add testIDs
- `apps/mobile/app/item/[id].tsx` — add testIDs
- `apps/mobile/app/settings/sync.tsx` — add testIDs
- `apps/mobile/app/settings/import.tsx` — add testIDs
- `apps/mobile/app/settings/export.tsx` — add testIDs
- `apps/mobile/__tests__/components/` — add RTL tests that verify testID forwarding on the four reusable components

No snapshot test updates expected — snapshots don't serialize testID in jest-expo's default setup. If any snapshot fails, regenerate with `pnpm --filter @keykeykey/mobile test -u` and note it in the PR description.

---

### Task 1: Extend `Button` to accept and forward `testID`

**Files:**

- Modify: `apps/mobile/components/Button.tsx:4-11` (Props type), `:26-30` (Pressable props)
- Test: `apps/mobile/__tests__/components/Button.test.tsx` (new file)

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/components/Button.test.tsx`:

```typescript
import { render } from '@testing-library/react-native';
import { Button } from '@/components/Button';
import { ThemeProvider } from '@/lib/theme-provider';

describe('Button', () => {
  it('forwards testID prop to the underlying Pressable', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <Button title="Go" onPress={() => {}} testID="setup-submit" />
      </ThemeProvider>,
    );
    expect(getByTestId('setup-submit')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/mobile && pnpm test -- --testPathPattern='components/Button.test.tsx'
```

Expected: FAIL — either TypeScript error (`testID` not assignable to Props) or runtime "unable to find an element with testID: setup-submit".

- [ ] **Step 3: Add `testID` to Button's Props and forward it**

Edit `apps/mobile/components/Button.tsx`:

```typescript
type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
  testID,
}: Props) {
  // … existing body …
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={…}
    >
      …
    </Pressable>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/mobile && pnpm test -- --testPathPattern='components/Button.test.tsx'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/Button.tsx apps/mobile/__tests__/components/Button.test.tsx
git commit -m "feat(mobile): Button forwards testID prop"
```

---

### Task 2: Extend `ItemCard` to accept and forward `testID`

**Files:**

- Modify: `apps/mobile/components/ItemCard.tsx`
- Test: `apps/mobile/__tests__/components/ItemCard.test.tsx` (new file)

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/components/ItemCard.test.tsx`:

```typescript
import { render } from '@testing-library/react-native';
import { ItemCard } from '@/components/ItemCard';
import { ThemeProvider } from '@/lib/theme-provider';

describe('ItemCard', () => {
  const item = {
    id: 'abc-123',
    type: 'credential' as const,
    name: 'GitHub',
    username: 'claude-test',
    password: 'pw',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    passwordHistory: [],
  };

  it('forwards testID prop to the root Pressable', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <ItemCard item={item} onPress={() => {}} testID="vault-item-abc-123" />
      </ThemeProvider>,
    );
    expect(getByTestId('vault-item-abc-123')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/mobile && pnpm test -- --testPathPattern='components/ItemCard.test.tsx'
```

Expected: FAIL.

- [ ] **Step 3: Add `testID` to ItemCard's Props and forward it**

Open `apps/mobile/components/ItemCard.tsx`, add `testID?: string` to the Props type, destructure it, and apply it to the root `<Pressable testID={testID}>`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/mobile && pnpm test -- --testPathPattern='components/ItemCard.test.tsx'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/ItemCard.tsx apps/mobile/__tests__/components/ItemCard.test.tsx
git commit -m "feat(mobile): ItemCard forwards testID prop"
```

---

### Task 3: Extend `TotpCodeDisplay` and `QuickUnlockPrompt`

**Files:**

- Modify: `apps/mobile/components/TotpCodeDisplay.tsx`
- Modify: `apps/mobile/components/QuickUnlockPrompt.tsx`
- Test: `apps/mobile/__tests__/components/TotpCodeDisplay.test.tsx` (new)
- Test: `apps/mobile/__tests__/components/QuickUnlockPrompt.test.tsx` (new)

- [ ] **Step 1: Write failing tests**

Create both test files following the same pattern as Task 1 — render with a `testID` prop, assert `getByTestId` resolves. TotpCodeDisplay's root is likely a `<View>` or `<Pressable>`; apply testID there. QuickUnlockPrompt's biometric button gets testID `quick-unlock-biometric`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/mobile && pnpm test -- --testPathPattern='components/(TotpCodeDisplay|QuickUnlockPrompt).test.tsx'
```

Expected: FAIL.

- [ ] **Step 3: Add `testID` forwarding to both components**

For each file: add `testID?: string` to Props, destructure, forward to the relevant root/interactive element.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && pnpm test -- --testPathPattern='components/(TotpCodeDisplay|QuickUnlockPrompt).test.tsx'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/TotpCodeDisplay.tsx apps/mobile/components/QuickUnlockPrompt.tsx apps/mobile/__tests__/components/TotpCodeDisplay.test.tsx apps/mobile/__tests__/components/QuickUnlockPrompt.test.tsx
git commit -m "feat(mobile): TotpCodeDisplay and QuickUnlockPrompt forward testID prop"
```

---

### Task 4: Add testIDs to `setup.tsx` and `recovery.tsx`

**Files:**

- Modify: `apps/mobile/app/setup.tsx`
- Modify: `apps/mobile/app/recovery.tsx`

- [ ] **Step 1: Edit `setup.tsx`**

Add `testID` props:

```typescript
<TextInput
  testID="setup-password"
  label="Master Password"
  placeholder="Enter master password"
  value={password}
  onChangeText={setPassword}
  isPassword
/>
<TextInput
  testID="setup-confirm"
  label="Confirm Password"
  placeholder="Confirm master password"
  value={confirm}
  onChangeText={setConfirm}
  isPassword
/>
…
<Button
  testID="setup-submit"
  title="Create Vault"
  onPress={handleCreate}
  loading={loading}
  disabled={password.length < 8 || password !== confirm}
/>
<Button
  testID="setup-restore-cloud"
  title="Restore from Cloud"
  variant="secondary"
  onPress={() => router.push('/restore')}
/>
```

- [ ] **Step 2: Edit `recovery.tsx`**

Add `testID` to the acknowledge checkbox (Pressable), "Copy" button, and "Continue" button:

```typescript
<Pressable testID="recovery-acknowledge" onPress={…}>…</Pressable>
<Button testID="recovery-copy" title="Copy" onPress={…} variant="secondary" />
<Button testID="recovery-continue" title="Continue" onPress={…} disabled={!acknowledged} />
```

Use exact element names from the existing file — the testID names above are fixed.

- [ ] **Step 3: Run existing mobile tests to confirm no regression**

```bash
cd apps/mobile && pnpm test
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/setup.tsx apps/mobile/app/recovery.tsx
git commit -m "feat(mobile): add testIDs to setup and recovery screens"
```

---

### Task 5: Add testIDs to `unlock.tsx` and `restore.tsx`

**Files:**

- Modify: `apps/mobile/app/unlock.tsx`
- Modify: `apps/mobile/app/restore.tsx`

- [ ] **Step 1: Edit `unlock.tsx`**

For the master-password branch:

```typescript
<TextInput testID="unlock-password" label="Master Password" value={…} onChangeText={…} isPassword />
<Button testID="unlock-submit" title="Unlock" onPress={…} loading={loading} />
<Pressable testID="unlock-use-pin" onPress={…}><Text>Use PIN instead</Text></Pressable>
```

For the PIN branch — add `testID` to each PinPad digit. If the PinPad is a shared component, add `testID` prop to it and apply `testID={\`unlock-pin-pad-\${digit}\`}` in the PinPad's render loop, plus `unlock-pin-backspace` on the backspace button:

```typescript
// In PinPad component (or inline):
<Pressable testID={`unlock-pin-pad-${digit}`} onPress={…}><Text>{digit}</Text></Pressable>
<Pressable testID="unlock-pin-backspace" onPress={…}><Icon name="backspace" /></Pressable>
<Pressable testID="unlock-use-password" onPress={…}><Text>Use master password instead</Text></Pressable>
```

- [ ] **Step 2: Edit `restore.tsx`**

```typescript
<Picker testID="restore-provider" …>…</Picker>
<TextInput testID="restore-webdav-url" … />
<TextInput testID="restore-webdav-username" … />
<TextInput testID="restore-webdav-password" … isPassword />
<Button testID="restore-next" title="Next" … />
<TextInput testID="restore-master-password" … isPassword />
<Button testID="restore-submit" title="Restore Vault" … />
```

- [ ] **Step 3: Run mobile tests**

```bash
cd apps/mobile && pnpm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/unlock.tsx apps/mobile/app/restore.tsx
git commit -m "feat(mobile): add testIDs to unlock and restore screens"
```

---

### Task 6: Add testIDs to vault list + item screens

**Files:**

- Modify: `apps/mobile/app/(tabs)/index.tsx`
- Modify: `apps/mobile/app/item/add.tsx`
- Modify: `apps/mobile/app/item/edit.tsx`
- Modify: `apps/mobile/app/item/[id].tsx`

- [ ] **Step 1: Edit `(tabs)/index.tsx`**

Vault list testIDs:

```typescript
<Pressable testID="vault-add-button" onPress={…}>+</Pressable>
<TextInput testID="vault-search" placeholder="Search" … />
<Button testID="vault-lock-button" title="Lock Vault" variant="secondary" onPress={…} />

{items.map((item) => (
  <ItemCard key={item.id} item={item} testID={`vault-item-${item.id}`} onPress={…} />
))}
```

- [ ] **Step 2: Edit `item/add.tsx` and `item/edit.tsx`**

Add testIDs to tab triggers, every TextInput, and save/cancel:

```typescript
<Pressable testID="add-tab-login" onPress={() => setType('credential')}>Login</Pressable>
<Pressable testID="add-tab-card" onPress={() => setType('card')}>Card</Pressable>
<Pressable testID="add-tab-note" onPress={() => setType('secure-note')}>Note</Pressable>

<TextInput testID="add-name" label="Name" … />
<TextInput testID="add-url" label="URL" … />
<TextInput testID="add-username" label="Username" … />
<TextInput testID="add-password" label="Password" isPassword … onGenerate={openGenerator} />
<TextInput testID="add-notes" label="Notes" multiline … />

{/* Card variant */}
<TextInput testID="add-cardholder" label="Cardholder" … />
<TextInput testID="add-cardnumber" label="Card Number" … />
<TextInput testID="add-month" label="Month" … />
<TextInput testID="add-year" label="Year" … />
<TextInput testID="add-cvv" label="CVV" … />

{/* Note variant */}
<TextInput testID="add-content" label="Content" multiline … />

<Button testID="add-save" title="Save" onPress={…} />
<Button testID="add-cancel" title="Cancel" variant="secondary" onPress={…} />
```

The "Generate" icon in the password TextInput is already an internal Pressable in `TextInput.tsx` — it doesn't need a testID (Maestro will tap the password field's regenerate affordance via its visible icon if needed). If you want an explicit one, add `testID="add-generate"` to the Pressable wrapping the `dice-outline` icon in `components/TextInput.tsx` (optional).

If `edit.tsx` renders the same form component as `add.tsx` (check imports), adding testIDs to the shared form covers both. Otherwise duplicate the same testID additions in `edit.tsx`.

- [ ] **Step 3: Edit `item/[id].tsx`**

```typescript
<Button testID="detail-copy-username" title="Copy username" … />
<Button testID="detail-copy-password" title="Copy password" … />
<Pressable testID="detail-reveal-password" onPress={…}><Icon name="eye" /></Pressable>
<Button testID="detail-edit" title="Edit" … />
<Button testID="detail-delete" title="Delete" variant="danger" … />
<Pressable testID="detail-password-history" onPress={…}><Text>Password History ({history.length})</Text></Pressable>

<TotpCodeDisplay testID="detail-totp-code" … />
<Button testID="detail-totp-copy" title="Copy code" … />
```

- [ ] **Step 4: Run mobile tests**

```bash
cd apps/mobile && pnpm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/index.tsx apps/mobile/app/item/
git commit -m "feat(mobile): add testIDs to vault list and item screens"
```

---

### Task 7: Add testIDs to generator, settings, sync, import, export screens

**Files:**

- Modify: `apps/mobile/app/(tabs)/generator.tsx`
- Modify: `apps/mobile/app/(tabs)/settings.tsx`
- Modify: `apps/mobile/app/settings/sync.tsx`
- Modify: `apps/mobile/app/settings/import.tsx`
- Modify: `apps/mobile/app/settings/export.tsx`

- [ ] **Step 1: Edit `generator.tsx`**

```typescript
<Text testID="gen-password-output">{generatedPassword}</Text>
<Button testID="gen-regenerate" title="Regenerate" onPress={…} />
<Button testID="gen-copy" title="Copy" onPress={…} />
<Pressable testID="gen-mode-random" onPress={…}>Random</Pressable>
<Pressable testID="gen-mode-passphrase" onPress={…}>Passphrase</Pressable>
<Slider testID="gen-length-slider" … />
```

- [ ] **Step 2: Edit `(tabs)/settings.tsx`**

The two existing testIDs get renamed if needed to match the convention. Add:

```typescript
<Pressable testID="settings-sync" onPress={() => router.push('/settings/sync')}>Cloud Sync</Pressable>
<Pressable testID="settings-import" onPress={() => router.push('/settings/import')}>Import Passwords</Pressable>
<Pressable testID="settings-export" onPress={() => router.push('/settings/export')}>Export Vault</Pressable>
<Pressable testID="settings-security" onPress={…}>Security</Pressable>
<Button testID="settings-reset-vault" title="Reset Vault" variant="danger" onPress={…} />
<Button testID="settings-reset-confirm" title="Reset" variant="danger" onPress={confirmReset} />
<Button testID="settings-lock-vault" title="Lock Vault" variant="secondary" onPress={…} />
```

- [ ] **Step 3: Edit `settings/sync.tsx`**

```typescript
<Picker testID="sync-provider" …>…</Picker>
<TextInput testID="sync-webdav-url" … />
<TextInput testID="sync-webdav-username" … />
<TextInput testID="sync-webdav-password" … isPassword />
<TextInput testID="sync-master-password" … isPassword />
<Button testID="sync-connect" title="Connect" … />
<Button testID="sync-disconnect" title="Disconnect" variant="secondary" … />
<Button testID="sync-now" title="Sync Now" … />
<Text testID="sync-status">{statusLine}</Text>

{/* Conflict dialog buttons */}
<Button testID="sync-conflict-merge" title="Merge Vaults" … />
<Button testID="sync-conflict-replace-local" title="Replace Local with Remote" … />
<Button testID="sync-conflict-replace-remote" title="Replace Remote with Local" … />
<Button testID="sync-conflict-cancel" title="Cancel" variant="secondary" … />
```

- [ ] **Step 4: Edit `settings/import.tsx`**

```typescript
<Pressable testID="import-tab-csv" onPress={…}>From CSV</Pressable>
<Pressable testID="import-tab-encrypted" onPress={…}>From Encrypted Backup</Pressable>
<Button testID="import-pick-file" title="Pick file" onPress={…} />
<Text testID="import-source-badge">Source: {detectedSource}</Text>
<Pressable testID="import-mode-merge" onPress={…}>Merge</Pressable>
<Pressable testID="import-mode-add-all" onPress={…}>Add All</Pressable>
<Button testID="import-start" title="Import" onPress={…} />
<TextInput testID="import-backup-password" … isPassword />
<TextInput testID="import-master-password" … isPassword />
```

- [ ] **Step 5: Edit `settings/export.tsx`**

```typescript
<Pressable testID="export-tab-csv" onPress={…}>Export as CSV</Pressable>
<Pressable testID="export-tab-encrypted" onPress={…}>Encrypted Backup</Pressable>
<Button testID="export-csv-submit" title="Export CSV" onPress={…} />
<TextInput testID="export-backup-password" … isPassword />
<TextInput testID="export-backup-confirm" … isPassword />
<Button testID="export-backup-submit" title="Export Backup" onPress={…} />
<View testID="export-confirm-dialog">{/* plaintext warning */}</View>
```

- [ ] **Step 6: Run mobile tests**

```bash
cd apps/mobile && pnpm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/app/\(tabs\)/generator.tsx apps/mobile/app/\(tabs\)/settings.tsx apps/mobile/app/settings/
git commit -m "feat(mobile): add testIDs to generator, settings, sync, import, export"
```

---

### Task 8: Add testIDs to PIN setting + PinPad

**Files:**

- Modify: the PIN-setting view (likely `apps/mobile/app/(tabs)/settings.tsx` or a child under `app/settings/security.tsx` — search with `grep -r "pin" apps/mobile/app/`)
- Modify: the PinPad component (find via `grep -rn "PinPad\|pin-pad" apps/mobile/`)

- [ ] **Step 1: Find the PIN screen and PinPad**

```bash
grep -rn "PinPad\|Set PIN\|Change PIN" apps/mobile/app apps/mobile/components
```

Record the file paths. If the PIN-setting UI lives inline in `(tabs)/settings.tsx`, modify it there. If it's a dedicated file, modify that.

- [ ] **Step 2: Add testIDs to PinPad digits**

In the PinPad component, apply testIDs on the digit buttons. The PinPad is used on both the unlock screen and the PIN-set screen — use a `testIDPrefix` prop so the same PinPad renders `unlock-pin-pad-N` on unlock and `pin-pad-N` on set:

```typescript
type PinPadProps = {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  testIDPrefix?: string;  // e.g., "unlock-pin" or "pin"
};

// Inside PinPad render:
{['1','2','3','4','5','6','7','8','9','0'].map((d) => (
  <Pressable
    key={d}
    testID={`${testIDPrefix ?? 'pin'}-pad-${d}`}
    onPress={() => onDigit(d)}
  >
    <Text>{d}</Text>
  </Pressable>
))}
<Pressable
  testID={`${testIDPrefix ?? 'pin'}-backspace`}
  onPress={onBackspace}
>
  <Icon name="backspace" />
</Pressable>
```

Then at callsites:
- Unlock screen: `<PinPad testIDPrefix="unlock-pin" … />`
- PIN-set screen: `<PinPad testIDPrefix="pin" … />`

- [ ] **Step 3: Add testIDs to PIN-set flow**

```typescript
<TextInput testID="pin-set-input" value={pin} onChangeText={setPin} keyboardType="number-pad" maxLength={6} />
<TextInput testID="pin-confirm-input" value={confirmPin} onChangeText={setConfirmPin} keyboardType="number-pad" maxLength={6} />
<Button testID="pin-set-submit" title="Set PIN" onPress={…} />
<Button testID="pin-change-submit" title="Change PIN" onPress={…} />
```

- [ ] **Step 4: Run mobile tests**

```bash
cd apps/mobile && pnpm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/  # scope to PIN-related diffs from this task only
git commit -m "feat(mobile): add testIDs to PIN set flow and PinPad"
```

---

### Task 9: Lint + manual smoke on both platforms

**Files:** no file changes in this task.

- [ ] **Step 1: Run lint and all mobile tests**

```bash
cd apps/mobile && pnpm lint && pnpm test
```

Expected: no errors, all tests pass.

- [ ] **Step 2: Boot iOS Simulator + install the dev build**

```bash
cd apps/mobile && npx expo run:ios --device "iPhone 17 Pro"
```

Manually smoke-test: create vault with `test1234` → land on recovery → acknowledge → land on vault. Add a login. Lock. Unlock. Should all work exactly as it did before PR-A.

- [ ] **Step 3: Boot Android Emulator + install**

```bash
cd apps/mobile && npx expo run:android
```

Same smoke: create vault → add login → lock → unlock. No visual regressions.

- [ ] **Step 4: Verify testIDs are queryable from a live session**

On iOS, install Maestro for a one-off verify (does not commit):

```bash
curl -Ls get.maestro.mobile.dev | bash   # skip if already installed
maestro hierarchy | grep setup-password
```

Expected: the Create Vault screen's password field appears with `resource-id` or `testID` matching `setup-password`.

- [ ] **Step 5: Final verification comment in the PR**

Open the PR. Add a comment or PR description section listing the testIDs added per screen (copy from the spec's inventory table). This helps the reviewer cross-check.

- [ ] **Step 6: If any smoke-test regression — stop and investigate**

Do NOT merge PR-A with regressions. Revert locally, identify which task introduced the regression, and fix before re-pushing. Treat a regression here as critical since PR-B depends on these testIDs.

---

## Self-Review Checklist

Before requesting review, confirm:

- [ ] Every testID in the PR-A spec inventory table has been added.
- [ ] No snapshot updates were silently committed (if any, note them in the PR).
- [ ] `pnpm --filter @keykeykey/mobile test` passes.
- [ ] `pnpm --filter @keykeykey/mobile lint` passes.
- [ ] iOS Simulator smoke passed.
- [ ] Android Emulator smoke passed.
- [ ] `git diff main --stat` shows only mobile files + new tests under `__tests__/components/`.
- [ ] Commit messages follow `feat(mobile): …` style.

When all confirmed, push and request review.
