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

- **Activity events** that reset the timer: mouse move, click, keypress, touch, scroll
- **Timer runs continuously** regardless of whether the app is visible, backgrounded, or foregrounded
- After N minutes of zero interaction, vault locks automatically
- Setting timeout to "Never" (value `0`) disables the timer entirely

The current visibility-change (desktop) and AppState (mobile) based locking logic is removed entirely.

### Presets & Defaults

**Desktop** (matches extension):

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

- **Desktop**: React modal dialog (not `window.confirm`, to match the app's UI)
- **Mobile**: `Alert.alert()` with Cancel and Confirm buttons

**Dialog text:**
> **Disable Auto-Lock?**
>
> Your vault will stay unlocked indefinitely. We recommend using biometrics or a PIN for quick unlock instead.

If the user cancels, the selection reverts to the previous value. If they confirm, the value is saved and the timer is disabled.

### Persistence

Auto-lock timeout is a **per-device preference** (you might want 5m on your phone but 1h on your laptop). It must be readable before vault unlock (to start the timer immediately after unlocking).

- **Desktop**: `localStorage` key `keykeykey_autoLockMinutes`, stores a number. Default `60` if absent.
- **Mobile**: `AsyncStorage` key `keykeykey_autoLockMinutes`, stores a string number. Default `5` if absent.

## File Changes

### Desktop

| File | Change |
| ---- | ------ |
| `apps/desktop/src/lib/use-auto-lock-setting.ts` (new) | Hook: reads/writes `localStorage`, returns `{ autoLockMinutes, setAutoLockMinutes }` |
| `apps/desktop/src/lib/vault-context.tsx` | Remove `AUTO_LOCK_TIMEOUT_MS` constant and visibility-change `useEffect`. Add inactivity timer `useEffect` that listens to interaction events on `document` and resets a `setTimeout`. Consume `autoLockMinutes` from the new hook (passed via context or props). |
| `apps/desktop/src/screens/SettingsScreen.tsx` | Enable the "Auto-Lock Timeout" row. Replace static "5 minutes" subtitle with a `<select>` dropdown. Add confirmation dialog component for "Never". |

### Mobile

| File | Change |
| ---- | ------ |
| `apps/mobile/lib/use-auto-lock-setting.ts` (new) | Hook: reads/writes `AsyncStorage`, returns `{ autoLockMinutes, setAutoLockMinutes }` |
| `apps/mobile/lib/vault-context.tsx` | Remove `AUTO_LOCK_TIMEOUT_MS` constant and AppState-based `useEffect`. Add inactivity timer `useEffect` using `PanResponder` or `AppState` + interaction tracking. Consume `autoLockMinutes` from the new hook. |
| `apps/mobile/app/(tabs)/settings.tsx` | Enable the "Auto-Lock Timeout" row. Replace static "5 minutes" subtitle with an action sheet or picker. Add `Alert.alert()` confirmation for "Never". |

### Inactivity Detection Implementation

**Desktop (React/DOM):**
```typescript
useEffect(() => {
  if (status !== 'unlocked' || autoLockMinutes === 0) return;

  const ms = autoLockMinutes * 60 * 1000;
  let timer = setTimeout(lock, ms);

  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(lock, ms);
  };

  const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
  events.forEach((e) => document.addEventListener(e, reset, { passive: true }));

  return () => {
    clearTimeout(timer);
    events.forEach((e) => document.removeEventListener(e, reset));
  };
}, [status, autoLockMinutes, lock]);
```

**Mobile (React Native):**

React Native doesn't have global DOM events. Use a combination of:
1. `PanResponder` at the root view to capture touch interactions
2. `AppState` changes (returning to active counts as activity)

```typescript
useEffect(() => {
  if (status !== 'unlocked' || autoLockMinutes === 0) return;

  const ms = autoLockMinutes * 60 * 1000;
  let timer = setTimeout(lock, ms);

  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(lock, ms);
  };

  // AppState changes count as activity
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') reset();
  });

  // Expose reset function for touch handler
  onActivityRef.current = reset;

  return () => {
    clearTimeout(timer);
    sub.remove();
    onActivityRef.current = null;
  };
}, [status, autoLockMinutes, lock]);
```

A `PanResponder` on the root `<View>` in `_layout.tsx` calls `onActivityRef.current?.()` on any touch, providing touch-based idle detection.

## Testing

### Desktop
- `use-auto-lock-setting.test.ts`: localStorage read/write, default value (60), persistence across reads
- `vault-context.test.tsx`: inactivity timer fires after configured timeout, resets on simulated events, does not fire when `autoLockMinutes === 0`
- `SettingsScreen.test.tsx`: dropdown renders presets, "Never" triggers confirmation dialog, cancelling reverts selection

### Mobile
- `use-auto-lock-setting.test.ts`: AsyncStorage read/write, default value (5), persistence
- `vault-context.test.tsx`: inactivity timer fires, resets on AppState change to active, disabled when 0
- `settings.test.tsx`: picker renders presets, "Never" triggers Alert.alert, cancelling reverts

## Out of Scope

- Syncing timeout preference across devices (intentionally per-device)
- Changing the extension's existing auto-lock implementation (already configurable)
- Idle detection based on OS-level APIs (screen lock, sleep) — may be added later
