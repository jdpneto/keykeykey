# Browser Extension Autofill — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add autofill functionality to the browser extension: form detection, credential fill via icon-in-field, badge with match count, and save/update prompt on form submission.

**Architecture:** Content script detects login forms and injects autofill UI (shadow DOM). Background worker handles 6 new message types for credential matching/filling/saving, updates badge on tab changes, and pushes vault state to content scripts. All credential data flows on-demand through the existing `browser.runtime.sendMessage` channel — credentials never persist in content script scope.

**Tech Stack:** TypeScript, webextension-polyfill, Vitest (jsdom), shadow DOM, MutationObserver, CRXJS Vite plugin

**Spec:** `docs/superpowers/specs/2026-03-15-extension-autofill-design.md`

---

## File Structure

### New Files

- `apps/extension/src/content/form-detector.ts` — Scans DOM for login forms, MutationObserver for SPAs
- `apps/extension/src/content/form-detector.test.ts` — Tests for form detection
- `apps/extension/src/content/autofill-icon.ts` — Shadow DOM icon injection and credential dropdown
- `apps/extension/src/content/autofill-icon.test.ts` — Tests for icon injection
- `apps/extension/src/content/save-detector.ts` — Form submission detection and save/update prompt
- `apps/extension/src/content/save-detector.test.ts` — Tests for save detection
- `apps/extension/src/background/badge.ts` — Badge update logic
- `apps/extension/src/background/badge.test.ts` — Tests for badge

### Modified Files

- `apps/extension/src/content/index.ts` — Replace placeholder with coordinator
- `apps/extension/src/lib/messages.ts` — Add 6 new message types + 3 push message types
- `apps/extension/src/background/message-handler.ts` — Handle new messages, accept `sender` param
- `apps/extension/src/background/index.ts` — Forward `sender` to handler, add tab listeners, push vault state
- `apps/extension/manifest.json` — Add `tabs` permission and `content_scripts` declaration

---

## Chunk 1: Message Protocol and Badge

### Task 1: Add new message types

**Files:**

- Modify: `apps/extension/src/lib/messages.ts`

- [ ] **Step 1: Read the existing messages.ts to understand the BackgroundMessage union type structure**

- [ ] **Step 2: Add 6 new request message types to the BackgroundMessage union**

Follow the existing pattern. Add:

- `GET_CREDENTIALS_FOR_TAB` with `hostname: string`
- `GET_MATCHING_CREDENTIALS` with `hostname: string`
- `FILL_CREDENTIAL` with `id: string`
- `CHECK_CREDENTIAL_EXISTS` with `hostname: string; username: string; password: string`
- `SAVE_CREDENTIAL` with `url: string; username: string; password: string; name: string`
- `UPDATE_CREDENTIAL` with `credentialId: string; password: string`

- [ ] **Step 3: Add ContentPushMessage type for background-to-content messages**

```typescript
export type ContentPushMessage =
  | { type: 'VAULT_LOCKED' }
  | { type: 'VAULT_UNLOCKED' }
  | { type: 'VAULT_CHANGED' };
```

- [ ] **Step 4: Run tests to verify no breaking changes**

Run: `pnpm --filter @keykeykey/extension test -- --run`

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/lib/messages.ts
git commit -m "feat(extension): add autofill message types to extension protocol"
```

---

### Task 2: Add badge logic

**Files:**

- Create: `apps/extension/src/background/badge.ts`
- Create: `apps/extension/src/background/badge.test.ts`
- Modify: `apps/extension/src/background/index.ts`
- Modify: `apps/extension/manifest.json`

- [ ] **Step 1: Write badge tests**

Test three states: locked (setIcon to locked variant), unlocked with matches (green badge with count), unlocked without matches (clear badge). Mock `browser.action.*` via webextension-polyfill mock.

- [ ] **Step 2: Implement badge.ts**

`updateBadge(hostname, vaultStatus, items, tabId?)`:

- Locked: `setIcon` with gray locked icon paths, clear badge text
- Unlocked: restore normal icon, call `matchCredentialsByDomain(hostname, items)`, set badge text to count with green background, or clear if no matches

- [ ] **Step 3: Add tabs permission and content_scripts to manifest.json**

Add `"tabs"` to permissions. Add content_scripts array with `matches: ["https://*/*", "http://localhost/*"]`, `js: ["src/content/index.ts"]`, `run_at: "document_idle"`.

- [ ] **Step 4: Wire badge into background index.ts**

Add `browser.tabs.onActivated` and `browser.tabs.onUpdated` listeners that call `updateBadge()`. Import store state for status and items.

- [ ] **Step 5: Run tests, commit**

```bash
git add apps/extension/src/background/badge.ts apps/extension/src/background/badge.test.ts apps/extension/src/background/index.ts apps/extension/manifest.json
git commit -m "feat(extension): add badge with credential match count and locked icon"
```

---

### Task 3: Add message handlers and extend handler to accept sender

**Files:**

- Modify: `apps/extension/src/background/message-handler.ts`
- Modify: `apps/extension/src/background/index.ts`

- [ ] **Step 1: Extend handleMessage signature to accept sender**

Change the listener in `index.ts` to forward `sender` to the handler. Update `handleMessage` signature to accept `sender?: browser.Runtime.MessageSender`.

- [ ] **Step 2: Add per-tab fillable allowlist**

`const tabAllowlists = new Map<number, Set<string>>();` at module scope. Export it for clearing from `index.ts` on tab navigation.

- [ ] **Step 3: Add 6 new case handlers**

- `GET_CREDENTIALS_FOR_TAB`: call `matchCredentialsByDomain`, return count
- `GET_MATCHING_CREDENTIALS`: return `[{id, name, username}]` (no passwords), populate tab allowlist
- `FILL_CREDENTIAL`: validate sender.tab exists, check domain match between sender URL and credential URL, check ID in allowlist, return `{username, password}`
- `CHECK_CREDENTIAL_EXISTS`: match by domain+username, compare password directly in memory, return `{exists, changed, credentialId}`
- `SAVE_CREDENTIAL`: delegate to existing addItem + persistence logic, notify content scripts
- `UPDATE_CREDENTIAL`: delegate to existing updateItem + persistence logic, notify content scripts

- [ ] **Step 4: Add notifyContentScripts helper and vault state push**

Send `VAULT_LOCKED` on lock, `VAULT_UNLOCKED` on unlock, `VAULT_CHANGED` on add/update/delete. Clear all tabAllowlists on lock.

- [ ] **Step 5: Clear tab allowlist on navigation**

Add `browser.tabs.onUpdated` listener that clears allowlist for tab on URL change.

- [ ] **Step 6: Run tests, commit**

```bash
git add apps/extension/src/background/message-handler.ts apps/extension/src/background/index.ts
git commit -m "feat(extension): add autofill message handlers with sender validation and allowlist"
```

---

## Chunk 2: Content Script

### Task 4: Form detector

**Files:**

- Create: `apps/extension/src/content/form-detector.ts`
- Create: `apps/extension/src/content/form-detector.test.ts`

- [ ] **Step 1: Write tests for form detection**

Test: password input detection, autocomplete attribute detection, name/id pattern detection, empty page returns nothing, MutationObserver callback.

- [ ] **Step 2: Implement form-detector.ts**

- `detectLoginForms(root?)`: scans for `type="password"` and `autocomplete="current-password"` inputs, finds associated username fields by autocomplete/name/id/position
- `observeFormChanges(callback)`: MutationObserver with 100ms trailing debounce, returns disconnect function
- Export `LoginForm` interface: `{ usernameField, passwordField, formElement }`

- [ ] **Step 3: Run tests, commit**

```bash
git add apps/extension/src/content/form-detector.ts apps/extension/src/content/form-detector.test.ts
git commit -m "feat(extension): add login form detection with MutationObserver"
```

---

### Task 5: Autofill icon and credential dropdown

**Files:**

- Create: `apps/extension/src/content/autofill-icon.ts`
- Create: `apps/extension/src/content/autofill-icon.test.ts`

- [ ] **Step 1: Write tests**

Test: shadow DOM host created, icon positioned in field, HTTPS guard, cleanup on remove.

- [ ] **Step 2: Implement autofill-icon.ts**

- `injectAutofillIcon(field, onGetCredentials, onSelectCredential)`: creates shadow DOM host, appends icon, handles click to show dropdown
- `showCredentialDropdown(credentials, onSelect)`: renders list in shadow DOM with keyboard nav (arrows, Enter, Escape)
- `fillCredential(form, username, password)`: uses native value setter for React compatibility, dispatches input+change events
- `removeAllAutofillIcons()`: cleanup all shadow DOM containers
- `isSecureContext()`: checks protocol === 'https:' or hostname === 'localhost'
- All DOM creation uses `document.createElement` + `textContent` (never set raw HTML from untrusted sources)
- ARIA attributes: `role="button"`, `aria-label` on icon; `role="listbox"` on dropdown

- [ ] **Step 3: Run tests, commit**

```bash
git add apps/extension/src/content/autofill-icon.ts apps/extension/src/content/autofill-icon.test.ts
git commit -m "feat(extension): add autofill icon injection with shadow DOM dropdown"
```

---

### Task 6: Save detector and save prompt

**Files:**

- Create: `apps/extension/src/content/save-detector.ts`
- Create: `apps/extension/src/content/save-detector.test.ts`

- [ ] **Step 1: Write tests**

Test: submit event triggers callback with extracted credentials, throttled input tracking, save bar injection/removal.

- [ ] **Step 2: Implement save-detector.ts**

- `watchForSubmission(form, onSubmit)`: listens for submit events, extracts username+password from tracked fields, calls callback
- Track password field input events (throttled 500ms) to maintain element references
- `showSaveBar(mode, username, domain, onSave, onDismiss)`: shadow DOM notification bar at top of page
- `removeSaveBar()`: cleanup
- All DOM creation uses safe methods (createElement + textContent, no raw HTML)

- [ ] **Step 3: Run tests, commit**

```bash
git add apps/extension/src/content/save-detector.ts apps/extension/src/content/save-detector.test.ts
git commit -m "feat(extension): add save/update prompt on form submission"
```

---

### Task 7: Wire content script entry point

**Files:**

- Modify: `apps/extension/src/content/index.ts`

- [ ] **Step 1: Replace placeholder with coordinator**

The entry point:

1. Checks secure context (HTTPS or localhost), exits if not
2. Runs initial `detectLoginForms()` scan
3. For each form: queries background for match count, injects icon if matches > 0, watches for submission
4. Sets up `observeFormChanges` for SPA navigation
5. Listens for `VAULT_LOCKED`/`VAULT_UNLOCKED`/`VAULT_CHANGED` push messages via `browser.runtime.onMessage`

- [ ] **Step 2: Run all extension tests**

Run: `pnpm --filter @keykeykey/extension test -- --run`

- [ ] **Step 3: Run lint and format**

Run: `pnpm lint && pnpm format:check`

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/content/index.ts
git commit -m "feat(extension): wire content script with form detection, autofill, and save flow"
```
