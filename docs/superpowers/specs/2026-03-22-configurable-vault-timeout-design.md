# Configurable Vault Auto-Lock Timeout (Desktop & Mobile)

Replace the hardcoded 5-minute auto-lock on desktop and mobile with a configurable inactivity timer. Add a "Never" option gated by a security confirmation dialog.

## Current State

| Platform  | Timeout    | Configurable? | Mechanism                              |
| --------- | ---------- | ------------- | -------------------------------------- |
| Extension | 60m default | Yes (7 presets + configurable) | Browser alarms API, resets on interaction |
| Desktop   | 5m fixed   | No (disabled placeholder in settings) | Page Visibility API — only locks when window hidden |
| Mobile    | 5m fixed   | No (disabled placeholder in settings) | AppState — only checks elapsed time on foreground return |

**Problems:**
1. 5 minutes is too aggressive, especially on desktop
2. Users cannot configure the timeout
3. The timer is not an inactivity timer — it only triggers on backgrounding/hiding, not on idle

## Design

### Inactivity-Based Timer

Replace the current background/visibility-based locking with a true inactivity timer:

- **Activity events** that reset the timer: mousedown, keydown, touchstart, scroll (not mousemove — too noisy, causes thousands of unnecessary timer resets per minute)
- **Throttling**: The reset handler is throttled to fire at most once per second to avoid performance issues from rapid event firing (e.g., continuous scrolling)
- **Timer runs continuously** regardless of whether the app is visible, backgrounded, or foregrounded
- After N minutes of zero interaction, vault locks automatically
- Setting timeout to "Never" (value `0`) disables the timer entirely

The current visibility-change (desktop) and AppState (mobile) based locking logic is removed entirely.

### Presets & Defaults

**Desktop** (timeout presets match extension; desktop does not use the extension's `AutoLockMode` timed/browser_close/never model — it uses a single minutes value where 0 = never):

| Value | Label      |
| ----- | ---------- |
| 5     | 5 minutes  |
| 15    | 15 minutes |
| 30    | 30 minutes |
| 60    | 1 hour     |
| 240   | 4 hours    |
| 480   | 8 hours    |
| 1440  | 24 hours   |
| 0     | Never      |

Default: **60 minutes**

**Mobile**:

| Value | Label      |
| ----- | ---------- |
| 5     | 5 minutes  |
| 15    | 15 minutes |
| 30    | 30 minutes |
| 60    | 1 hour     |
| 240   | 4 hours    |
| 0     | Never      |

Default: **5 minutes**

### "Never" Security Warning

When the user selects "Never", a confirmation dialog appears before applying:

- **Desktop**: React modal dialog following the existing `ResetVaultDialog` pattern in `apps/desktop/src/components/ResetVaultDialog.tsx`
- **Mobile**: `Alert.alert()` with Cancel and Confirm buttons

**Dialog text:**
> **Disable Auto-Lock?**
>
> Your vault will stay unlocked indefinitely. We recommend using biometrics or a PIN for quick unlock instead.

If the user cancels, the selection reverts to the previous value. If they confirm, the value is saved and the timer is disabled.

### Persistence

Auto-lock timeout is a **per-device preference** (you might want 5m on your phone but 1h on your laptop). It must be readable before vault unlock (to start the timer immediately after unlocking).

- **Desktop**: `localStorage` key `keykeykey_autoLockMinutes`, stores a number. Default `60` if absent. Invalid values (non-numeric, negative) fall back to default.
- **Mobile**: `AsyncStorage` key `keykeykey_autoLockMinutes`, stores a string number. Default `5` if absent. Invalid values fall back to default. The hook returns a `loading` flag; the inactivity timer must not start until the persisted value is loaded (to avoid briefly using the wrong default).

**Vault reset behavior**: The timeout preference survives vault reset — it is a device preference, not vault data.

## File Changes

### Desktop

| File | Change |
| ---- | ------ |
| `apps/desktop/src/lib/use-auto-lock-setting.ts` (new) | Hook: reads/writes `localStorage`, returns `{ autoLockMinutes, setAutoLockMinutes }` |
| `apps/desktop/src/lib/vault-context.tsx` | Remove `AUTO_LOCK_TIMEOUT_MS` constant and visibility-change `useEffect`. Add inactivity timer `useEffect` that listens to interaction events on `document` and resets a `setTimeout`. Consume `autoLockMinutes` from the new hook (passed via context or props). |
| `apps/desktop/src/screens/SettingsScreen.tsx` | Enable the "Auto-Lock Timeout" row. Replace static "5 minutes" subtitle with a `<select>` dropdown (`data-testid="settings-auto-lock-timeout"`). Add confirmation dialog following `ResetVaultDialog` pattern. |

### Mobile

| File | Change |
| ---- | ------ |
| `apps/mobile/lib/use-auto-lock-setting.ts` (new) | Hook: reads/writes `AsyncStorage`, returns `{ autoLockMinutes, setAutoLockMinutes }` |
| `apps/mobile/lib/vault-context.tsx` | Remove `AUTO_LOCK_TIMEOUT_MS` constant and AppState-based `useEffect`. Add inactivity timer `useEffect` using touch detection + `AppState` interaction tracking. Consume `autoLockMinutes` from the new hook. |
| `apps/mobile/app/(tabs)/settings.tsx` | Enable the "Auto-Lock Timeout" row. Replace static "5 minutes (after backgrounding)" subtitle with an action sheet or picker. Add `Alert.alert()` confirmation for "Never". |

### Inactivity Detection Implementation

**Desktop (React/DOM):**
```typescript
useEffect(() => {
  if (status !== 'unlocked' || autoLockMinutes === 0) return;

  const ms = autoLockMinutes * 60 * 1000;
  let timer = setTimeout(lock, ms);

  // Throttled reset — at most once per second to avoid perf issues from rapid events
  let lastReset = 0;
  const reset = () => {
    const now = Date.now();
    if (now - lastReset < 1000) return;
    lastReset = now;
    clearTimeout(timer);
    timer = setTimeout(lock, ms);
  };

  // No mousemove — too noisy. mousedown + keydown cover real interaction.
  const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
  events.forEach((e) => document.addEventListener(e, reset, { passive: true }));

  return () => {
    clearTimeout(timer);
    events.forEach((e) => document.removeEventListener(e, reset));
  };
}, [status, autoLockMinutes, lock]);
```

**Mobile (React Native):**

React Native doesn't have global DOM events. Use a combination of:
1. `onTouchStart` handler on a root `<View>` wrapper (not `PanResponder` — using `onStartShouldSetPanResponderCapture: () => true` would claim the gesture and break scrolling/navigation). `onTouchStart` is passive and does not interfere with child gesture handlers.
2. `AppState` changes (returning to active counts as activity)

```typescript
useEffect(() => {
  if (status !== 'unlocked' || autoLockMinutes === 0) return;

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

  // AppState changes count as activity
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') reset();
  });

  // Expose reset function for touch handler on root View
  onActivityRef.current = reset;

  return () => {
    clearTimeout(timer);
    sub.remove();
    onActivityRef.current = null;
  };
}, [status, autoLockMinutes, lock]);
```

The root `<View>` wrapper in `_layout.tsx` uses `onTouchStart={() => onActivityRef.current?.()}` to detect touches without interfering with gestures. This captures all touch interactions (scrolls, taps, swipes) as activity signals.

## Testing

### Desktop
- `use-auto-lock-setting.test.ts`: localStorage read/write, default value (60), persistence across reads, invalid value fallback (non-numeric, negative)
- `vault-context.test.tsx`: inactivity timer fires after configured timeout, resets on simulated mousedown/keydown events, does not fire when `autoLockMinutes === 0`, throttle prevents rapid timer resets
- `SettingsScreen.test.tsx`: dropdown renders all 8 presets, "Never" triggers confirmation dialog, cancelling reverts selection, confirming persists value

### Mobile
- `use-auto-lock-setting.test.ts`: AsyncStorage read/write, default value (5), persistence, invalid value fallback, loading state before async resolve
- `vault-context.test.tsx`: inactivity timer fires, resets on AppState change to active, disabled when 0, does not start until setting is loaded
- `settings.test.tsx`: picker renders all 6 presets, "Never" triggers Alert.alert, cancelling reverts

## Out of Scope

- Syncing timeout preference across devices (intentionally per-device)
- Changing the extension's existing auto-lock implementation (already configurable)
- Idle detection based on OS-level APIs (screen lock, sleep) — may be added later
