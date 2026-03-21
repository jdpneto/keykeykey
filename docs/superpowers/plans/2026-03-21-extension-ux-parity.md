# Browser Extension UX Parity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the browser extension's usability in line with the desktop and mobile apps — bigger popup, consistent toolbar icons, inline generator, eye toggles, timeout fix, friendly errors, and quick-lock.

**Architecture:** All changes are in `apps/extension/`. SVG icons are extracted into a shared `icons/` directory. The inline generator imports `generatePassword` directly from `@keykeykey/core/generator` instead of navigating to a separate screen. The auto-lock timeout bug is fixed by properly unwrapping the `GET_SETTINGS` response.

**Tech Stack:** React, TypeScript, Vite, CRXJS, Vitest, @testing-library/react

**Spec:** `docs/superpowers/specs/2026-03-21-extension-ux-parity-design.md`

---

### Task 1: Create SVG Icon Components

**Files:**
- Create: `apps/extension/src/popup/components/icons/index.tsx`

All icons are React functional components accepting `{ size?: number; color?: string }`, defaulting to `size=20, color='currentColor'`. Each renders an `<svg>` with `viewBox="0 0 24 24"`, `width={size}`, `height={size}`, `stroke={color}`, `fill="none"`, `strokeWidth={2}`, `strokeLinecap="round"`, `strokeLinejoin="round"`.

- [ ] **Step 1: Create the icons file with all 8 icons**

Create `apps/extension/src/popup/components/icons/index.tsx` with these components (using `.tsx` extension for consistency with the rest of the project):

```typescript
import React from 'react';

interface IconProps {
  size?: number;
  color?: string;
}

const defaultProps = { size: 20, color: 'currentColor' };

export function SyncIcon({ size = defaultProps.size, color = defaultProps.color }: IconProps) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  },
    React.createElement('path', { d: 'M21 2v6h-6' }),
    React.createElement('path', { d: 'M3 12a9 9 0 0 1 15-6.7L21 8' }),
    React.createElement('path', { d: 'M3 22v-6h6' }),
    React.createElement('path', { d: 'M21 12a9 9 0 0 1-15 6.7L3 16' }),
  );
}

export function PlusIcon({ size = defaultProps.size, color = defaultProps.color }: IconProps) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  },
    React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
    React.createElement('line', { x1: 12, y1: 8, x2: 12, y2: 16 }),
    React.createElement('line', { x1: 8, y1: 12, x2: 16, y2: 12 }),
  );
}

export function DiceIcon({ size = defaultProps.size, color = defaultProps.color }: IconProps) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  },
    React.createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }),
    React.createElement('circle', { cx: 8.5, cy: 8.5, r: 1.5, fill: color, stroke: 'none' }),
    React.createElement('circle', { cx: 15.5, cy: 8.5, r: 1.5, fill: color, stroke: 'none' }),
    React.createElement('circle', { cx: 8.5, cy: 15.5, r: 1.5, fill: color, stroke: 'none' }),
    React.createElement('circle', { cx: 15.5, cy: 15.5, r: 1.5, fill: color, stroke: 'none' }),
  );
}

export function LockIcon({ size = defaultProps.size, color = defaultProps.color }: IconProps) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  },
    React.createElement('rect', { x: 3, y: 11, width: 18, height: 11, rx: 2 }),
    React.createElement('path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }),
  );
}

export function GearIcon({ size = defaultProps.size, color = defaultProps.color }: IconProps) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  },
    React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
    React.createElement('path', {
      d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    }),
  );
}

export function EyeIcon({ size = defaultProps.size, color = defaultProps.color }: IconProps) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  },
    React.createElement('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }),
    React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
  );
}

export function EyeOffIcon({ size = defaultProps.size, color = defaultProps.color }: IconProps) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  },
    React.createElement('path', { d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94' }),
    React.createElement('path', { d: 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19' }),
    React.createElement('path', { d: 'M14.12 14.12a3 3 0 1 1-4.24-4.24' }),
    React.createElement('line', { x1: 1, y1: 1, x2: 23, y2: 23 }),
  );
}

export function RefreshIcon({ size = defaultProps.size, color = defaultProps.color }: IconProps) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  },
    React.createElement('path', { d: 'M23 4v6h-6' }),
    React.createElement('path', { d: 'M1 20v-6h6' }),
    React.createElement('path', { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10' }),
    React.createElement('path', { d: 'M20.49 15a9 9 0 0 1-14.85 3.36L1 14' }),
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd apps/extension && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/popup/components/icons/index.tsx
git commit -m "feat(extension): add SVG icon components for toolbar"
```

---

### Task 2: Popup Dimensions (360x480 → 380x600)

**Files:**
- Modify: `apps/extension/src/popup/index.html:9`
- Modify: `apps/extension/src/popup/Popup.tsx:47-48`
- Modify: All screens with `minHeight: '480px'` (see list below)

Screens with `minHeight: '480px'`:
- `Popup.tsx:47`
- `VaultListScreen.tsx:109`
- `AddItemScreen.tsx:353`
- `EditItemScreen.tsx:334`
- `CredentialDetailScreen.tsx:206`
- `GeneratorScreen.tsx:130`
- `SettingsScreen.tsx:178,188`
- `SyncSettingsScreen.tsx:279,289`
- `RestoreScreen.tsx:122`

- [ ] **Step 1: Update index.html**

In `apps/extension/src/popup/index.html`, change line 9:
```html
html, body { width: 380px; min-height: 600px; overflow-x: hidden; }
```

- [ ] **Step 2: Update Popup.tsx containerStyle**

In `apps/extension/src/popup/Popup.tsx`, change `containerStyle` (lines 47-48):
```typescript
minHeight: '600px',
width: '380px',
```

- [ ] **Step 3: Update all screen minHeight references**

In every file listed above, replace `minHeight: '480px'` with `minHeight: '600px'`. Use find-and-replace scoped to `apps/extension/src/popup/`.

- [ ] **Step 4: Verify build**

Run: `cd apps/extension && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/popup/
git commit -m "feat(extension): increase popup dimensions to 380x600"
```

---

### Task 3: Toolbar Redesign (VaultListScreen)

**Files:**
- Modify: `apps/extension/src/popup/screens/VaultListScreen.tsx`
- Modify: `apps/extension/src/popup/Popup.tsx` (add `onLock` prop wiring)

This task replaces all HTML entity icons with SVG components, removes the FAB, adds the "+" and lock buttons to the toolbar, and fixes the search placeholder.

- [ ] **Step 1: Update VaultListScreen props interface**

Add `onLock` callback to the props interface in `VaultListScreen.tsx`:

```typescript
interface VaultListScreenProps {
  onNavigate: (screen: string) => void;
  onLock: () => void;
}

export function VaultListScreen({ onNavigate, onLock }: VaultListScreenProps) {
```

- [ ] **Step 2: Add imports and lock handler**

At the top of `VaultListScreen.tsx`, add the icon imports:

```typescript
import { SyncIcon, PlusIcon, DiceIcon, LockIcon, GearIcon } from '../components/icons/index.js';
```

Add a `handleLock` function inside the component:

```typescript
const handleLock = async () => {
  await sendMessage({ type: 'LOCK' });
  onLock();
};
```

- [ ] **Step 3: Define toolbar button style**

Add a shared toolbar button style inside the component:

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

- [ ] **Step 4: Replace the toolbar buttons**

Replace the entire toolbar section (sync button at lines 133-151, settings button at lines 152-166, generator button at lines 167-181) with:

```tsx
{syncConnected && (
  <button
    onClick={handleSync}
    disabled={syncing}
    style={{ ...toolbarButtonStyle, opacity: syncing ? 0.5 : 1, cursor: syncing ? 'default' : 'pointer' }}
    aria-label="Sync Now"
  >
    <SyncIcon />
  </button>
)}
<button onClick={() => onNavigate('add')} style={toolbarButtonStyle} aria-label="Add item">
  <PlusIcon />
</button>
<button onClick={() => onNavigate('generator')} style={toolbarButtonStyle} aria-label="Password Generator">
  <DiceIcon />
</button>
<button onClick={handleLock} style={toolbarButtonStyle} aria-label="Lock vault">
  <LockIcon />
</button>
<button onClick={() => onNavigate('settings')} style={toolbarButtonStyle} aria-label="Settings">
  <GearIcon />
</button>
```

- [ ] **Step 5: Fix search placeholder**

In the search input (line 190), change:
```typescript
placeholder="Search vault\u2026"
```
to:
```typescript
placeholder="Search vault…"
```

- [ ] **Step 6: Remove the FAB**

Delete the entire `{/* Floating add button */}` section (the `<button>` with `position: 'absolute', bottom: ...` through its closing `</button>` and the closing comment).

Also remove `paddingBottom: 64` from the item list container style (line 230).

- [ ] **Step 7: Wire onLock in Popup.tsx**

In `apps/extension/src/popup/Popup.tsx`, update the VaultListScreen render (line 103):

```typescript
return <VaultListScreen onNavigate={handleNavigate} onLock={refresh} />;
```

And the fallback at line 184:
```typescript
return <VaultListScreen onNavigate={handleNavigate} onLock={refresh} />;
```

- [ ] **Step 8: Verify build**

Run: `cd apps/extension && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 9: Update VaultListScreen test**

In `apps/extension/src/popup/screens/VaultListScreen.test.tsx`:

1. Update the `renderVaultList` helper (line 84) to include `onLock`:
```typescript
function renderVaultList(onNavigate = vi.fn(), onLock = vi.fn()) {
  return render(<VaultListScreen onNavigate={onNavigate} onLock={onLock} />);
}
```

2. Update all direct renders that pass `onNavigate` to also pass `onLock`:
```typescript
renderVaultList(onNavigate);
// becomes:
renderVaultList(onNavigate, vi.fn());
```

3. **Critical:** The toolbar buttons now use `aria-label` instead of `title`. Update the test queries:
   - Line 171: `screen.getByTitle('Add item')` → `screen.getByLabelText('Add item')`
   - Line 174: `screen.getByTitle('Add item')` → `screen.getByLabelText('Add item')`
   - Line 184: `screen.getByTitle('Settings')` → `screen.getByLabelText('Settings')`
   - Line 187: `screen.getByTitle('Settings')` → `screen.getByLabelText('Settings')`

4. Add a mock for the icons module (since icon components are rendered):
```typescript
vi.mock('../components/icons/index.js', () => ({
  SyncIcon: () => 'SyncIcon',
  PlusIcon: () => 'PlusIcon',
  DiceIcon: () => 'DiceIcon',
  LockIcon: () => 'LockIcon',
  GearIcon: () => 'GearIcon',
}));
```

- [ ] **Step 10: Run tests**

Run: `pnpm --filter @keykeykey/extension test`
Expected: All tests pass.

- [ ] **Step 11: Commit**

```bash
git add apps/extension/src/popup/screens/VaultListScreen.tsx apps/extension/src/popup/Popup.tsx apps/extension/src/popup/screens/VaultListScreen.test.tsx
git commit -m "feat(extension): redesign toolbar with consistent SVG icons, add lock button"
```

---

### Task 4: Eye Toggle + Inline Generator on AddItemScreen

**Files:**
- Modify: `apps/extension/src/popup/screens/AddItemScreen.tsx`

- [ ] **Step 1: Add imports and visibility state**

At the top of `AddItemScreen.tsx`, add:

```typescript
import { generatePassword } from '@keykeykey/core/generator';
import { EyeIcon, EyeOffIcon, RefreshIcon } from '../components/icons/index.js';
```

Inside the component, add state variables after the existing card fields:

```typescript
const [showPassword, setShowPassword] = useState(false);
const [showCvv, setShowCvv] = useState(false);
const [showPin, setShowPin] = useState(false);
```

- [ ] **Step 2: Add an eye toggle button style**

Add a reusable style inside the component:

```typescript
const eyeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: theme.colors.textSecondary,
  cursor: 'pointer',
  padding: 4,
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
};
```

- [ ] **Step 3: Replace the password field row in renderCredentialFields**

Replace the entire password `<div style={fieldStyle}>` block (lines 216-243 in the current file — from the `<div style={fieldStyle}>` through the closing `</div>` of the Generate button row) with:

```tsx
<div style={fieldStyle}>
  <label style={labelStyle}>Password</label>
  <div style={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'center' }}>
    <input
      type={showPassword ? 'text' : 'password'}
      value={password}
      onChange={(e) => setPassword(e.target.value)}
      placeholder="Password"
      style={{ ...inputStyle, flex: 1 }}
    />
    <button
      onClick={() => setShowPassword(!showPassword)}
      style={eyeButtonStyle}
      aria-label={showPassword ? 'Hide password' : 'Show password'}
      type="button"
    >
      {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
    </button>
    <button
      onClick={() => {
        const pw = generatePassword({
          mode: 'random',
          length: 20,
          uppercase: true,
          lowercase: true,
          digits: true,
          symbols: true,
        });
        setPassword(pw);
        setShowPassword(true);
      }}
      style={{
        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
        background: theme.colors.primaryMuted,
        border: 'none',
        borderRadius: theme.radii.md,
        color: theme.colors.text,
        cursor: 'pointer',
        fontSize: theme.typography.sizes.xs,
        fontWeight: theme.typography.weights.medium,
        whiteSpace: 'nowrap' as const,
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
      }}
      type="button"
    >
      {password ? <RefreshIcon size={14} /> : 'Generate'}
    </button>
  </div>
</div>
```

- [ ] **Step 4: Update CVV field in renderCardFields to use password type + eye toggle**

Replace the CVV input block (inside the flex row, currently `type="text"`) with:

```tsx
<div style={{ flex: 1 }}>
  <label style={labelStyle}>CVV</label>
  <div style={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'center' }}>
    <input
      type={showCvv ? 'text' : 'password'}
      value={cvv}
      onChange={(e) => setCvv(e.target.value)}
      placeholder="123"
      style={{ ...inputStyle, flex: 1 }}
    />
    <button
      onClick={() => setShowCvv(!showCvv)}
      style={eyeButtonStyle}
      aria-label={showCvv ? 'Hide CVV' : 'Show CVV'}
      type="button"
    >
      {showCvv ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
    </button>
  </div>
</div>
```

- [ ] **Step 5: Update PIN field similarly**

Replace the PIN input block with:

```tsx
<div style={{ flex: 1 }}>
  <label style={labelStyle}>PIN (optional)</label>
  <div style={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'center' }}>
    <input
      type={showPin ? 'text' : 'password'}
      value={pin}
      onChange={(e) => setPin(e.target.value)}
      placeholder="Optional"
      style={{ ...inputStyle, flex: 1 }}
    />
    <button
      onClick={() => setShowPin(!showPin)}
      style={eyeButtonStyle}
      aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
      type="button"
    >
      {showPin ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
    </button>
  </div>
</div>
```

- [ ] **Step 6: Remove onNavigate from Generate button dependency**

The `onNavigate` prop is still needed for the component interface (other screens may use it), but the "Generate" button no longer calls `onNavigate('generator')`. No prop removal needed.

- [ ] **Step 7: Update AddItemScreen test**

In `apps/extension/src/popup/screens/AddItemScreen.test.tsx`, add a mock for `@keykeykey/core/generator`:

```typescript
vi.mock('@keykeykey/core/generator', () => ({
  generatePassword: vi.fn(() => 'MockGeneratedPass1!'),
}));
```

Update any existing tests that check for the "Generate" button behavior. Add a test:

```typescript
it('generates password inline when Generate is clicked', async () => {
  // ... render AddItemScreen
  const generateBtn = screen.getByText('Generate');
  fireEvent.click(generateBtn);
  // Password field should now have a value
  const passwordInput = screen.getByPlaceholderText('Password');
  expect(passwordInput).toHaveValue('MockGeneratedPass1!');
});
```

- [ ] **Step 8: Run tests**

Run: `pnpm --filter @keykeykey/extension test`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/extension/src/popup/screens/AddItemScreen.tsx apps/extension/src/popup/screens/AddItemScreen.test.tsx
git commit -m "feat(extension): add eye toggle and inline generator to AddItemScreen"
```

---

### Task 5: Eye Toggle + Inline Generator on EditItemScreen

**Files:**
- Modify: `apps/extension/src/popup/screens/EditItemScreen.tsx`

Apply the same changes as Task 4 to EditItemScreen. The pattern is identical.

- [ ] **Step 1: Add imports and visibility state**

```typescript
import { generatePassword } from '@keykeykey/core/generator';
import { EyeIcon, EyeOffIcon, RefreshIcon } from '../components/icons/index.js';
```

Add state:
```typescript
const [showPassword, setShowPassword] = useState(false);
const [showCvv, setShowCvv] = useState(false);
const [showPin, setShowPin] = useState(false);
```

Add the `eyeButtonStyle` (same as Task 4 Step 2).

- [ ] **Step 2: Replace password field row in renderCredentialFields**

Same pattern as Task 4 Step 3 — replace the entire password `<div style={fieldStyle}>` block (lines 197-235) with the eye toggle + inline generate button. Ensure all new buttons include `type="button"` to prevent accidental form submission.

- [ ] **Step 3: Update CVV and PIN fields in renderCardFields**

Same pattern as Task 4 Steps 4-5 — change `type="text"` to `type={showCvv ? 'text' : 'password'}` and add eye toggle buttons.

CVV input is at lines 288-294, PIN input is at lines 298-304.

- [ ] **Step 4: Verify build**

Run: `cd apps/extension && npx tsc --noEmit`
Expected: No errors.

**Note:** No existing `EditItemScreen.test.tsx` file exists. No test updates needed for this task.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/popup/screens/EditItemScreen.tsx
git commit -m "feat(extension): add eye toggle and inline generator to EditItemScreen"
```

---

### Task 6: Auto-Lock Timeout Fix

**Files:**
- Modify: `apps/extension/src/popup/screens/SettingsScreen.tsx:25,55,304-319`
- Modify: `apps/extension/src/lib/messages.ts:26`

- [ ] **Step 1: Fix settings response unwrapping in SettingsScreen**

In `apps/extension/src/popup/screens/SettingsScreen.tsx`, at lines 55-59, the code assigns the raw response to `s` and then calls `setSettings(s)`. The `GET_SETTINGS` handler returns `{ settings: {...} }` so the actual settings are nested. Fix by unwrapping:

Change line 55 from:
```typescript
const s = settingsResult as Settings & { error?: string };
```

to:
```typescript
const raw = settingsResult as { settings?: Settings; error?: string } & Settings;
const s: Settings & { error?: string } = raw.settings ? { ...raw.settings, error: raw.error } : raw as Settings & { error?: string };
```

This handles both the nested `{ settings: {...} }` response shape and any direct shape.

- [ ] **Step 2: Expand timeout presets**

In `SettingsScreen.tsx`, replace line 25:

```typescript
const AUTO_LOCK_MINUTES = [5, 15, 30, 60] as const;
```

with:

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

- [ ] **Step 3: Update the timeout select dropdown**

Replace the timeout `<select>` block (lines 307-318) that uses `AUTO_LOCK_MINUTES.map(m => ...)` with:

```tsx
<select
  value={settings?.autoLockMinutes ?? 60}
  onChange={(e) => updateSetting({ autoLockMinutes: Number(e.target.value) })}
  style={inputStyle}
>
  {AUTO_LOCK_OPTIONS.map((opt) => (
    <option key={opt.value} value={opt.value}>
      {opt.label}
    </option>
  ))}
</select>
```

- [ ] **Step 4: Change default timeout in messages.ts**

In `apps/extension/src/lib/messages.ts`, change line 26:

```typescript
autoLockMinutes: 60,
```

- [ ] **Step 5: Update SettingsScreen test**

In `apps/extension/src/popup/screens/SettingsScreen.test.tsx`, update any tests that reference `AUTO_LOCK_MINUTES` or check for "15 minutes" as the default. Add a test that verifies the timeout picker is visible on initial render when autoLockMode is 'timed'.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @keykeykey/extension test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/popup/screens/SettingsScreen.tsx apps/extension/src/lib/messages.ts apps/extension/src/popup/screens/SettingsScreen.test.tsx
git commit -m "fix(extension): fix auto-lock timeout picker, expand presets, default to 60min"
```

---

### Task 7: Friendly Unlock Error Message

**Files:**
- Modify: `apps/extension/src/background/message-handler.ts:184-186`
- Modify: `apps/extension/src/background/message-handler.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/extension/src/background/message-handler.test.ts`, add a test (or update the existing UNLOCK test) that verifies "invalid tag" errors are mapped to a friendly message:

```typescript
it('returns friendly error when password is wrong (invalid tag)', async () => {
  // Setup: vault exists, mock unlock to throw 'invalid tag'
  // ...existing test setup for UNLOCK...

  // Mock the store.unlock to throw the crypto error
  mockStore.getState.mockReturnValue({
    ...mockStore.getState(),
    loadHeader: vi.fn(),
    unlock: vi.fn().mockRejectedValue(new Error('invalid tag')),
  });

  const result = await handleMessage({ type: 'UNLOCK', password: 'wrong' });
  expect(result.error).toBe('Incorrect master password.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/extension test -- --grep "invalid tag"`
Expected: FAIL — currently returns "invalid tag" not "Incorrect master password."

- [ ] **Step 3: Fix the error mapping**

**Note:** The `UNLOCK_PIN` handler (lines 192-235) does NOT need this fix — its catch block at line 227 already returns PIN-specific error messages ("Wrong PIN. X attempts remaining.") and never exposes the raw crypto error.

In `apps/extension/src/background/message-handler.ts`, replace line 184-186:

```typescript
} catch (err) {
  return { error: err instanceof Error ? err.message : 'Unlock failed' };
}
```

with:

```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : 'Unlock failed';
  if (msg === 'invalid tag') {
    return { error: 'Incorrect master password.' };
  }
  return { error: msg };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/extension test -- --grep "invalid tag"`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `pnpm --filter @keykeykey/extension test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/background/message-handler.ts apps/extension/src/background/message-handler.test.ts
git commit -m "fix(extension): show 'Incorrect master password' instead of 'invalid tag'"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Build the extension**

Run: `pnpm --filter @keykeykey/extension build`
Expected: Build succeeds.

- [ ] **Step 2: Run all extension tests**

Run: `pnpm --filter @keykeykey/extension test`
Expected: All tests pass.

- [ ] **Step 3: Run lint**

Run: `pnpm --filter @keykeykey/extension lint`
Expected: No lint errors (or only pre-existing ones).

- [ ] **Step 4: Run E2E tests**

Run: `cd e2e && npx playwright test --project=extension`
Expected: All tests pass.

- [ ] **Step 5: Manual verification checklist**

Load the rebuilt extension in Chrome (`chrome://extensions` → reload) and verify:
- Popup is noticeably larger (380x600)
- All 5 toolbar icons render at same size and color
- "+" icon adds a new item
- Lock icon locks the vault immediately
- Dice icon opens the generator screen
- Search bar shows "Search vault…" (not `\u2026`)
- Add credential → "Generate" fills password inline, shows eye toggle
- Edit credential → same generate + eye toggle behavior
- Card CVV and PIN fields are masked by default, eye toggles work
- Settings → "After timeout" shows 7 duration presets on first render
- Default timeout is "1 hour"
- Lock vault → enter wrong password → shows "Incorrect master password."
- Light and dark themes both look correct
