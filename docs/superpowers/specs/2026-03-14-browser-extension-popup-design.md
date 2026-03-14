# Browser Extension: Popup + Background + Storage Design

Sub-project #1 of the browser extension implementation. Covers the core extension experience: vault management, unlock, credential CRUD, and settings. Content scripts and autofill are deferred to sub-project #2.

## Context

The extension app (`apps/extension`) is currently scaffolded with placeholder files — a stub popup, empty background worker, and empty content script. The shared core (`@keykeykey/core`) provides all crypto, models, state, and sync. The shared UI tokens (`@keykeykey/ui`) provide the lime/green/peach color system used by desktop and mobile.

### Decisions

| Decision | Choice |
|----------|--------|
| Feature scope | Full parity with mobile (setup, unlock, list, search, add, edit, detail, generator, settings) |
| State ownership | Background worker owns Zustand store; popup is a stateless view |
| Communication | Typed message protocol via `browser.runtime.sendMessage` |
| Cross-browser | `webextension-polyfill` — write `browser.*`, polyfill handles Chrome/Firefox/Safari |
| Storage | `browser.storage.local` for all persisted data (header, encrypted items, settings) |
| Auto-lock | `browser.alarms` with configurable modes: timed (default 15 min), on browser close, never |
| PIN unlock | Optional 4-8 digit PIN as a faster alternative to master password |
| Theming | `@keykeykey/ui` tokens, light/dark/system with `ThemeProvider` matching desktop pattern |
| URL auto-fill | Active tab URL pre-filled on add; name extracted as base domain |
| Domain matching | Contains-based matching (stored domain substring matched against page hostname) |
| Cloud sync | Integrates `@keykeykey/core/sync` — SyncEngine + adapters (Google Drive, WebDAV, iCloud/Safari-only) |

## 1. Architecture

```
┌─────────────────────────────────────────────┐
│  Popup (React UI)                           │
│  - Renders state snapshots from background  │
│  - Sends action messages (unlock, add, etc) │
│  - Stateless — re-fetches on every open     │
└──────────────┬──────────────────────────────┘
               │ browser.runtime.sendMessage
┌──────────────▼──────────────────────────────┐
│  Background Service Worker                  │
│  - Owns the Zustand vault store             │
│  - Holds DEK in memory (zeroed on lock)     │
│  - Manages auto-lock via browser.alarms     │
│  - Owns SyncEngine (when sync configured)   │
│  - Persists encrypted data to storage       │
│  - Responds to popup/content script msgs    │
└──────┬───────────────────┬──────────────────┘
       │ browser.storage   │ SyncEngine
       │ .local            │ (on item change)
┌──────▼──────────┐  ┌────▼──────────────────┐
│ Local Storage   │  │ Cloud Provider        │
│ - vault_header  │  │ - Google Drive        │
│ - item_<id>     │  │ - WebDAV              │
│ - settings      │  │ - iCloud (Safari)     │
│ - PIN data      │  │ via ISyncAdapter      │
│ - sync config   │  └───────────────────────┘
└─────────────────┘
```

All browser APIs accessed via `webextension-polyfill` (`browser.*` namespace). One codebase for Chrome, Firefox, and Safari.

## 2. Message Protocol

Typed message protocol between popup and background. Every message has a `type` and the background returns a typed response.

```typescript
// Item data for creation — matches core store's addItem signature
type NewItemData = Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>;
// Item updates — cannot change id, type, or createdAt
type ItemUpdates = Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>;

type BackgroundMessage =
  | { type: 'GET_STATUS' }                                          // → VaultStatusResponse
  | { type: 'SETUP'; password: string }                             // → { recoveryKey: string }
  | { type: 'UNLOCK'; password: string }                            // → { success: boolean; error?: string }
  | { type: 'UNLOCK_PIN'; pin: string }                             // → { success: boolean; attemptsRemaining?: number; error?: string }
  | { type: 'LOCK' }                                                // → { ok: true }
  | { type: 'GET_ITEMS' }                                           // → VaultItem[]
  | { type: 'SEARCH'; query: string }                               // → VaultItem[]
  | { type: 'ADD_ITEM'; item: NewItemData }                         // → { id: string }
  | { type: 'UPDATE_ITEM'; id: string; updates: ItemUpdates }       // → { ok: true }
  | { type: 'DELETE_ITEM'; id: string }                             // → { ok: true }
  | { type: 'GENERATE_PASSWORD'; options: PasswordGeneratorOptions } // → { password: string; entropy: number }
  | { type: 'GET_SETTINGS' }                                        // → Settings
  | { type: 'UPDATE_SETTINGS'; settings: Partial<Settings> }        // → { ok: true }
  | { type: 'SET_PIN'; pin: string }                                // → { ok: true }
  | { type: 'REMOVE_PIN' }                                          // → { ok: true }
  | { type: 'GET_ACTIVE_TAB_URL' }                                  // → { url: string | null }

type VaultStatusResponse = {
  status: 'loading' | 'needs_setup' | 'locked' | 'unlocked';
  hasPIN: boolean;
  itemCount: number;
};

// All responses may include { error: string } on failure.
// The popup should handle errors generically (display the message)
// unless the error is expected (e.g., wrong password).
```

**Status derivation:** The `GET_STATUS` handler determines status by:
1. `'loading'` — background is still reading from `browser.storage.local` (async, brief)
2. `'needs_setup'` — no `vault_header` key exists in storage
3. `'locked'` — vault header exists but DEK is not in memory
4. `'unlocked'` — DEK is in memory

This mirrors the desktop vault context pattern.

**Flow — popup opens:**
1. Popup sends `GET_STATUS`
2. Background replies with status, hasPIN, itemCount
3. Popup renders the appropriate screen (or a spinner for `loading`)

**Auto-lock reset:** Every message from the popup resets the alarm timer (user is active).

## 3. Background Service Worker

### Initialization

On service worker start:
1. The JS Argon2 fallback is used automatically (no `setArgon2Adapter` call needed — the core defaults to `@noble/hashes/argon2` when no native adapter is registered). This is intentional: the extension runs in V8/SpiderMonkey which is fast enough for `ARGON2_PRESETS.browser`.
2. Read `vault_header` from `browser.storage.local` to determine initial status.

### Vault Store

Creates a `@keykeykey/core` Zustand store in memory. On unlock, loads encrypted items from `browser.storage.local`, decrypts them, populates the store. On any mutation (add/update/delete), re-encrypts the changed item and persists to storage.

### Setup Flow

When the background receives a `SETUP` message:
1. `generateRecoveryKey()` → `{ raw, formatted }`
2. `createVaultHeader(password, raw, ARGON2_PRESETS.browser)` → `{ header, dek }`
3. `serializeVaultHeader(header)` → base64-encode → persist to `browser.storage.local` as `vault_header`
4. Create vault store, load header, set DEK in closure
5. Return `{ recoveryKey: formatted }` to popup

Uses `ARGON2_PRESETS.browser` (t: 2, m: 19456, p: 1) — the preset designed for browser JS engines.

### DEK Lifecycle

The DEK lives only in the store's closure (same as mobile/desktop). On service worker termination (Manifest V3 can kill it anytime), the DEK is lost and the user must re-unlock. This is the intended security behavior.

### Auto-Lock Timer

Configurable with three modes:
- **Timed** (default): 15 minutes, configurable (5/15/30/60 min). Uses `browser.alarms.create('auto-lock', { delayInMinutes })`. Every popup message resets the alarm. When alarm fires, store is locked (DEK zeroed, items cleared).
- **On browser close**: lock when all browser windows close. Uses window tracking via `browser.windows.onRemoved`. Requires adding `windows` permission to `manifest.json`.
- **Never**: DEK stays in memory as long as the service worker lives. User must manually lock. On service worker termination (browser restart, crash), re-unlock is still required since DEK is in-memory only.

### PIN Unlock

A faster alternative to typing the full master password:
- User sets a 4-8 digit PIN during setup or in settings
- PIN derives a secondary KEK via Argon2id using **the same `ARGON2_PRESETS.browser` params** as the master password. Although the PIN has low entropy (13-26 bits for 4-8 digits), using strong KDF params compensates. The 5-attempt lockout provides the primary brute-force protection.
- The PIN-derived KEK wraps the DEK, and the wrapped blob is stored in `browser.storage.local`
- On unlock, user can choose PIN or master password
- Max 5 PIN attempts — on exhaustion, PIN-wrapped DEK and salt are wiped from storage, must use master password to re-unlock (user can then set a new PIN)
- PIN is local to the extension — doesn't affect other platforms

### Storage Layout

`browser.storage.local` keys:

| Key | Value | Description |
|-----|-------|-------------|
| `vault_header` | string (base64) | Serialized vault header |
| `item_<id>` (per item) | string (base64) | One key per encrypted item, prefixed with `item_` |
| `settings` | JSON | `{ autoLockMode, autoLockMinutes, themeMode }` |
| `pin_wrapped_dek` | string (base64) | PIN-wrapped DEK (only if PIN enabled) |
| `pin_salt` | string (base64) | Argon2id salt for PIN derivation |
| `pin_attempts_remaining` | number | Default 5, decremented on failure |

### Persistence on Mutation

Each encrypted item is stored as its own key in `browser.storage.local` with a `item_` prefix. This avoids read-modify-write on a single large record:

```
addItem(data)
  → store.addItem(data) → returns id
  → store.encryptItem(item) → base64
  → browser.storage.local.set({ [`item_${id}`]: base64 })

deleteItem(id)
  → store.deleteItem(id)
  → browser.storage.local.remove(`item_${id}`)
```

On unlock, all items are loaded by listing keys with the `item_` prefix via `browser.storage.local.get(null)` (returns all keys) and filtering.

## 4. Popup UI

### Screens

360×480px React app with a state-machine navigation:

```
GET_STATUS → needs_setup → SetupScreen → RecoveryKeyScreen
                         → RestoreFromCloudScreen → UnlockScreen
           → locked      → UnlockScreen (master password or PIN)
           → unlocked    → VaultListScreen
                            ├→ CredentialDetailScreen
                            ├→ AddItemScreen
                            ├→ EditItemScreen
                            ├→ GeneratorScreen
                            └→ SettingsScreen
```

| Screen | Description |
|--------|-------------|
| **SetupScreen** | Two paths: "Create New Vault" (master password + confirm) or "Restore from Cloud" |
| **RecoveryKeyScreen** | Display recovery key, confirm user saved it |
| **RestoreFromCloudScreen** | Provider picker (Google Drive / WebDAV / iCloud), authenticate, download vault, then prompt for master password |
| **UnlockScreen** | Master password field OR PIN pad (if PIN set), toggle between them, forgot password link |
| **VaultListScreen** | Search bar, filter chips (all/logins/cards/notes), scrollable item list with copy buttons, floating + button |
| **CredentialDetailScreen** | All fields displayed, copy buttons for username/password/URL, reveal toggle for password |
| **AddItemScreen** | Type picker (credential/card/note), form fields, generate password button. URL auto-filled from active tab, name auto-populated with base domain |
| **EditItemScreen** | Pre-filled form, save/cancel buttons |
| **GeneratorScreen** | Random/passphrase toggle, length/word count sliders, character class toggles, entropy meter, copy button |
| **SettingsScreen** | Cloud sync config (provider picker, connect/disconnect, sync status), auto-lock mode picker, timeout selector, theme toggle (light/dark/system), set/change/remove PIN, lock vault button, version info |

### Theming

`ThemeProvider` wrapping the popup, reads `settings.themeMode` from background on mount. Uses `@keykeykey/ui` tokens:
- Lime accent (`#A3E635`) constant across both modes
- Light: white bg, peach surfaces, stone text
- Dark: black bg, dark green surfaces, green-tinted text
- System: follows `prefers-color-scheme` media query

Matches the desktop `ThemeProvider` pattern.

### URL Auto-Fill on Add

When user taps "+" to add a credential:
1. Popup sends `GET_ACTIVE_TAB_URL` to background
2. Background queries `browser.tabs.query({ active: true, currentWindow: true })` and returns the URL
3. Full URL stored in the `url` field
4. `name` field auto-populated with the base domain (e.g., `https://login.github.com/oauth` → `github`)
5. User can edit both fields before saving

### Domain Extraction

Extracts the "brand" name from a URL for the name field:
- Strip protocol and path
- Strip known subdomains (`www`, `login`, `auth`, `accounts`, `app`, `m`, `mail`)
- Strip TLD (`.com`, `.org`, etc.) and multi-level TLDs (`.co.uk`, `.com.br`, etc.)
- Result: `https://login.github.com/oauth/authorize` → `github`

Multi-level TLD handling: use the `tldts` npm package (lightweight, well-maintained) for accurate public suffix detection. This correctly handles `.co.uk`, `.com.br`, `.github.io`, etc. without maintaining a hardcoded list.

This helper lives in `@keykeykey/core` (shared across platforms).

### Domain Matching

For credential lookup (used by autofill in sub-project #2, but the matching logic is in core):
- `matchCredentialsByDomain(hostname, items)` filters items where the stored URL's domain **contains** the query hostname's base domain, or vice versa
- Example: stored `github.com` matches `login.github.com`, `gist.github.com`, `github.com/settings`
- Multiple matches returned to caller for user selection

This also lives in `@keykeykey/core`.

## 5. Cross-Browser Considerations

### Manifest

Single `manifest.json` targeting Manifest V3. Key differences handled:

| Feature | Chrome | Firefox | Safari |
|---------|--------|---------|--------|
| API namespace | `chrome.*` (polyfilled) | `browser.*` (native) | `browser.*` (native) |
| Service worker | Supported | Supported (MV3) | Supported (MV3) |
| `browser.alarms` | Supported | Supported | Supported |
| `browser.storage.local` | Supported | Supported | Supported |
| `browser.tabs.query` | Supported | Supported | Supported |

`webextension-polyfill` normalizes all API calls. No browser-specific code paths needed for this sub-project.

### Build

Vite builds a single output that works across all browsers. CRXJS plugin handles Chrome-specific dev tooling. For Firefox, `web-ext` is used for linting and testing. Safari uses Xcode's Web Extension converter on the same build output.

## 6. Testing Strategy

### Unit Tests (Vitest + jsdom)

- **Message handler:** test each message type against a mock store — verify correct store method is called and correct response is returned
- **Storage layer:** test persist/load with mocked `browser.storage.local`
- **PIN unlock:** test derivation, wrapping/unwrapping DEK, attempt counting, lockout after 5 failures, PIN wipe
- **Domain extraction:** test URL → brand name (subdomains, multi-level TLDs, edge cases like `localhost`, IP addresses)
- **Domain matching:** test contains-based matching with various URL patterns
- **Auto-lock:** test alarm creation, reset on activity, lock on fire, mode switching
- **Popup components:** React Testing Library for each screen — verify correct messages sent, correct rendering based on state
- **Theme provider:** test light/dark/system mode switching and persistence

### Mocking Strategy

- `webextension-polyfill` mocked via a test helper providing in-memory implementations of `browser.storage.local`, `browser.runtime`, `browser.alarms`, `browser.tabs`
- Background message handler tested directly (call handler function with typed messages, assert responses)
- Popup components mock `browser.runtime.sendMessage` and assert correct messages sent

### Coverage Target

High statement/branch coverage on background worker and message protocol, matching core's standard.

## 7. Cloud Sync Integration

The extension integrates with the sync infrastructure built in `@keykeykey/core/sync` (SyncEngine, cloud adapters) to keep the vault synchronized across devices.

### Sync in the Background Worker

The background worker owns the `SyncEngine` instance, wired to the vault store via `connectSyncEngine()`:

```
On unlock:
  1. Create adapter from saved SyncConfig (Google Drive / WebDAV / iCloud)
  2. Create SyncEngine({ adapter, store })
  3. connectSyncEngine(store, engine) — auto-syncs on item changes (debounced 2s)
  4. engine.sync() — initial pull of latest remote state

On lock:
  1. Disconnect sync engine
  2. Null out adapter and engine references
```

### Sync Config Persistence

Sync configuration is stored in `browser.storage.local`:

| Key | Value | Description |
|-----|-------|-------------|
| `sync_provider` | `'google-drive' \| 'icloud' \| 'webdav' \| 'none'` | Selected provider |
| `sync_webdav_url` | string | WebDAV server URL (if provider is webdav) |
| `sync_webdav_creds` | string (base64) | WebDAV username:password encrypted with DEK (only accessible when unlocked) |

Google Drive auth tokens are managed via `browser.identity` (Chrome) or OAuth redirect flow. The adapter receives a `getAccessToken` callback that handles token refresh transparently.

iCloud is only available in Safari — the settings screen hides the iCloud option on Chrome/Firefox.

### Message Protocol Additions

```typescript
type BackgroundMessage =
  // ... existing messages ...
  | { type: 'GET_SYNC_STATUS' }                                    // → { provider, lastSynced, isSyncing }
  | { type: 'CONFIGURE_SYNC'; config: SyncConfig }                 // → { ok: true }
  | { type: 'TRIGGER_SYNC' }                                       // → SyncResult
  | { type: 'DISCONNECT_SYNC' }                                    // → { ok: true }
```

### Settings Screen — Sync Section

The SettingsScreen includes a "Cloud Sync" section:
- **Provider picker**: Google Drive / iCloud (Safari only) / WebDAV / None
- **WebDAV config**: URL, username, password fields (shown when WebDAV selected)
- **Google Drive**: "Connect" button that initiates OAuth flow
- **Sync status**: last synced timestamp, sync-in-progress indicator
- **Manual sync**: "Sync Now" button
- **Disconnect**: removes sync config and stops auto-sync

### First Launch — Restore from Cloud

The SetupScreen offers two paths (matching the sync design spec):
1. **Create New Vault** — standard setup flow
2. **Restore from Cloud** — user picks a provider, authenticates, the background downloads the vault header + encrypted items, then prompts for master password to decrypt

This mirrors the flow described in the vault sync design spec (Section 5).

### Adapter Construction

```typescript
// In background worker, on unlock:
function createAdapter(config: SyncConfig): ISyncAdapter | null {
  switch (config.provider) {
    case 'google-drive':
      return new GoogleDriveAdapter({ getAccessToken: () => getGoogleToken() });
    case 'webdav':
      return new WebDavAdapter({ url: config.webdavUrl, username, password });
    case 'icloud':
      // Safari only — use browser filesystem APIs
      return new ICloudAdapter({ containerPath, fs: safariFs });
    case 'none':
      return null;
  }
}
```

### Tombstone Integration

When the user deletes an item via the popup, the background worker:
1. Calls `store.deleteItem(id)`
2. Calls `engine.recordTombstone(id)`
3. Removes `item_<id>` from `browser.storage.local`
4. The `connectSyncEngine` subscription triggers `scheduleSync()`, which propagates the tombstone to the cloud

### Testing

- Test sync engine construction on unlock, teardown on lock
- Test SyncConfig persistence and restoration
- Test adapter creation for each provider type
- Test tombstone recording on delete
- Mock `SyncEngine.sync()` to verify it's called on unlock and on item changes

## 8. Clipboard Behavior

Copy buttons (username, password, URL) use `navigator.clipboard.writeText()` in the popup. After copying, the popup sends a `CLIPBOARD_COPIED` message to the background, which creates a 30-second alarm (`clipboard-clear`). When the alarm fires, the background creates a short-lived offscreen document that calls `navigator.clipboard.writeText('')` to clear the clipboard, then closes itself. This is the standard Manifest V3 pattern for accessing privileged APIs from the service worker. This matches the mobile app's auto-clear behavior.

## 8. Manifest Updates

The existing `manifest.json` needs these changes for sub-project #1:
- Add `windows` permission (for "on browser close" auto-lock mode)
- Remove the content script entry (deferred to sub-project #2 — avoids unnecessary `<all_urls>` permission during install)
- Ensure `alarms` permission is present (already listed)

## 9. Out of Scope (Sub-Project #2)

- Content script form detection and autofill injection
- Save-new-credential prompts on form submission
- Autofill UI overlay on web pages
- Auto-submit after fill
- HTTPS-only enforcement for autofill
- Cross-origin iframe handling
