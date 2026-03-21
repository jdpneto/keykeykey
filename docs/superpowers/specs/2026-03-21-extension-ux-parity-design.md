# Browser Extension UX Parity

Bring the browser extension's usability in line with the desktop and mobile apps. The extension currently has several rough edges: cramped dimensions, inconsistent toolbar icons, missing password visibility toggles, a broken auto-lock timeout picker, a raw crypto error on wrong password, and a generator flow that navigates away from the add form.

## 1. Popup Dimensions

**Problem:** The popup is 360x480px — noticeably smaller than competitors like Bitwarden (~380x600px). The cramped space makes the vault list feel like "just a list" and pushes the FAB off-screen.

**Change:** Increase to **380x600px**. Update in three locations:

| File | What changes |
|------|-------------|
| `apps/extension/src/popup/index.html` | `html, body { width: 380px; min-height: 600px; }` |
| `apps/extension/src/popup/Popup.tsx` | `containerStyle`: `width: '380px'`, `minHeight: '600px'` |
| All screens with `minHeight: '480px'` | Update to `'600px'` (VaultListScreen, AddItemScreen, EditItemScreen, SettingsScreen, etc.) |

## 2. Toolbar Icon Consistency & New Icons

**Problem:** The toolbar uses HTML entities (&#8635; sync, &#9881; settings, &#128273; key) which render at inconsistent sizes and the key emoji clashes with the dark green theme.

**Change:** Replace all toolbar icons with inline SVG components. All icons share:
- **Size:** 20x20px viewBox, `currentColor` stroke
- **Button container:** 32x32px hit target, 4px padding, `theme.colors.textSecondary` color
- **Hover:** Subtle opacity or color shift

### Icon Set

| Position | Icon | SVG description | Action |
|----------|------|----------------|--------|
| 1 | Sync | Circular arrows (existing &#8635; replaced) | `handleSync()` — triggers cloud sync. Only shown when sync is connected. |
| 2 | Add | Plus in circle | `onNavigate('add')` — replaces the FAB |
| 3 | Generator | Dice (single die face) | `onNavigate('generator')` — opens standalone generator screen |
| 4 | Lock | Padlock | `sendMessage({ type: 'LOCK' })` then `refresh()` — immediate vault lock |
| 5 | Settings | Gear/cog | `onNavigate('settings')` |

### Implementation

Create a shared `ToolbarIcon` component or a set of SVG icon components in `apps/extension/src/popup/components/icons/`. Each icon is a React component accepting `size` and `color` props, defaulting to 20 and `currentColor`.

All icon-only toolbar buttons must include `aria-label` for screen reader accessibility (e.g., `aria-label="Add item"`, `aria-label="Lock vault"`).

The toolbar button wrapper style is defined once and reused:

```typescript
const toolbarButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: theme.colors.textSecondary,
  cursor: 'pointer',
  padding: 4,
  borderRadius: theme.radii.sm,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
};
```

## 3. Remove Floating Action Button

**Problem:** The FAB at bottom-right gets hidden behind long lists and is inconsistent with how the desktop/mobile apps handle "add."

**Change:** Delete the FAB from `VaultListScreen.tsx` (lines 264-288). The "add" action moves to the toolbar (Section 2). Also remove the `paddingBottom: 64` on the item list that was reserving space for the FAB.

## 4. Search Placeholder Fix

**Problem:** The search input placeholder displays the literal text `Search vault\u2026` (with visible backslash) instead of `Search vault…` (with ellipsis character). The user's screenshot confirms this.

**Change:** In `VaultListScreen.tsx`, replace the `\u2026` escape sequence in the placeholder with a literal ellipsis character `…`. The escape should work in a JSX string attribute, but may be getting double-escaped during the build. Using the literal character avoids the issue entirely:

```typescript
placeholder="Search vault…"
```

## 5. Inline Password Generator

**Problem:** Clicking "Generate" beside the password field in AddItemScreen navigates to the full GeneratorScreen, losing the user's form state.

**Change:** Replace the navigation call with an inline generation call.

**Dependency:** This section requires the `showPassword` state introduced in Section 6. Implement Section 6 first (or together with this section).

### AddItemScreen changes

Add a `showPassword` state boolean (see Section 6), then:

```typescript
import { generatePassword } from '@keykeykey/core/generator';

// In the password field row:
<button onClick={() => {
  const pw = generatePassword({
    mode: 'random',
    length: 20,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
  });
  setPassword(pw);
  setShowPassword(true); // reveal the generated password
}}>
  {password ? <RefreshIcon size={16} /> : 'Generate'}
</button>
```

**Behavior:**
- First click: generates a 20-char random password with all character classes, fills the field, reveals it (switches to `type="text"`)
- After generation: button shows a small refresh/regenerate SVG icon (consistent style with toolbar icons)
- Each click regenerates with the same defaults

### EditItemScreen changes

Apply the same pattern to the password field in EditItemScreen.

## 6. Password Visibility Toggle (Eye Icon)

**Problem:** Password fields on Add/Edit screens have no way to toggle visibility. The detail screen uses text "Show/Hide" buttons but the forms have nothing.

**Change:** Add an eye/eye-off toggle button to sensitive input fields.

### Affected fields

| Screen | Fields | Current input type | Change needed |
|--------|--------|--------------------|---------------|
| AddItemScreen | Password | `password` | Add toggle |
| EditItemScreen | Password | `password` | Add toggle |
| AddItemScreen (card) | CVV, PIN | `text` (not masked!) | Change default to `password`, add toggle |
| EditItemScreen (card) | CVV, PIN | `text` (not masked!) | Change default to `password`, add toggle |

**Note:** CVV and PIN fields on card forms currently use `type="text"` and are visible in cleartext. The first step is to change their default type to `"password"`, then add the eye toggle.

### Implementation

Each field gets a `show*` state boolean (e.g., `showPassword`, `showCvv`, `showPin`). The input row renders:

```
[input type={show ? "text" : "password"}] [eye-toggle] [generate?]
```

The eye toggle is a 16x16 SVG icon button (eye-open when hidden, eye-off/slashed when visible). Positioned inline within the flex row alongside the input.

Create `EyeIcon` and `EyeOffIcon` SVG components in the shared icons directory.

All icon-only buttons must include `aria-label` for accessibility (e.g., `aria-label="Show password"`, `aria-label="Hide password"`).

## 7. Auto-Lock Timeout Fix

**Problem:** When "After timeout" is selected, no duration picker appears. The timeout presets exist in code (`AUTO_LOCK_MINUTES = [5, 15, 30, 60]`) but the picker never renders.

**Root cause:** The `GET_SETTINGS` message handler returns `{ settings: { autoLockMode, ... } }` — the settings object is nested inside a `settings` key. But `SettingsScreen` at line 55 does `setSettings(s)` where `s` is the full response, so `settings.autoLockMode` in the component state is `undefined` (the actual value is at `settings.settings.autoLockMode`). This makes the conditional `settings?.autoLockMode === 'timed'` always falsy, hiding the timeout picker.

### Changes

**SettingsScreen.tsx:**

1. Fix the settings unwrapping: when processing the GET_SETTINGS response, extract the nested settings object. Alternatively, add a fallback: change the conditional from `settings?.autoLockMode === 'timed'` to `(settings?.autoLockMode ?? 'timed') === 'timed'` as a defensive fix, but also fix the response unwrapping at line 55 to properly read `(settingsResult as { settings: Settings }).settings`.

2. Expand timeout presets:
```typescript
const AUTO_LOCK_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 480, label: '8 hours' },
  { value: 1440, label: '24 hours' },
] as const;
```

**messages.ts:**

3. Change default timeout from 15 to 60 minutes:
```typescript
export const DEFAULT_SETTINGS: Settings = {
  autoLockMode: 'timed',
  autoLockMinutes: 60,  // was 15
  themeMode: 'system',
};
```

## 8. Friendly Unlock Error Message

**Problem:** Entering a wrong master password shows "invalid tag" — a raw error from `@noble/ciphers`' Poly1305 authentication tag verification.

**Error flow:**
1. Wrong password → wrong KEK derived via Argon2id
2. `unwrapDEK()` calls `decrypt()` with wrong KEK
3. `xchacha20poly1305.decrypt()` throws `Error('invalid tag')`
4. `message-handler.ts` catches it and returns `{ error: 'invalid tag' }`
5. `UnlockScreen` displays it verbatim

**Change:** In `apps/extension/src/background/message-handler.ts`, in the UNLOCK case's catch block, detect the "invalid tag" error and return a user-friendly message:

```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : 'Unlock failed';
  if (msg === 'invalid tag') {
    return { error: 'Incorrect master password.' };
  }
  return { error: msg };
}
```

Apply the same fix to the UNLOCK_PIN handler if it exists and has the same issue.

**Note:** `UnlockScreen.tsx` already displays whatever error string is returned from the background handler (`setError(result.error)`), so no changes are needed on the UI side — only the message-handler needs updating.

## 9. Lock Icon in Toolbar

**Problem:** Locking the vault is only available deep in Settings. Users need quick access.

**Change:** Already specified in Section 2, position 4. This section provides implementation details.

VaultListScreen must accept a new `onLock` callback prop (or call `sendMessage` directly). The `Popup.tsx` parent wires this to `refresh()` so the UI transitions to the unlock screen, matching the existing pattern in `SettingsScreen.handleLock`:

```typescript
// In VaultListScreen:
const handleLock = async () => {
  await sendMessage({ type: 'LOCK' });
  onLock(); // calls refresh() from Popup.tsx to trigger UI transition
};
```

**Note:** VaultListScreen does not currently subscribe to `useVaultStatus` — only `Popup.tsx` does. So the lock handler must explicitly call back to the parent via `onLock`/`refresh()` to trigger the screen transition.

The "Lock Vault" button in SettingsScreen remains as-is for discoverability.

## Files Modified

| File | Changes |
|------|---------|
| `apps/extension/src/popup/index.html` | Dimensions 380x600 |
| `apps/extension/src/popup/Popup.tsx` | Dimensions 380x600 |
| `apps/extension/src/popup/screens/VaultListScreen.tsx` | Remove FAB, add toolbar icons (add, lock), replace HTML entities with SVGs, fix search placeholder, update minHeight |
| `apps/extension/src/popup/screens/AddItemScreen.tsx` | Inline generator, eye toggle on password/CVV/PIN, update minHeight |
| `apps/extension/src/popup/screens/EditItemScreen.tsx` | Inline generator, eye toggle on password/CVV/PIN, update minHeight |
| `apps/extension/src/popup/screens/SettingsScreen.tsx` | Fix timeout picker conditional, expand presets, update minHeight |
| `apps/extension/src/popup/components/icons/` | New directory with SVG icon components (SyncIcon, PlusIcon, DiceIcon, LockIcon, GearIcon, EyeIcon, EyeOffIcon, RefreshIcon) |
| `apps/extension/src/lib/messages.ts` | Change `autoLockMinutes` default to 60 |
| `apps/extension/src/background/message-handler.ts` | Friendly error for wrong password |

## Security Note

Changing the default auto-lock timeout from 15 to 60 minutes is a deliberate tradeoff: the 15-minute default was too aggressive for typical browsing sessions, leading users to select "Never" instead. A 60-minute default provides reasonable security while reducing friction. Users who need tighter lockdown can still select 5 or 15 minutes.

## Testing

### Manual / Visual

- **Dimensions:** Reload extension in Chrome, verify popup is 380x600, content fills the space.
- **Toolbar icons:** Verify all 5 icons render at consistent size, color matches `textSecondary`, hover state works, and both light/dark themes look correct.
- **Inline generator:** Add a new credential, click Generate, verify password is filled and visible. Click regenerate, verify new password appears.
- **Eye toggle:** Verify password/CVV/PIN fields toggle between masked and visible. Verify CVV and PIN default to masked.
- **Timeout picker:** Open Settings, verify "After timeout" shows duration dropdown with all 7 presets. Change timeout, close and reopen popup, verify it persists.
- **Wrong password:** Lock vault, enter wrong password, verify "Incorrect master password." appears instead of "invalid tag."
- **Lock icon:** Click lock icon in toolbar, verify vault locks and unlock screen appears.

### Unit Tests (Vitest)

- **Error mapping:** Test that the UNLOCK handler returns "Incorrect master password." when the underlying error is "invalid tag."
- **Settings unwrapping:** Test that SettingsScreen correctly reads autoLockMode from the GET_SETTINGS response shape.

### E2E

- Run `cd e2e && npx playwright test --project=extension` to verify no regressions.
