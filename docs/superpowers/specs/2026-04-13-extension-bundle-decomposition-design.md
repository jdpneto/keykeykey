# Extension Bundle Decomposition Design

**Date:** 2026-04-13
**Status:** Draft
**Scope:** `apps/extension/` internal restructuring + OAuth consolidation into `packages/core/src/sync/oauth/`

## Problem

The graphify knowledge graph identifies the Extension Bundle community as having a low cohesion score (0.02–0.03). The root causes:

1. **`background/message-handler.ts`** is a god module: 1,376 lines handling 70+ message types spanning vault lifecycle, item CRUD, credential autofill, sync operations, OAuth flows, import/export, and settings/PIN management — all in a single closure sharing module-level state
2. **`popup/Popup.tsx`** conflates routing, vault status polling, operation progress tracking, and inline progress/error views (744 lines)
3. **Six popup screens** exceed 500 lines each (ImportScreen 957, RestoreScreen 911, SyncSettingsScreen 888, SettingsScreen 719, AddItemScreen 570, EditItemScreen 537), with AddItem and EditItem duplicating form rendering logic
4. **Extension OAuth modules** (`lib/google-oauth.ts`, `lib/dropbox-oauth.ts`, `lib/onedrive-oauth.ts`) duplicate token refresh, revocation, and auth URL construction logic that already exists in `packages/core/src/sync/oauth/`
5. **`lib/`** is a flat grab-bag mixing OAuth, message types, theme, and browser detection with no internal organization

## Goals

1. **Single Responsibility** — Each file owns one concern: vault handler, item handler, sync handler, etc.
2. **Testability** — Domain handlers testable in isolation via a mock `HandlerContext`, no need to exercise the full message router
3. **DRY OAuth** — Extension delegates token lifecycle to core; keeps only browser-specific `launchWebAuthFlow` glue
4. **Readability** — Smaller, focused files. Most files under ~300 lines; no file exceeds ~500 lines after decomposition
5. **Composability** — Popup screens built from reusable form components shared between Add and Edit flows

## Non-Goals

- Changing the extension's public entry points (manifest, popup HTML, service worker entry)
- Modifying build configuration (`vite.config.ts`, manifest files)
- Refactoring content scripts (already well-isolated)
- Altering any runtime behavior — pure structural decomposition
- Changing `@keykeykey/core` public API surface (only ensuring existing OAuth exports are accessible)

## Constraints

- Build produces Chrome and Firefox targets from shared source — both must work after decomposition
- Content scripts build as IIFE (single file, inlined deps) — no changes to this pipeline
- Service worker restarts lose in-memory state — `HandlerContext` must be reconstructable from `browser.storage.local`
- All existing tests must pass without behavioral changes
- Green-to-green at every commit

## Execution Strategy

Two PRs, planned together, executed sequentially:

- **PR1:** OAuth consolidation into core (cross-package, isolated change)
- **PR2:** Internal extension decomposition (handlers, popup, lib reorganization)

---

## PR1: OAuth Consolidation into Core

### What Moves

The extension's OAuth files duplicate logic that core's `sync/oauth/` already provides:

| Concern | Extension (current) | Core (exists) |
|---------|-------------------|---------------|
| Token refresh | `lib/google-oauth.ts` refresh logic | `oauth-client.ts → refreshAccessToken()` |
| Token revocation | Per-provider revoke functions | `oauth-client.ts → revokeToken()` |
| Auth URL construction | Inline URL building | `google.ts`, `dropbox.ts`, `onedrive.ts` → `buildXxxAuthUrl()` |
| Token caching | Per-provider in-memory cache | `cached-token-provider.ts → createCachedTokenProvider()` |
| Code exchange | Inline POST to token endpoint | `oauth-client.ts → exchangeAuthCode()` |

### What Stays in Extension

Browser-specific glue that cannot move to core (core has no browser extension APIs):

- `chrome.identity.launchWebAuthFlow()` / `browser.identity.launchWebAuthFlow()`
- `chrome.identity.getAuthToken()` (Chrome-only Google shortcut)
- Token persistence to `browser.storage.local`

### Core Changes

Audit `packages/core/src/sync/oauth/index.ts` exports. Ensure these are publicly available:

- `exchangeAuthCode` (may need explicit export)
- `buildGoogleAuthUrl`, `buildDropboxAuthUrl`, `buildOneDriveAuthUrl`
- `createCachedTokenProvider`
- `revokeToken`
- `GOOGLE_ENDPOINTS`, `DROPBOX_ENDPOINTS`, `ONEDRIVE_ENDPOINTS`

No new code in core — only ensuring existing implementations are exported.

### Extension OAuth — After PR1

```
lib/oauth/
├── index.ts             # re-exports
├── google.ts            # ~25 lines: launchWebAuthFlow → exchangeAuthCode → store token
├── dropbox.ts           # ~25 lines: same pattern
└── onedrive.ts          # ~25 lines: same pattern
```

Each file:
1. Imports `buildXxxAuthUrl()` from `@keykeykey/core/sync`
2. Calls `browser.identity.launchWebAuthFlow({ url })` (browser-specific)
3. Extracts auth code from redirect URL
4. Calls `exchangeAuthCode()` from `@keykeykey/core/sync`
5. Stores refresh token in `browser.storage.local`
6. Exports token provider via `createCachedTokenProvider()` from core

### Background Sync Adapter Updates

`background/sync.ts` currently overrides adapter `getAccessToken` with Chrome-specific `chrome.identity.getAuthToken`. After PR1, this override calls the thin `lib/oauth/google.ts` wrapper instead of inline logic.

---

## PR2: Internal Extension Decomposition

### Background — Handler Decomposition

#### HandlerContext

```typescript
// background/context.ts
export interface HandlerContext {
  store: VaultStore;
  storage: ExtensionStorage;
  autoLock: AutoLockManager;
  syncLifecycle: SyncLifecycleWrapper;
  broadcastToContentScripts: (msg: ContentPushMessage) => Promise<void>;
  scheduleClipboardClear: () => void;
}

export function createHandlerContext(): HandlerContext { ... }
```

Created once in `background/index.ts` on service worker startup. Reconstructable from `browser.storage.local` after service worker restart.

#### Message Router

```typescript
// background/router.ts
type Handler = (msg: BackgroundMessage, ctx: HandlerContext) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  // Vault
  SETUP: vaultHandlers.setup,
  UNLOCK: vaultHandlers.unlock,
  UNLOCK_PIN: vaultHandlers.unlockPin,
  LOCK: vaultHandlers.lock,
  RESET_VAULT: vaultHandlers.resetVault,
  // Items
  GET_ITEMS: itemHandlers.getItems,
  // ... all 70+ message types registered
};

export function routeMessage(msg: BackgroundMessage, ctx: HandlerContext): Promise<unknown> {
  const handler = handlers[msg.type];
  if (!handler) throw new Error(`Unknown message type: ${msg.type}`);
  return handler(msg, ctx);
}
```

#### Domain Handlers

```
background/handlers/
├── index.ts               # re-exports
├── vault.ts               # SETUP, UNLOCK, UNLOCK_PIN, LOCK, RESET_VAULT (~150 lines)
├── items.ts               # GET_ITEMS, ADD_ITEM, UPDATE_ITEM, DELETE_ITEM, SEARCH (~120 lines)
├── credentials.ts         # GET_MATCHING_CREDENTIALS, FILL/SAVE/UPDATE_CREDENTIAL (~100 lines)
├── sync.ts                # TRIGGER_SYNC, CONFIGURE_SYNC, DISCONNECT_SYNC, restore, merge/replace (~200 lines)
├── oauth.ts               # GOOGLE_OAUTH_CONNECT/DISCONNECT, DROPBOX_*, ONEDRIVE_* (~120 lines)
├── import-export.ts       # IMPORT_ITEMS, GET_IMPORT_STATUS, EXPORT_* (~150 lines)
└── settings.ts            # GET_SETTINGS, UPDATE_SETTINGS, SET_PIN, REMOVE_PIN (~100 lines)
```

Each handler file:
- Exports named async functions: `(msg: SpecificMessageType, ctx: HandlerContext) => Promise<ResponseType>`
- Owns its ephemeral progress state (e.g., `import-export.ts` owns `importState`, `sync.ts` owns `restoreState` and `syncOpState`)
- Imports only from `@keykeykey/core`, `HandlerContext`, and sibling background modules (`storage.ts`, `sync-lifecycle.ts`)

#### Existing Background Modules — No Changes

| File | Lines | Reason |
|------|-------|--------|
| `storage.ts` | 278 | Already focused on `browser.storage.local` persistence |
| `badge.ts` | 53 | Single-purpose badge updater |
| `auto-lock.ts` | 68 | Single-purpose alarm manager |
| `clipboard.ts` | 52 | Single-purpose clipboard clear |
| `sync-lifecycle.ts` (renamed from `sync.ts`) | 117 | Core sync lifecycle wrapper |

#### New Background Directory Structure

```
background/
├── index.ts                    # Service worker entry (~50 lines)
├── router.ts                   # Message dispatcher (~60 lines)
├── context.ts                  # HandlerContext type + factory
├── handlers/
│   ├── index.ts
│   ├── vault.ts
│   ├── items.ts
│   ├── credentials.ts
│   ├── sync.ts
│   ├── oauth.ts
│   ├── import-export.ts
│   └── settings.ts
├── storage.ts                  # unchanged
├── badge.ts                    # unchanged
├── auto-lock.ts                # unchanged
├── clipboard.ts                # unchanged
└── sync-lifecycle.ts           # renamed from sync.ts
```

### Popup — Router & Screen Decomposition

#### Router Extraction

```
popup/
├── Popup.tsx                       # Slim shell (~80 lines): renders <Router />
├── router/
│   ├── Router.tsx                  # Screen routing by vault status + screen state
│   ├── routes.ts                   # Route/screen name constants
│   └── useOperationProgress.ts     # Progress polling extracted from Popup.tsx
```

`Popup.tsx` retains:
- `<ThemeProvider>` wrapper
- Vault status fetch on mount
- Delegates all routing and progress tracking to `router/`

`useOperationProgress` hook encapsulates:
- `browser.storage.onChanged` listener
- Progress state machine for import, restore, sync operations
- Returns current operation status for Router to display appropriate screen/overlay

#### Screen Decomposition — Large Screens

Screens under 500 lines stay as single files. Six screens are decomposed:

**AddItemScreen/ and EditItemScreen/ — Shared Forms**

```
popup/components/forms/
├── CredentialForm.tsx          # Username, password, URL fields
├── CardForm.tsx                # Cardholder, number, expiry, CVV fields
└── NoteForm.tsx                # Content textarea

popup/screens/AddItemScreen/
├── AddItemScreen.tsx           # Orchestrator: type selector + renders form (~150 lines)

popup/screens/EditItemScreen/
├── EditItemScreen.tsx          # Orchestrator: loads item, renders form (~150 lines)
```

Both screens import from `components/forms/` and pass different props:
- AddItem: empty initial values, `onSubmit` calls `ADD_ITEM`
- EditItem: populated initial values, `onSubmit` calls `UPDATE_ITEM`

**SettingsScreen/**

```
popup/screens/SettingsScreen/
├── SettingsScreen.tsx          # Orchestrator (~200 lines)
├── AutoLockSettings.tsx        # Auto-lock mode selector, timeout config
├── PinSettings.tsx             # PIN setup/remove flow
└── DangerZone.tsx              # Reset vault, export link
```

**SyncSettingsScreen/**

```
popup/screens/SyncSettingsScreen/
├── SyncSettingsScreen.tsx      # Orchestrator (~200 lines)
├── ProviderSelector.tsx        # Provider picker + credential config forms
├── OAuthPanel.tsx              # OAuth connect/disconnect per provider
└── MismatchResolver.tsx        # Conflict resolution UI
```

**RestoreScreen/**

```
popup/screens/RestoreScreen/
├── RestoreScreen.tsx           # Orchestrator
├── ProviderStep.tsx            # Pick provider + enter credentials
└── RestoreProgress.tsx         # Progress + error views
```

**ImportScreen/**

```
popup/screens/ImportScreen/
├── ImportScreen.tsx            # Orchestrator
├── FileSelector.tsx            # File picker + format detection
├── FieldMapping.tsx            # Column mapping UI
└── ImportProgress.tsx          # Progress + results view
```

#### Shared Components

```
popup/components/
├── PinPad.tsx                  # unchanged
├── ItemCard.tsx                # unchanged
├── CopyButton.tsx              # unchanged
├── icons/index.tsx             # unchanged
├── ProgressView.tsx            # NEW: extracted from Popup.tsx inline progress/error views
└── forms/
    ├── CredentialForm.tsx      # shared between AddItem and EditItem
    ├── CardForm.tsx
    └── NoteForm.tsx
```

`ProgressView` replaces the four inline views (`RestoreProgressView`, `RestoreErrorView`, `SyncOpProgressView`, `SyncOpErrorView`) with a single component accepting props for icon, message, and optional retry/cancel actions.

### Lib Reorganization

```
lib/
├── messages.ts              # unchanged (126 lines — type definitions)
├── browser-detect.ts        # unchanged (22 lines)
├── browser-mock.ts          # unchanged (test utility)
├── theme.tsx                # unchanged (124 lines)
└── oauth/
    ├── index.ts             # re-exports
    ├── google.ts            # thin browser glue (~25 lines, post-PR1)
    ├── dropbox.ts           # thin browser glue (~25 lines, post-PR1)
    └── onedrive.ts          # thin browser glue (~25 lines, post-PR1)
```

### Content Scripts — No Changes

Already well-isolated with clean single-responsibility files:
- `content/index.ts` — orchestrator
- `content/form-detector.ts` — form detection
- `content/autofill-icon.ts` — autofill UI injection
- `content/save-detector.ts` — save prompt

---

## Migration Strategy

### PR1 Commit Sequence

1. Audit + export missing symbols from `packages/core/src/sync/oauth/index.ts`
2. Create `apps/extension/src/lib/oauth/` directory with thin wrappers
3. Rewrite `lib/google-oauth.ts`, `lib/dropbox-oauth.ts`, `lib/onedrive-oauth.ts` to delegate to core
4. Update `background/message-handler.ts` and `background/sync.ts` imports
5. Delete old top-level OAuth files, update barrel export
6. Run tests + build both targets

### PR2 Commit Sequence

1. Create `background/context.ts` — `HandlerContext` type and factory
2. Extract `background/handlers/vault.ts` from message-handler
3. Extract `background/handlers/items.ts`
4. Extract `background/handlers/credentials.ts`
5. Extract `background/handlers/sync.ts`
6. Extract `background/handlers/oauth.ts`
7. Extract `background/handlers/import-export.ts`
8. Extract `background/handlers/settings.ts`
9. Create `background/router.ts` — thin dispatcher
10. Reduce `background/message-handler.ts` to shim re-exporting router
11. Rename `background/sync.ts` → `background/sync-lifecycle.ts`
12. Extract `popup/router/Router.tsx` and `useOperationProgress.ts` from `Popup.tsx`
13. Extract shared form components to `popup/components/forms/`
14. Decompose `AddItemScreen` and `EditItemScreen` to use shared forms
15. Decompose `SettingsScreen` into sub-components
16. Decompose `SyncSettingsScreen` into sub-components
17. Decompose `RestoreScreen` into sub-components
18. Decompose `ImportScreen` into sub-components
19. Extract `popup/components/ProgressView.tsx` from inline views
20. Remove `message-handler.ts` shim, update `background/index.ts`
22. Move test files to match new structure, update imports
23. Final formatting pass (Prettier)

## Testing Strategy

- **Unit tests:** Each new handler file gets its own test file. Tests construct a mock `HandlerContext` and call handlers directly. Popup component tests update imports but logic stays the same.
- **Build verification:** Chrome and Firefox targets must build cleanly at every commit.
- **E2E validation:** `cd e2e && npx playwright test --grep @critical` as final gate before merge.
- **Green-to-green:** All existing tests pass at every commit in both PRs.

## Risk Analysis

| Risk | Mitigation |
|------|-----------|
| Circular dependencies between handlers | Handlers only depend on `HandlerContext` + `@keykeykey/core`, never on each other |
| Service worker state reconstruction | `createHandlerContext()` rebuilds from `browser.storage.local` — same as current behavior |
| Content script IIFE build breaks | Content scripts are untouched — no risk |
| Import resolution in Vite | Follow same patterns as existing codebase; sub-module index files with explicit `.js` extensions |
| Large PR2 review surface | Well-organized commits, each independently reviewable. Shim pattern allows incremental verification |
