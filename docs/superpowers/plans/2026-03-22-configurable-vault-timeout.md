# Configurable Vault Auto-Lock Timeout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded 5-minute auto-lock on desktop and mobile with a configurable inactivity timer, including a "Never" option with security warning dialog.

**Architecture:** Each platform gets a `useAutoLockSetting` hook for persistence (localStorage on desktop, AsyncStorage on mobile) and an inactivity-based timer in `vault-context.tsx` that resets on user interaction. The current visibility-change (desktop) and AppState-only (mobile) locking is replaced. A "Never" option (value `0`) disables the timer, gated by a confirmation dialog.

**Tech Stack:** React, TypeScript, Vitest (desktop), Jest (mobile), localStorage (desktop), AsyncStorage (mobile)

**Spec:** `docs/superpowers/specs/2026-03-22-configurable-vault-timeout-design.md`

---

### Task 1: Desktop `useAutoLockSetting` Hook

**Files:**

- Create: `apps/desktop/src/lib/use-auto-lock-setting.ts`
- Create: `apps/desktop/src/lib/__tests__/use-auto-lock-setting.test.ts`

- [ ] **Step 1: Write tests for the hook**

Create `apps/desktop/src/lib/__tests__/use-auto-lock-setting.test.ts`:

```typescript
import { renderHook, act } from '@testing-library/react';
import { useAutoLockSetting } from '../use-auto-lock-setting';

const STORAGE_KEY = 'keykeykey_autoLockMinutes';

describe('useAutoLockSetting', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns 60 as default when nothing stored', () => {
    const { result } = renderHook(() => useAutoLockSetting());
    expect(result.current.autoLockMinutes).toBe(60);
  });

  it('reads persisted value from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, '15');
    const { result } = renderHook(() => useAutoLockSetting());
    expect(result.current.autoLockMinutes).toBe(15);
  });

  it('persists value to localStorage on set', () => {
    const { result } = renderHook(() => useAutoLockSetting());
    act(() => result.current.setAutoLockMinutes(30));
    expect(result.current.autoLockMinutes).toBe(30);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('30');
  });

  it('falls back to default for non-numeric value', () => {
    localStorage.setItem(STORAGE_KEY, 'banana');
    const { result } = renderHook(() => useAutoLockSetting());
    expect(result.current.autoLockMinutes).toBe(60);
  });

  it('falls back to default for negative value', () => {
    localStorage.setItem(STORAGE_KEY, '-5');
    const { result } = renderHook(() => useAutoLockSetting());
    expect(result.current.autoLockMinutes).toBe(60);
  });

  it('allows 0 (Never)', () => {
    const { result } = renderHook(() => useAutoLockSetting());
    act(() => result.current.setAutoLockMinutes(0));
    expect(result.current.autoLockMinutes).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/desktop test -- --run use-auto-lock-setting`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `apps/desktop/src/lib/use-auto-lock-setting.ts`:

```typescript
import { useState, useCallback } from 'react';

const STORAGE_KEY = 'keykeykey_autoLockMinutes';
const DEFAULT_MINUTES = 60;

function readFromStorage(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return DEFAULT_MINUTES;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_MINUTES;
  return parsed;
}

export function useAutoLockSetting() {
  const [autoLockMinutes, setAutoLockMinutesState] = useState(readFromStorage);

  const setAutoLockMinutes = useCallback((minutes: number) => {
    localStorage.setItem(STORAGE_KEY, String(minutes));
    setAutoLockMinutesState(minutes);
  }, []);

  return { autoLockMinutes, setAutoLockMinutes } as const;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/desktop test -- --run use-auto-lock-setting`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/use-auto-lock-setting.ts apps/desktop/src/lib/__tests__/use-auto-lock-setting.test.ts
git commit -m "feat(desktop): add useAutoLockSetting hook with localStorage persistence"
```

---

### Task 2: Desktop Inactivity Timer in vault-context

**Files:**

- Modify: `apps/desktop/src/lib/vault-context.tsx:51-52,610-643`

- [ ] **Step 1: Remove the hardcoded constant and import the hook**

In `apps/desktop/src/lib/vault-context.tsx`:

Delete lines 51-52 (the constant):

```typescript
/** Auto-lock after 5 minutes of window being continuously hidden */
const AUTO_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
```

Add the import at the top with the other local imports (after line 44):

```typescript
import { useAutoLockSetting } from './use-auto-lock-setting';
```

- [ ] **Step 2: Add the hook call inside VaultProvider**

Inside the `VaultProvider` component, near the top where other hooks are called, add:

```typescript
const { autoLockMinutes, setAutoLockMinutes } = useAutoLockSetting();
```

- [ ] **Step 3: Replace the visibility-change useEffect with inactivity timer**

Replace the entire auto-lock block (lines 610-643, from the comment `// Auto-lock when window is hidden...` through the `}, [status, lock]);`) with:

```typescript
// Auto-lock after inactivity. Resets on user interaction (mousedown, keydown, touchstart, scroll).
useEffect(() => {
  if (status !== 'unlocked' || autoLockMinutes === 0) return;

  const ms = autoLockMinutes * 60 * 1000;
  let timer = setTimeout(lock, ms);

  // Throttled reset — at most once per second
  let lastReset = 0;
  const reset = () => {
    const now = Date.now();
    if (now - lastReset < 1000) return;
    lastReset = now;
    clearTimeout(timer);
    timer = setTimeout(lock, ms);
  };

  const events = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;
  events.forEach((e) => document.addEventListener(e, reset, { passive: true }));

  return () => {
    clearTimeout(timer);
    events.forEach((e) => document.removeEventListener(e, reset));
  };
}, [status, autoLockMinutes, lock]);
```

Also remove the `autoLockTimer` ref that was above the old useEffect (line 613):

```typescript
const autoLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 4: Expose autoLockMinutes and setAutoLockMinutes via context**

Add to the `VaultContextType` type definition (after `quickUnlockPromptShown: boolean;` at line 79):

```typescript
  autoLockMinutes: number;
  setAutoLockMinutes: (minutes: number) => void;
```

Add to the context value object (in the `<VaultContext.Provider value={{...}}>` block, around line 653):

```typescript
        autoLockMinutes,
        setAutoLockMinutes,
```

- [ ] **Step 5: Verify build**

Run: `cd apps/extension && npx tsc --noEmit` (extension shares core, won't be affected)
Run: `cd apps/desktop && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Run existing tests**

Run: `pnpm --filter @keykeykey/desktop test`
Expected: All tests pass. If `vault-context.test.tsx` fails due to missing `autoLockMinutes` or `setAutoLockMinutes` in the mock/context, add them to the test's mock context values (e.g., `autoLockMinutes: 60, setAutoLockMinutes: vi.fn()`).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/lib/vault-context.tsx
git commit -m "feat(desktop): replace visibility-based auto-lock with inactivity timer"
```

---

### Task 3: Desktop Settings UI — Auto-Lock Dropdown + Confirmation Dialog

**Files:**

- Create: `apps/desktop/src/components/DisableAutoLockDialog.tsx`
- Modify: `apps/desktop/src/screens/SettingsScreen.tsx:1-18,80,373-378`

- [ ] **Step 1: Create the DisableAutoLockDialog component**

Create `apps/desktop/src/components/DisableAutoLockDialog.tsx` following the `ResetVaultDialog` pattern:

```typescript
import { useTheme } from '../lib/theme';

interface DisableAutoLockDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DisableAutoLockDialog({ open, onClose, onConfirm }: DisableAutoLockDialogProps) {
  const { theme } = useTheme();

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: theme.colors.surface,
          borderRadius: 12,
          padding: 24,
          maxWidth: 420,
          width: '90%',
          border: `1px solid ${theme.colors.border}`,
        }}
      >
        <h2
          style={{
            fontSize: theme.typography.sizes.lg,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.warning,
            marginBottom: 12,
          }}
        >
          Disable Auto-Lock?
        </h2>
        <p
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.text,
            marginBottom: 20,
          }}
        >
          Your vault will stay unlocked indefinitely. We recommend using biometrics or a PIN for
          quick unlock instead.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.medium,
              color: theme.colors.text,
              background: theme.colors.surfaceAlt,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            style={{
              padding: '8px 16px',
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.semibold,
              color: '#fff',
              background: theme.colors.warning,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Disable Auto-Lock
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update SettingsScreen imports**

In `apps/desktop/src/screens/SettingsScreen.tsx`, add imports at the top (after line 18):

```typescript
import { DisableAutoLockDialog } from '../components/DisableAutoLockDialog';
```

Also add `Timer` to the lucide-react imports on line 1:

```typescript
import {
  Lock,
  Sun,
  Moon,
  Monitor,
  Cloud,
  Download,
  Upload,
  Info,
  KeyRound,
  AlertTriangle,
  Timer,
} from 'lucide-react';
```

- [ ] **Step 3: Add state and handler in SettingsScreen**

In the component body (after line 88 `const [showResetConfirm, setShowResetConfirm] = useState(false);`), add:

```typescript
const [showDisableAutoLock, setShowDisableAutoLock] = useState(false);
```

Update the destructuring from `useVault()` on line 80 to include auto-lock:

```typescript
const {
  lock,
  pinConfigured,
  enablePin,
  disablePin,
  resetVault,
  syncConfig,
  autoLockMinutes,
  setAutoLockMinutes,
} = useVault();
```

- [ ] **Step 4: Add the auto-lock timeout preset constant**

Add near the top of the file (after the imports, before the component):

```typescript
const AUTO_LOCK_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 480, label: '8 hours' },
  { value: 1440, label: '24 hours' },
  { value: 0, label: 'Never' },
] as const;
```

- [ ] **Step 5: Replace the disabled Auto-Lock SettingRow**

Replace lines 373-378:

```typescript
        <SettingRow
          icon={<Lock size={18} />}
          label="Auto-Lock Timeout"
          subtitle="5 minutes"
          disabled
        />
```

with:

```typescript
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
          <Timer size={18} style={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: theme.typography.sizes.sm,
                fontWeight: theme.typography.weights.medium,
                color: theme.colors.text,
              }}
            >
              Auto-Lock Timeout
            </div>
          </div>
          <select
            data-testid="settings-auto-lock-timeout"
            value={autoLockMinutes}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (val === 0) {
                setShowDisableAutoLock(true);
              } else {
                setAutoLockMinutes(val);
              }
            }}
            style={{
              padding: '6px 8px',
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.text,
              background: theme.colors.surfaceAlt,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            {AUTO_LOCK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
```

- [ ] **Step 6: Add the DisableAutoLockDialog render**

Add the dialog render next to the existing `ResetVaultDialog` (after it, around line 472):

```typescript
      <DisableAutoLockDialog
        open={showDisableAutoLock}
        onClose={() => setShowDisableAutoLock(false)}
        onConfirm={() => setAutoLockMinutes(0)}
      />
```

- [ ] **Step 7: Verify build**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Run tests**

Run: `pnpm --filter @keykeykey/desktop test`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/components/DisableAutoLockDialog.tsx apps/desktop/src/screens/SettingsScreen.tsx
git commit -m "feat(desktop): add configurable auto-lock timeout dropdown with Never confirmation"
```

---

### Task 4: Mobile `useAutoLockSetting` Hook

**Files:**

- Create: `apps/mobile/lib/use-auto-lock-setting.ts`
- Create: `apps/mobile/__tests__/lib/use-auto-lock-setting.test.ts`

- [ ] **Step 1: Write tests for the hook**

Create `apps/mobile/__tests__/lib/use-auto-lock-setting.test.ts`:

```typescript
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAutoLockSetting } from '../../lib/use-auto-lock-setting';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const STORAGE_KEY = 'keykeykey_autoLockMinutes';

describe('useAutoLockSetting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  it('returns loading=true initially, then resolves to default 5', async () => {
    const { result } = renderHook(() => useAutoLockSetting());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.autoLockMinutes).toBe(5);
  });

  it('reads persisted value from AsyncStorage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('30');
    const { result } = renderHook(() => useAutoLockSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.autoLockMinutes).toBe(30);
  });

  it('persists value to AsyncStorage on set', async () => {
    const { result } = renderHook(() => useAutoLockSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.setAutoLockMinutes(15));
    expect(result.current.autoLockMinutes).toBe(15);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '15');
  });

  it('falls back to default for non-numeric value', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('banana');
    const { result } = renderHook(() => useAutoLockSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.autoLockMinutes).toBe(5);
  });

  it('falls back to default for negative value', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('-5');
    const { result } = renderHook(() => useAutoLockSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.autoLockMinutes).toBe(5);
  });

  it('allows 0 (Never)', async () => {
    const { result } = renderHook(() => useAutoLockSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.setAutoLockMinutes(0));
    expect(result.current.autoLockMinutes).toBe(0);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '0');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/mobile test -- --testPathPattern use-auto-lock-setting`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `apps/mobile/lib/use-auto-lock-setting.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'keykeykey_autoLockMinutes';
const DEFAULT_MINUTES = 5;

function parseMinutes(raw: string | null): number {
  if (raw === null) return DEFAULT_MINUTES;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_MINUTES;
  return parsed;
}

export function useAutoLockSetting() {
  const [autoLockMinutes, setAutoLockMinutesState] = useState(DEFAULT_MINUTES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      setAutoLockMinutesState(parseMinutes(raw));
      setLoading(false);
    });
  }, []);

  const setAutoLockMinutes = useCallback(async (minutes: number) => {
    await AsyncStorage.setItem(STORAGE_KEY, String(minutes));
    setAutoLockMinutesState(minutes);
  }, []);

  return { autoLockMinutes, setAutoLockMinutes, loading } as const;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/mobile test -- --testPathPattern use-auto-lock-setting`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/use-auto-lock-setting.ts apps/mobile/__tests__/lib/use-auto-lock-setting.test.ts
git commit -m "feat(mobile): add useAutoLockSetting hook with AsyncStorage persistence"
```

---

### Task 5: Mobile Inactivity Timer in vault-context

**Files:**

- Modify: `apps/mobile/lib/vault-context.tsx:51-52,54-100,593-609`
- Modify: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Remove the hardcoded constant and import the hook**

In `apps/mobile/lib/vault-context.tsx`:

Delete lines 51-52:

```typescript
/** Auto-lock after 5 minutes of app being in background */
const AUTO_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
```

Add import after the other local imports (after line 47):

```typescript
import { useAutoLockSetting } from './use-auto-lock-setting';
```

- [ ] **Step 2: Add the hook call and activity ref inside VaultProvider**

Inside the `VaultProvider` component, add near the top where other hooks are called:

```typescript
const { autoLockMinutes, setAutoLockMinutes, loading: autoLockLoading } = useAutoLockSetting();
const onActivityRef = useRef<(() => void) | null>(null);
```

- [ ] **Step 3: Replace the AppState-based auto-lock with inactivity timer**

Replace the entire auto-lock block (lines 593-609, from `// Auto-lock when app is backgrounded for too long` through `}, [status, lock]);`) with:

```typescript
// Auto-lock after inactivity. Resets on touch (via onActivityRef) and AppState changes.
useEffect(() => {
  if (status !== 'unlocked' || autoLockMinutes === 0 || autoLockLoading) return;

  const ms = autoLockMinutes * 60 * 1000;
  let timer = setTimeout(lock, ms);

  let lastReset = 0;
  const reset = () => {
    const now = Date.now();
    if (now - lastReset < 1000) return;
    lastReset = now;
    clearTimeout(timer);
    timer = setTimeout(lock, ms);
  };

  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') reset();
  });

  onActivityRef.current = reset;

  return () => {
    clearTimeout(timer);
    sub.remove();
    onActivityRef.current = null;
  };
}, [status, autoLockMinutes, autoLockLoading, lock]);
```

Also remove the `backgroundedAt` ref that was above the old useEffect (line 594):

```typescript
const backgroundedAt = useRef<number | null>(null);
```

- [ ] **Step 4: Expose autoLockMinutes, setAutoLockMinutes, and onActivity via context**

Add to the `VaultContextType` type definition (add after `dismissQuickUnlockPrompt` at line 79):

```typescript
  autoLockMinutes: number;
  setAutoLockMinutes: (minutes: number) => Promise<void>;
  onActivity: () => void;
```

Add to the context value object (in the `<VaultContext.Provider value={{...}}>` block):

```typescript
        autoLockMinutes,
        setAutoLockMinutes,
        onActivity: () => onActivityRef.current?.(),
```

- [ ] **Step 5: Wire onTouchStart in \_layout.tsx**

In `apps/mobile/app/_layout.tsx`:

Add `View` import from `react-native` (new import):

```typescript
import { View } from 'react-native';
```

Update the existing `VaultProvider` import on line 5 to also export `useVault`:

```typescript
import { VaultProvider, useVault } from '@/lib/vault-context';
```

Update `RootLayoutInner` to wrap `Stack` in a `View` with `onTouchStart`:

```typescript
function RootLayoutInner() {
  const { theme, isDark } = useTheme();
  const { onActivity } = useVault();

  return (
    <View style={{ flex: 1 }} onTouchStart={onActivity}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: theme.colors.background,
          },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="unlock" />
        <Stack.Screen name="recovery" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="item/add"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="item/[id]"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="item/edit"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="settings/sync"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="settings/import"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="settings/export"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="restore"
          options={{ headerShown: false, animation: 'slide_from_right' }}
        />
      </Stack>
    </View>
  );
}
```

- [ ] **Step 6: Verify build**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Run existing tests**

Run: `pnpm --filter @keykeykey/mobile test`
Expected: All tests pass. Existing test mocks for `useVault` (e.g., in `apps/mobile/__tests__/screens/settings.test.tsx`) will need `autoLockMinutes: 5`, `setAutoLockMinutes: jest.fn()`, and `onActivity: jest.fn()` added to the mock state object. Fix any mock-related failures before proceeding.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/lib/vault-context.tsx apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): replace AppState auto-lock with inactivity timer + touch detection"
```

---

### Task 6: Mobile Settings UI — Auto-Lock Picker + Confirmation

**Files:**

- Modify: `apps/mobile/app/(tabs)/settings.tsx:1-10,12-23,162-167`

- [ ] **Step 1: Add the auto-lock preset constant and ActionSheetIOS import**

In `apps/mobile/app/(tabs)/settings.tsx`, add `ActionSheetIOS, Platform` to the react-native import on line 1:

```typescript
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Switch,
  Modal,
  ScrollView,
  ActionSheetIOS,
  Platform,
} from 'react-native';
```

Add after the imports (before the component):

```typescript
const AUTO_LOCK_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 0, label: 'Never' },
] as const;
```

- [ ] **Step 2: Wire auto-lock settings from vault context**

Update the `useVault()` destructuring (line 13-23) to include:

```typescript
const {
  lock,
  biometricAvailable,
  pinConfigured,
  enableBiometric,
  disableBiometric,
  enablePin,
  disablePin,
  resetVault,
  syncConfig,
  autoLockMinutes,
  setAutoLockMinutes,
} = useVault();
```

- [ ] **Step 3: Add the auto-lock change handler**

Add a handler function inside the component (after the existing handlers). Use `ActionSheetIOS` on iOS (supports arbitrary button count), `Alert.alert` on Android (renders as a scrollable list):

```typescript
const handleAutoLockSelect = (value: number) => {
  if (value === 0) {
    Alert.alert(
      'Disable Auto-Lock?',
      'Your vault will stay unlocked indefinitely. We recommend using biometrics or a PIN for quick unlock instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable Auto-Lock',
          style: 'destructive',
          onPress: () => setAutoLockMinutes(0),
        },
      ],
    );
  } else {
    setAutoLockMinutes(value);
  }
};

const handleAutoLockChange = () => {
  const labels = AUTO_LOCK_OPTIONS.map((opt) => opt.label);

  if (Platform.OS === 'ios') {
    const cancelIndex = labels.length;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...labels, 'Cancel'],
        cancelButtonIndex: cancelIndex,
        title: 'Auto-Lock Timeout',
      },
      (buttonIndex) => {
        if (buttonIndex !== cancelIndex) {
          handleAutoLockSelect(AUTO_LOCK_OPTIONS[buttonIndex]!.value);
        }
      },
    );
  } else {
    Alert.alert('Auto-Lock Timeout', 'Lock vault after inactivity', [
      ...AUTO_LOCK_OPTIONS.map((opt) => ({
        text: opt.label,
        onPress: () => handleAutoLockSelect(opt.value),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }
};
```

- [ ] **Step 4: Replace the disabled Auto-Lock SettingRow**

Replace lines 162-167:

```typescript
          <SettingRow
            icon="timer-outline"
            label="Auto-Lock Timeout"
            subtitle="5 minutes (after backgrounding)"
            disabled
          />
```

with:

```typescript
          <SettingRow
            icon="timer-outline"
            label="Auto-Lock Timeout"
            subtitle={AUTO_LOCK_OPTIONS.find((o) => o.value === autoLockMinutes)?.label ?? `${autoLockMinutes} minutes`}
            onPress={handleAutoLockChange}
          />
```

- [ ] **Step 5: Verify build**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @keykeykey/mobile test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/app/(tabs)/settings.tsx
git commit -m "feat(mobile): add configurable auto-lock timeout picker with Never confirmation"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Build desktop**

Run: `pnpm --filter @keykeykey/desktop build`
Expected: Build succeeds.

- [ ] **Step 2: Build mobile (TypeScript check)**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run all desktop tests**

Run: `pnpm --filter @keykeykey/desktop test`
Expected: All tests pass.

- [ ] **Step 4: Run all mobile tests**

Run: `pnpm --filter @keykeykey/mobile test`
Expected: All tests pass.

- [ ] **Step 5: Run lint**

Run: `pnpm lint`
Expected: No new lint errors.

- [ ] **Step 6: Run format check**

Run: `pnpm format:check`
Expected: No formatting issues (run `pnpm format` if needed).

- [ ] **Step 7: Manual verification checklist (Desktop)**

Run `cd apps/desktop && npx tauri dev` and verify:

- Settings → Auto-Lock Timeout shows a dropdown with 8 options
- Default is "1 hour"
- Selecting "30 minutes" persists after lock/unlock
- Selecting "Never" shows the confirmation dialog
- Cancelling the dialog reverts to previous value
- Confirming disables the timer
- With a short timeout (5m), vault locks after inactivity
- Interacting with the app resets the timer

- [ ] **Step 8: Manual verification checklist (Mobile)**

Run the app on simulator and verify:

- Settings → Auto-Lock Timeout shows current value, is tappable
- Tapping shows an Alert with 6 options + Cancel
- Default is "5 minutes"
- Selecting "Never" shows the security warning dialog
- Touching the screen resets the inactivity timer
- Returning from background resets the timer
