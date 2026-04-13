# Sync Settings UI Deduplication

**Date:** 2026-04-13
**Status:** Approved
**Scope:** Extract shared `useSyncSettings` hook and web components from desktop + extension SyncSettingsScreen into `@keykeykey/ui`. Redesign mobile to use the hook.

## Context

Desktop (`SyncSettingsScreen.tsx`, 880 lines), extension (`SyncSettingsScreen/`, 4 files), and mobile (`sync.tsx`, 635 lines) all implement the same sync settings UI logic: provider selection, credential collection, master password validation, OAuth connect, WebDAV connect, sync-now, disconnect, and vault mismatch resolution. The three implementations share 80%+ identical state management and orchestration logic. Desktop and extension also share nearly identical web markup.

## Design

### 1. Driver interface

A `SyncSettingsDriver` abstracts all platform-specific I/O. Each platform implements it.

```ts
interface SyncSettingsDriver {
  // Auth
  validateMasterPassword(password: string): Promise<boolean>;

  // Config
  saveConfig(config: SyncConfig): Promise<void>;
  getInitialState(): Promise<{
    syncStatus: SyncStatus | null;
    mismatchInfo: MismatchInfo | null;
  }>;

  // Sync
  triggerSync(): Promise<{ lastSynced?: string; error?: string }>;
  disconnect(provider: SyncProvider): Promise<void>;

  // OAuth
  startOAuth(
    provider: 'google-drive' | 'dropbox' | 'onedrive',
    masterPassword: string,
  ): Promise<void>;

  // Mismatch resolution
  mergeVaults(): Promise<void>;
  replaceLocal(): Promise<void>;
  replaceRemote(): Promise<void>;
  clearMismatch(): Promise<void>;

  // Status refresh (for platforms that detect external state changes, e.g., extension storage listener)
  refreshStatus(): Promise<{
    syncStatus: SyncStatus | null;
    mismatchInfo: MismatchInfo | null;
  }>;

  // Optional platform hooks
  onConnected?(): void;
  onDisconnected?(): void;
}

interface SyncStatus {
  provider: SyncProvider;
  lastSynced: string | null;
  isSyncing: boolean;
  error: string | null;
}

interface MismatchInfo {
  canRestore: boolean;
  remoteItemCount?: number;
}
```

Desktop implements the driver by calling `useVault()` context methods and Tauri OAuth functions. Extension implements it by sending messages to the background script. Mobile implements it by calling its vault context methods directly.

### 2. The `useSyncSettings` hook

Lives in `packages/ui/src/hooks/use-sync-settings.ts`.

```ts
function useSyncSettings(driver: SyncSettingsDriver): SyncSettingsState
```

**Returns:**

```ts
interface SyncSettingsState {
  // Form fields
  syncProvider: SyncProvider;
  setSyncProvider: (p: SyncProvider) => void;
  webdavUrl: string;
  setWebdavUrl: (v: string) => void;
  webdavUsername: string;
  setWebdavUsername: (v: string) => void;
  webdavPassword: string;
  setWebdavPassword: (v: string) => void;
  masterPassword: string;
  setMasterPassword: (v: string) => void;

  // Derived
  isConnected: boolean;
  canConnect: boolean;

  // Status
  syncStatus: SyncStatus | null;
  mismatchInfo: MismatchInfo | null;
  error: string | null;
  loading: boolean;

  // Operation flags
  connecting: boolean;
  syncing: boolean;
  merging: boolean;
  replacingLocal: boolean;
  replacingRemote: boolean;
  showDisconnectConfirm: boolean;
  setShowDisconnectConfirm: (v: boolean) => void;

  // Actions
  handleWebdavConnect: () => Promise<void>;
  handleOAuthConnect: (provider: 'google-drive' | 'dropbox' | 'onedrive') => Promise<void>;
  handleSyncNow: () => Promise<void>;
  handleDisconnect: () => Promise<void>;
  handleMismatchMerge: () => Promise<void>;
  handleMismatchReplaceLocal: () => Promise<void>;
  handleMismatchReplaceRemote: () => Promise<void>;
  handleMismatchCancel: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}
```

**The hook owns:**
- All `useState` declarations (form fields, operation flags, error, loading)
- `useEffect` for initial load (calls `driver.getInitialState()`)
- All orchestration functions (validate master password → save config → trigger sync → handle errors)
- Derived values (`isConnected`, `canConnect`)

**The hook does NOT own:**
- Sync status polling (extension-specific — managed by extension driver or screen-level effect)
- HTTPS downgrade detection (desktop-specific — desktop adds this in its wrapper)
- OAuth window management (platform-specific — driver handles it)

### 3. Shared web components

Live in `packages/ui/src/components/sync-settings/`. Used by desktop and extension. Not used by mobile (React Native).

**ProviderSelector** — dropdown for provider selection + WebDAV credential fields + master password field. Receives form field slices from `SyncSettingsState` plus `isConnected` and `connecting` flags. Renders the `<select>` and conditional input fields.

**MismatchDialog** — overlay modal for vault mismatch resolution. Receives `mismatchInfo`, operation flags (`merging`, `replacingLocal`, `replacingRemote`), and action callbacks. Shows "Remote Vault Detected" (canRestore) or "Incompatible Remote Vault" variants.

**SyncStatusCard** — connected state display with last-synced timestamp, error banner, and action buttons (Sync Now, Disconnect). Receives `syncStatus`, `syncing`, `error`, action callbacks, `showDisconnectConfirm` + setter.

**ConnectingOverlay** — simple modal with spinner shown during OAuth/connection flows. Receives `connecting` and `onCancel`.

All components receive styling via the existing `useTheme()` hook from `@keykeykey/ui`. They use inline styles, consistent with the existing codebase.

### 4. Platform wiring

**Desktop** (`apps/desktop/src/screens/SyncSettingsScreen.tsx`) — shrinks from ~880 lines to ~80:
- Creates a driver from `useVault()` context + Tauri OAuth functions
- Calls `useSyncSettings(driver)`
- Renders shared components
- Adds desktop-only HTTPS downgrade warning (reads `wasSchemeDowngradeDetected()` locally)

**Extension** (`apps/extension/src/popup/screens/SyncSettingsScreen/`) — 4-file directory collapses to a single file ~60 lines:
- Creates a driver that wraps `sendMessage()` calls
- Calls `useSyncSettings(driver)`
- Renders shared components
- Adds a small `useEffect` for `browser.storage.onChanged` polling if needed

**Mobile** (`apps/mobile/app/settings/sync.tsx`) — shrinks from ~635 lines to ~200:
- Creates a driver from its vault context
- Calls `useSyncSettings(driver)`
- Keeps all React Native UI rendering (not shared)

### 5. Out of scope

- No changes to `@keykeykey/core/sync` (SyncLifecycle, SyncConfig, adapters)
- No changes to extension background script message handlers
- No changes to vault-context in any platform (drivers wrap existing methods)
- No mobile UI components in `@keykeykey/ui`
- No new entry point (components export from existing `@keykeykey/ui`)
- No theme changes
- No new test framework
