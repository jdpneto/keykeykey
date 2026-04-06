# Extension Bug Fixes Design

Six browser extension bugs addressing sync, domain matching, badge persistence, autofill icon reliability, popup filtering, and quick-fill from the popup.

## Bug 1: Auto-sync after item mutations

**Problem:** Adding, updating, or deleting items in the extension does not trigger a sync to the configured cloud provider. The user must manually click the Sync button.

**Fix:** In `apps/extension/src/background/index.ts`, after the existing mutation detection block (lines 38-49) that sends `VAULT_CHANGED` to content scripts, also fire a background sync. This is fire-and-forget — the response to the popup is not blocked.

**Mutation types that trigger auto-sync:** `ADD_ITEM`, `UPDATE_ITEM`, `DELETE_ITEM`, `SAVE_CREDENTIAL`, `UPDATE_CREDENTIAL`.

```ts
// After notifyContentScripts({ type: 'VAULT_CHANGED' }):
const lc = getLifecycle();
if (lc) {
  lc.triggerSync().then((result) => {
    if (result.lastSynced) { setLastSynced(result.lastSynced); setSyncError(null); }
    if (result.error) { setSyncError(result.error); }
  }).catch(() => {});
}
```

**Scope:** Single codebase via `webextension-polyfill` — covers both Chrome and Firefox.

---

## Bug 2: Filter popup by current tab's domain

**Problem:** The popup always shows all vault items. When the user is on a login page, it should show matching credentials for that domain first.

**Fix:**

1. **New message type `GET_ITEMS_FOR_HOST`** in `messages.ts`:
   - Input: `{ type: 'GET_ITEMS_FOR_HOST'; hostname: string }`
   - Returns: `{ items: VaultItem[]; matchedIds: string[] }`

2. **Handler in `message-handler.ts`:**
   ```ts
   case 'GET_ITEMS_FOR_HOST': {
     if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
     const all = store.getState().items;
     const matches = matchCredentialsByDomain(message.hostname, all);
     const matchIds = new Set(matches.map(m => m.id));
     return { items: all, matchedIds: Array.from(matchIds) };
   }
   ```

3. **`VaultListScreen.tsx` changes:**
   - On mount, also call `GET_ACTIVE_TAB_URL` to get the current tab URL.
   - If a URL exists, extract hostname and call `GET_ITEMS_FOR_HOST` instead of `GET_ITEMS`.
   - Store `matchedIds` in state.
   - Render a "For this site" section with matched items above the full "All items" list.
   - If no URL or no matches, show the normal flat list.

---

## Bug 3: Badge disappears on page refresh

**Problem:** In `background/index.ts`, the `tabs.onUpdated` listener only fires `refreshBadge` when `changeInfo.url` is set. A same-page refresh does not always set `changeInfo.url`, so the badge number disappears.

**Fix:** Also trigger `refreshBadge` when `changeInfo.status === 'complete'`:

```ts
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    tabAllowlists.delete(tabId);
  }
  if (changeInfo.url || changeInfo.status === 'complete') {
    const hostname = extractHostname(changeInfo.url ?? tab.url);
    await refreshBadge(hostname, tabId);
  }
});
```

---

## Bug 4: Domain matching too strict

**Problem:** `matchCredentialsByDomain()` in `packages/core/src/domain/domain-utils.ts` uses `domainWithoutSuffix` from `tldts` (e.g., `"google"` from `mail.google.com`). This is too loose for security — `mygoogle.com` would also extract `"mygoogle"` and not match, but non-standard TLDs can produce unexpected results.

**Fix:** Use `domain` from `tldts` instead (e.g., `"google.com"` from `mail.google.com`). This is the registrable base domain including TLD — the standard approach for password managers.

```ts
// Line 53: change domainWithoutSuffix to domain
const queryDomain = queryParsed.domain?.toLowerCase();

// Line 68: change domainWithoutSuffix to domain
const itemDomain = itemParsed.domain?.toLowerCase();

// Line 71 stays as-is:
return itemDomain === queryDomain;
```

**Matching examples:**
- `mail.google.com` -> `google.com` matches `accounts.google.com` -> `google.com`
- `notgoogle.com` -> `notgoogle.com` does NOT match `google.com`
- `google.co.uk` -> `google.co.uk` does NOT match `google.com` (different registrable domains)

**Scope:** This changes the core package, affecting all platforms (desktop, mobile, extension). The change is strictly more correct.

---

## Bug 5: Autofill icon not showing reliably

**Problem:** The autofill icon in `content/autofill-icon.ts` uses `offsetParent`-relative positioning which breaks in several scenarios: hidden fields, CSS transforms, scroll offsets, and multi-step login flows where the password field appears later.

**Fix:** Three changes in `content/autofill-icon.ts`:

1. **Fixed positioning:** Use `position: fixed` relative to the viewport instead of `offsetParent`. Append the host to `document.body` instead of the field's offset parent. Calculate position from `field.getBoundingClientRect()` directly.

2. **Reposition on scroll/resize:** Attach throttled `scroll` and `resize` listeners that update the icon position. Clean up listeners in `removeAllAutofillIcons()`.

3. **Defer injection for hidden fields:** In `content/index.ts handleForm()`, check if the target field is visible (`field.offsetWidth > 0 && field.offsetHeight > 0`) before calling `injectAutofillIcon()`. If not visible, use an `IntersectionObserver` to wait until the field becomes visible, then inject.

---

## Bug 6: Fill button in popup list

**Problem:** Clicking an item in the popup navigates to the detail view. There is no quick way to fill credentials into the active tab's login form.

**Fix:**

1. **New content push message `FILL_FROM_POPUP`** in `messages.ts`:
   ```ts
   | { type: 'FILL_FROM_POPUP'; username: string; password: string }
   ```

2. **`ItemCard.tsx`** — add optional `onFill` prop:
   - For credential items, render a small fill button (arrow-into-box icon) to the left of the chevron.
   - `onClick` calls `e.stopPropagation()` (prevents navigation to detail) then calls `onFill()`.

3. **`VaultListScreen.tsx`** — pass `onFill` handler to each credential `ItemCard`:
   - Look up the full item from state by id (passwords are included in `GET_ITEMS` response).
   - Get active tab via `browser.tabs.query({ active: true, currentWindow: true })`.
   - Send `FILL_FROM_POPUP` message to the active tab's content script via `browser.tabs.sendMessage()`.
   - Close popup via `window.close()`.

4. **`content/index.ts`** — handle `FILL_FROM_POPUP` in the message listener:
   - Call `detectLoginForms()` to find forms on the page.
   - If a form is found, call `fillCredential(form, username, password)`.

---

## Files Changed Summary

| File | Bugs |
|------|------|
| `packages/core/src/domain/domain-utils.ts` | 4 |
| `apps/extension/src/background/index.ts` | 1, 3 |
| `apps/extension/src/background/message-handler.ts` | 2 |
| `apps/extension/src/lib/messages.ts` | 2, 6 |
| `apps/extension/src/popup/screens/VaultListScreen.tsx` | 2, 6 |
| `apps/extension/src/popup/components/ItemCard.tsx` | 6 |
| `apps/extension/src/content/autofill-icon.ts` | 5 |
| `apps/extension/src/content/index.ts` | 5, 6 |
