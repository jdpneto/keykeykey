# Browser Extension Autofill — Content Script, Badge & Save Flow

## Overview

Add autofill functionality to the browser extension (Chrome, Firefox, Safari): detect login forms on web pages, show a badge on the extension icon indicating matching credentials, inject an autofill icon into login fields, and prompt to save new credentials after form submission. The extension already has a full popup UI, background worker with vault management, and 24 message types. This spec adds the content script implementation and badge logic.

## Scope

- **In scope:** Content script form detection, autofill icon injection (shadow DOM), credential fill flow, extension badge with match count, save/update credential prompt, background message handler for new message types
- **Out of scope:** Credit card autofill, passkey/WebAuthn, cross-origin iframe autofill, auto-submit, TOTP autofill (future)

## 1. Extension Badge & Tab Monitoring

### 1.1 Badge Updates

The background worker monitors tab activity and updates the extension badge:

- **`browser.tabs.onActivated`** — user switches tabs
- **`browser.tabs.onUpdated`** with `changeInfo.url` — user navigates within a tab

On each event, extract the hostname from the active tab's URL and call `matchCredentialsByDomain()` from `@keykeykey/core`:

- **Vault locked:** set icon to a "locked" variant via `browser.action.setIcon()` (use a gray-tinted version of the extension icon). Avoid emoji badge text (`"🔒"`) as it renders inconsistently across platforms (blank squares on Chrome/Windows).
- **Vault unlocked, matches > 0:** green badge with count (e.g., `"2"`) via `browser.action.setBadgeText()` + `setBadgeBackgroundColor('#22c55e')`
- **Vault unlocked, no matches:** clear badge (empty text)

Uses `browser.action.*` via `webextension-polyfill` for cross-browser compatibility (Chrome, Firefox, Safari).

### 1.2 Manifest Changes

The `tabs` permission grants access to `tab.url` for all tabs and triggers a user-facing permission prompt in Chrome. However, it is required for `onActivated`/`onUpdated` listeners to read the tab URL for badge updates. The existing `activeTab` permission only grants URL access on user interaction (click), not on passive tab events.

Add to `manifest.json`:

```json
"permissions": [..., "tabs"],
"content_scripts": [{
  "matches": ["https://*/*", "http://localhost/*"],
  "js": ["src/content/index.ts"],
  "run_at": "document_idle"
}]
```

## 2. Content Script — Form Detection

### 2.1 Login Form Detection (`src/content/form-detector.ts`)

Scan the DOM for login forms using multiple signals:

- **Primary:** `<input type="password">` — the strongest signal for a login form
- **Autocomplete hints:** `autocomplete="username"`, `autocomplete="current-password"`, `autocomplete="email"`
- **Name/ID patterns:** input `name` or `id` containing `user`, `email`, `login`, `pass` (case-insensitive)
- **Context:** look for a nearby `<form>` element or a container with both a text/email input and a password input

### 2.2 Dynamic Form Detection

Use `MutationObserver` to watch for dynamically added forms (SPAs):

- Observe `document.body` for `childList` and `subtree` changes
- On mutation, re-scan added nodes for password fields
- Trailing-edge debounce with 100ms delay and 500ms maximum wait (handles rapid React reconciliation)
- Disconnect observer on content script teardown

### 2.3 Multi-Page Login Flows

Handle sites that split login across pages (e.g., Google: email on page 1, password on page 2):

- Detect single-field forms (email-only or password-only)
- For email-only pages: no autofill icon (no password to fill)
- For password-only pages: match credentials by domain and fill the password field

### 2.4 Content Script Organization

The content script entry point (`src/content/index.ts`) coordinates three modules:

```
src/content/
  index.ts              # Entry point: initializes detector, icon, save modules
  form-detector.ts      # Scans DOM for login forms, MutationObserver
  autofill-icon.ts      # Shadow DOM icon injection and credential dropdown
  save-detector.ts      # Form submission detection and save/update prompt
```

`index.ts` initializes the form detector, listens for detected forms, and passes them to the autofill icon module. It also subscribes to vault state changes from the background.

## 3. Content Script — Autofill UI

### 3.1 Autofill Icon Injection (`src/content/autofill-icon.ts`)

When login form detected and vault is unlocked with matches:

- Inject a small KeyKeyKey icon inside the username field (positioned absolute, right edge)
- Icon rendered inside a **shadow DOM** container for style isolation from the page
- Icon only appears when: HTTPS (or localhost), vault unlocked, match count > 0
- Include `aria-label="KeyKeyKey autofill"` and `role="button"` on the icon for accessibility
- Support keyboard activation (Enter/Space on focused icon)

**Cleanup:** When the form is removed from the DOM (SPA navigation) or the vault locks, remove the shadow DOM containers. The MutationObserver in `form-detector.ts` triggers cleanup when watched forms disappear.

### 3.2 Credential Dropdown

Clicking the autofill icon:

1. Send `GET_MATCHING_CREDENTIALS` to background with hostname
2. Background returns `[{ id, name, username }]` — no passwords
3. Show a dropdown (shadow DOM) below the icon listing matching credentials (name + username)
4. Dropdown is keyboard-navigable (arrow keys, Enter to select, Escape to close)
5. User clicks/selects a credential → send `FILL_CREDENTIAL` with credential ID
6. Background validates sender (see section 3.3), returns `{ username, password }` — one-time data
7. Content script fills both username and password fields using the native value setter for React compatibility:
   ```typescript
   const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
     HTMLInputElement.prototype,
     'value',
   )!.set!;
   nativeInputValueSetter.call(field, value);
   field.dispatchEvent(new Event('input', { bubbles: true }));
   field.dispatchEvent(new Event('change', { bubbles: true }));
   ```
8. Credentials are **never stored** in content script scope — filled and immediately discarded

### 3.3 Security Constraints

- **HTTPS only:** no autofill icon on `http://` pages (except `localhost`)
- **No cross-origin iframes:** check `window.top` origin; cross-origin iframes do not receive autofill
- **On-demand only:** content script only knows match count until user clicks the icon. Actual credentials only flow after explicit user action.
- **Immediate discard:** after filling, credential data is not retained in any variable or closure
- **Sender validation:** the background handler for `FILL_CREDENTIAL` must verify that `sender.tab` exists and that the sender's tab URL domain matches the credential's stored URL domain. This prevents a compromised content script on `evil.com` from requesting credentials stored for `bank.com`.
- **Scoped fill:** `FILL_CREDENTIAL` only accepts credential IDs that were returned in the most recent `GET_MATCHING_CREDENTIALS` response for that tab. The background keeps a per-tab allowlist of fillable IDs, cleared on navigation and when the vault locks (all per-tab allowlists cleared on lock).

### 3.4 Vault State Propagation

The background pushes vault state changes to active content scripts via `browser.tabs.sendMessage()`:

- On vault lock: send `{ type: 'VAULT_LOCKED' }` to all tabs → content scripts remove autofill icons
- On vault unlock: send `{ type: 'VAULT_UNLOCKED' }` to all tabs → content scripts re-check for forms and show icons if matches exist
- On item add/update/delete: send `{ type: 'VAULT_CHANGED' }` to all tabs → content scripts refresh match counts

Content scripts listen via `browser.runtime.onMessage` for these push notifications.

## 4. Save New Credentials Flow

### 4.1 Form Submission Detection (`src/content/save-detector.ts`)

- Listen for `submit` events on detected login forms
- **Proactive credential tracking:** on `input` events in detected password fields (throttled to every 500ms), store references to the username and password DOM elements (not values). On form submission, read the current values from the elements.
- For navigation-based logins (no `submit` event): use `beforeunload` as a best-effort fallback. Extract credentials from the tracked elements and send to background immediately. Accept that this may fail for some SPA navigations — the popup's manual add screen remains the fallback.

### 4.2 Save Prompt

After detecting form submission with credentials:

1. Send `CHECK_CREDENTIAL_EXISTS` to background with `{ hostname, username, password }`
   - **Note:** the password is sent to the background for comparison. This is an intra-extension message channel (not accessible to the page). The background compares the submitted password directly against the decrypted credential password in memory (not a hash — the vault stores plaintext passwords encrypted at rest, decrypted in memory when unlocked).
2. Background checks vault:
   - **New credential** (no match for this username + domain): return `{ exists: false, changed: false }`
   - **Password changed** (same username + domain, different password): return `{ exists: true, changed: true, credentialId }`
   - **Unchanged** (same username + domain + same password): return `{ exists: true, changed: false }`
3. If new or changed, inject a notification bar at the top of the page (shadow DOM):
   - Save: "Save this password to KeyKeyKey?" with Save / Dismiss buttons
   - Update: "Update password for [username] on [domain]?" with Update / Dismiss buttons
4. **Save:** send `SAVE_CREDENTIAL` to background with `{ url, username, password, name }` (name = domain brand). Background delegates to the existing `ADD_ITEM` handler logic (encryption, persistence).
5. **Update:** send `UPDATE_CREDENTIAL` to background with `{ credentialId, password }`. Background delegates to the existing `UPDATE_ITEM` handler logic.
6. **Dismiss:** remove the bar. Optionally remember dismissal for this domain via `browser.storage.local`
7. After save/update/dismiss, the content script clears all local references to the credentials.

## 5. Message Protocol

### 5.1 New Message Types

All responses follow the existing `MessageResponse<T>` pattern (success data or `{ error: string }` on failure).

| Message                    | Direction    | Input                                                      | Output                                                         |
| -------------------------- | ------------ | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `GET_CREDENTIALS_FOR_TAB`  | content → bg | `{ hostname: string }`                                     | `{ count: number }`                                            |
| `GET_MATCHING_CREDENTIALS` | content → bg | `{ hostname: string }`                                     | `{ credentials: [{id, name, username}] }`                      |
| `FILL_CREDENTIAL`          | content → bg | `{ id: string }`                                           | `{ username: string, password: string }`                       |
| `CHECK_CREDENTIAL_EXISTS`  | content → bg | `{ hostname: string, username: string, password: string }` | `{ exists: boolean, changed: boolean, credentialId?: string }` |
| `SAVE_CREDENTIAL`          | content → bg | `{ url, username, password, name }`                        | `{ success: boolean }`                                         |
| `UPDATE_CREDENTIAL`        | content → bg | `{ credentialId: string, password: string }`               | `{ success: boolean }`                                         |

**Background → content push messages** (not request/response):

| Message          | Direction    | Data | Purpose                       |
| ---------------- | ------------ | ---- | ----------------------------- |
| `VAULT_LOCKED`   | bg → content | `{}` | Remove autofill icons         |
| `VAULT_UNLOCKED` | bg → content | `{}` | Re-check forms and show icons |
| `VAULT_CHANGED`  | bg → content | `{}` | Refresh match counts          |

### 5.2 Background Handler Changes

In `src/background/message-handler.ts`, extend the `BackgroundMessage` union type with 6 new variants. Add handlers:

- **`GET_CREDENTIALS_FOR_TAB`:** Call `matchCredentialsByDomain(hostname, items)`, return `{ count: matches.length }`
- **`GET_MATCHING_CREDENTIALS`:** Same matching, return `matches.map(m => ({ id: m.id, name: m.name, username: m.username }))`. Store the returned IDs as the per-tab fillable allowlist.
- **`FILL_CREDENTIAL`:** Validate sender: `sender.tab` must exist, and the credential's URL domain must match the sender tab's URL domain. Only allow IDs from the per-tab allowlist. Find item by ID, return `{ username, password }`. Require vault unlocked. **Note:** the `handleMessage` function signature must be extended to accept `sender: browser.Runtime.MessageSender` (currently only takes `message`), and the listener in `index.ts` must forward the sender parameter.
- **`CHECK_CREDENTIAL_EXISTS`:** Match by domain + username. Compare submitted password directly against decrypted credential password in memory. Return `{ exists, changed, credentialId }`.
- **`SAVE_CREDENTIAL`:** Delegate to the existing `ADD_ITEM` persistence flow (encrypt item, save to storage, update in-memory state).
- **`UPDATE_CREDENTIAL`:** Delegate to the existing `UPDATE_ITEM` persistence flow.

### 5.3 Badge Logic in Background

Add to `src/background/index.ts`:

```typescript
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await browser.tabs.get(tabId);
  updateBadge(tab);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) updateBadge(tab);
});
```

`updateBadge(tab)` extracts hostname, checks vault status, calls `matchCredentialsByDomain`, and sets badge text/color/icon accordingly. Also called when vault locks/unlocks to update all tabs' badges.

## 6. Domain Matching

Reuse existing `matchCredentialsByDomain()` from `@keykeykey/core` which uses `tldts` for domain parsing. This matches by `domainWithoutSuffix` (e.g., `www.github.com` matches `github.com` matches `login.github.com` — all resolve to `github`).

The content script sends the full `window.location.hostname` to the background. The background does the matching — the content script never has access to the vault or matching logic.

## 7. Testing Strategy

### 7.1 Content Script Unit Tests (Vitest, jsdom)

- Form detector: verify detection of `type="password"`, `autocomplete` attributes, name/id patterns
- MutationObserver: verify dynamically added forms are detected, cleanup on disconnect
- Autofill icon: verify shadow DOM creation, HTTPS-only guard, icon positioning, keyboard accessibility
- Save detector: verify form submission detection, credential extraction, throttled input tracking
- Security: verify no autofill on HTTP, no cross-origin iframe injection

### 7.2 Background Message Tests (Vitest)

- `GET_CREDENTIALS_FOR_TAB` returns correct count
- `GET_MATCHING_CREDENTIALS` returns credentials without passwords
- `FILL_CREDENTIAL` returns username + password only when vault unlocked AND sender domain matches AND ID in allowlist
- `FILL_CREDENTIAL` rejects requests from mismatched domains
- `CHECK_CREDENTIAL_EXISTS` detects new, changed, and unchanged credentials (with password comparison)
- `SAVE_CREDENTIAL` and `UPDATE_CREDENTIAL` modify the vault correctly (delegate to existing handlers)
- Badge logic: verify text/color changes on tab switch and vault lock/unlock
- Vault state push: verify `VAULT_LOCKED`/`VAULT_UNLOCKED`/`VAULT_CHANGED` sent to tabs

### 7.3 E2E Tests (Playwright)

Extends existing extension E2E:

- Load extension, unlock vault, navigate to site with saved credentials → badge shows count
- Click autofill icon in username field → dropdown appears with matching credentials
- Select credential → both fields fill correctly (including React-style forms)
- Submit login form with new credentials → save prompt appears → save → credential in vault
- Submit login form with changed password → update prompt appears
- Navigate to HTTP page → no autofill icon
- Lock vault → badge shows lock icon, autofill icons removed from all tabs
