# Sync Settings UI — Design Spec

**Date:** 2026-03-17
**Scope:** Desktop and Mobile sync configuration screens, settings row updates, onboarding "Restore from Cloud" placeholder, and `triggerSync` vault context addition.

## 1. Overview

The sync engine, adapters (WebDAV, Google Drive, iCloud), config persistence, and vault context wiring are already implemented on all three platforms. The extension has a complete sync settings UI. Desktop and mobile still show "Coming soon" placeholders.

This sub-project builds the sync configuration UI for desktop and mobile, exposes a manual sync trigger through the vault context, and adds a disabled "Restore from Cloud" button to setup screens.

### What we're building

1. **Sync Settings Screen** — new dedicated screen on desktop and mobile, reached from Settings → "Cloud Sync" row
2. **Settings row update** — replace "Coming soon" placeholder with live status and navigation
3. **Vault context: `triggerSync()`** — new method on desktop and mobile vault contexts
4. **Onboarding placeholder** — disabled "Restore from Cloud" button on setup screens

### What we're NOT building

- Google OAuth flows (stubs remain — separate sub-project)
- iCloud native filesystem modules (separate sub-project)
- Restore from Cloud functionality (separate sub-project)
- Extension changes (already complete)

## 2. Sync Settings Screen

### 2.1 Navigation

**Desktop:** Settings → click "Cloud Sync" row → navigates to `/vault/settings/sync`. This is a **sibling route** added inside the `AppShell` `<Route>` in `App.tsx`:
```tsx
<Route path="settings/sync" element={<SyncSettingsScreen />} />
```
No changes to the existing `settings` route needed. Uses `react-router-dom` `useNavigate` for navigation; back button calls `navigate(-1)`.

**Mobile:** Settings → tap "Cloud Sync" row → pushes a new screen at `/settings/sync`. New file: `app/settings/sync.tsx`. This route lives **outside** the `(tabs)` group (same pattern as `item/add`, `item/[id]`, `item/edit`). Requires adding a `<Stack.Screen>` entry to the root `_layout.tsx`:
```tsx
<Stack.Screen
  name="settings/sync"
  options={{ presentation: 'card', animation: 'slide_from_right' }}
/>
```
No `app/settings/_layout.tsx` needed — the route is registered directly in the root stack.

### 2.2 Layout (top to bottom)

Both platforms share the same logical layout, adapted to their UI toolkit:

1. **Header** — "Cloud Sync" title with back navigation (desktop: back arrow button; mobile: stack header with back gesture)

2. **Provider Picker**
   - **Desktop:** `<select>` dropdown (matches extension pattern)
   - **Mobile:** Radio-button list (clearer disabled states, no need for a bottom sheet for 4 options)
   - Options:
     - `none` → "None (Local Only)"
     - `webdav` → "WebDAV"
     - `google-drive` → "Google Drive" — **disabled**, with "(Coming Soon)" suffix
     - `icloud` → "iCloud" — **disabled**, with "(Coming Soon)" suffix

3. **Provider Config Form** — conditional on selected provider:
   - **`none`:** No form shown
   - **`webdav`:** Three fields using existing `TextInput` component (desktop: `components/ui/TextInput`; mobile: `components/TextInput`):
     - WebDAV URL (type: url / `keyboardType="url"`)
     - Username (type: text)
     - Password (`secureTextEntry`)
   - **`google-drive` / `icloud`:** A styled info banner: "This provider is not yet available. It will be supported in a future update."

4. **Connection Actions**
   - **Connect** button (primary variant) — shown when not connected; enabled only when WebDAV fields are all filled
   - **Disconnect** button (danger variant) — shown when currently connected

5. **Sync Status** — shown when connected:
   - "Syncing…" with loading indicator when `isSyncing` is true
   - "Last synced: {localized timestamp}" or "Never synced"
   - Error message if sync failed (from `syncError` state)

6. **Sync Now** button (secondary variant) — shown when connected, disabled while syncing

### 2.3 State Management

Local component state (mirrors extension pattern):
- `syncProvider: SyncProvider` — initialized from `vaultContext.syncConfig?.provider ?? 'none'`
- `webdavUrl`, `webdavUsername`, `webdavPassword` — initialized from `vaultContext.syncConfig?.webdav`
- `syncing: boolean` — tracks manual sync in progress
- `syncError: string | null` — last sync error
- `lastSynced: string | null` — timestamp of last successful sync

Note: `lastSynced` and `syncError` are **ephemeral component state** — they reset when navigating away from the sync screen and are not persisted. This matches the extension's behavior. A future improvement could promote these to vault context state for persistence across navigation.

### 2.4 Handlers

**Connect:**
1. Build `SyncConfig` from form state
2. Call `vaultContext.saveSyncConfig(config)` — this creates the sync engine and runs initial sync
3. Update local state on success/failure

**Disconnect:**
1. Call `vaultContext.saveSyncConfig({ provider: 'none' })`
2. Reset local form state

**Sync Now:**
1. Set `syncing = true`
2. Call `vaultContext.triggerSync()` (new method — see Section 4)
3. Update `lastSynced` or `syncError`
4. Set `syncing = false`

## 3. Settings Row Updates

### Desktop (`SettingsScreen.tsx`)

Replace the disabled "Cloud Sync" `SettingRow` with:
```tsx
<SettingRow
  icon={<Cloud size={18} />}
  label="Cloud Sync"
  subtitle={syncStatusSubtitle}
  onClick={() => navigate('settings/sync')}
/>
```

The subtitle derives from `vaultContext.syncConfig`:
- `provider === 'webdav'` → "Connected via WebDAV"
- `provider === 'google-drive'` → "Connected via Google Drive"
- `provider === 'icloud'` → "Connected via iCloud"
- `provider === 'none'` or `null` → "Not configured"

### Mobile (`settings.tsx`)

Same pattern — replace disabled row, tap navigates to `/settings/sync`:
```tsx
<SettingRow
  icon="cloud-outline"
  label="Cloud Sync"
  subtitle={syncStatusSubtitle}
  onPress={() => router.push('/settings/sync')}
/>
```

## 4. Vault Context: `triggerSync()`

Add to both desktop and mobile vault context types and implementations:

```typescript
triggerSync: () => Promise<{ lastSynced: string | null; error: string | null }>;
```

Implementation:
```typescript
const triggerSync = async () => {
  const engine = syncEngineRef.current;
  if (!engine) return { lastSynced: null, error: 'No sync engine' };
  try {
    await engine.sync();
    const now = new Date().toISOString();
    return { lastSynced: now, error: null };
  } catch (e) {
    return { lastSynced: null, error: e instanceof Error ? e.message : String(e) };
  }
};
```

The extension already has this via the `TRIGGER_SYNC` message handler. Desktop and mobile just need the equivalent exposed through the React context.

Note: The `SyncStatus` shape (`{ isSyncing, lastSynced, error }`) already exists in the extension's `messages.ts`. A future improvement could promote this type to `@keykeykey/core/sync` for cross-platform consistency, but that is out of scope for this sub-project.

## 5. Onboarding "Restore from Cloud" Placeholder

### Desktop (`SetupScreen.tsx`)

Below the "Create Vault" button, add:
```tsx
<Button
  title="Restore from Cloud"
  variant="secondary"
  disabled
/>
<p style={{
  textAlign: 'center',
  color: theme.colors.textSecondary,
  fontSize: theme.typography.sizes.sm,
  marginTop: 8,
}}>
  Coming soon
</p>
```

### Mobile (`setup.tsx`)

Same placement — below "Create Vault":
```tsx
<Button
  title="Restore from Cloud"
  variant="secondary"
  disabled
/>
<Text style={{
  textAlign: 'center',
  color: t.colors.textSecondary,
  fontSize: 13,
  marginTop: 8,
}}>
  Coming soon
</Text>
```

## 6. New Files

| File | Purpose |
|------|---------|
| `apps/desktop/src/screens/SyncSettingsScreen.tsx` | Desktop sync settings screen |
| `apps/desktop/src/screens/SyncSettingsScreen.test.tsx` | Desktop sync settings tests |
| `apps/mobile/app/settings/sync.tsx` | Mobile sync settings screen |
| `apps/mobile/__tests__/screens/sync-settings.test.tsx` | Mobile sync settings tests |

## 7. Modified Files

| File | Change |
|------|--------|
| `apps/desktop/src/App.tsx` | Add `<Route path="settings/sync">` as sibling inside AppShell |
| `apps/desktop/src/screens/SettingsScreen.tsx` | Replace sync placeholder row with live status + navigation |
| `apps/desktop/src/screens/SetupScreen.tsx` | Add disabled "Restore from Cloud" button |
| `apps/desktop/src/lib/vault-context.tsx` | Add `triggerSync()` to context type and provider |
| `apps/mobile/app/_layout.tsx` | Add `<Stack.Screen name="settings/sync">` entry |
| `apps/mobile/app/(tabs)/settings.tsx` | Replace sync placeholder row with live status + navigation |
| `apps/mobile/app/setup.tsx` | Add disabled "Restore from Cloud" button |
| `apps/mobile/lib/vault-context.tsx` | Add `triggerSync()` to context type and provider |

## 8. Testing Strategy

### Unit Tests

- **Desktop `SyncSettingsScreen`** (`SyncSettingsScreen.test.tsx`): Vitest + jsdom. Mock vault context. Test:
  - Provider picker renders all options, Google Drive and iCloud are disabled
  - WebDAV fields appear when WebDAV is selected
  - Connect button disabled until all WebDAV fields filled
  - Connect calls `saveSyncConfig` with correct config
  - Disconnect calls `saveSyncConfig({ provider: 'none' })`
  - Sync Now calls `triggerSync()`, shows loading state, displays result
  - Sync status displays correctly (syncing, last synced, error, never synced)

- **Mobile `sync-settings.test.tsx`:** Jest + jest-expo. Same test cases as desktop adapted for React Native.

- **Vault context `triggerSync`:** Test that it calls `engine.sync()`, returns success timestamp, and returns error message on failure.

- **Settings rows:** Test that subtitle reflects sync config state and navigation fires on press.

- **Setup screens:** Test that "Restore from Cloud" button renders and is disabled.

### E2E Tests

No new E2E tests for this sub-project — the sync engine is already tested end-to-end. The UI layer is covered by unit tests. The sync settings flow (settings → sync screen → connect → sync now) is a candidate for future E2E coverage once all providers are implemented.
