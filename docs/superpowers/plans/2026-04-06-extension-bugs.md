# Extension Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 browser extension bugs: auto-sync after mutations, popup tab filtering, badge refresh on page reload, domain matching, autofill icon reliability, and fill button in popup.

**Architecture:** Changes span the core domain-utils (affects all platforms), the extension background worker, content scripts, and popup UI. Each bug is an independent task with its own tests and commit.

**Tech Stack:** TypeScript, Vitest, React, webextension-polyfill, tldts

---

### Task 1: Fix domain matching — use `domain` instead of `domainWithoutSuffix` (Bug 4)

This is done first because other tasks (badge, popup filtering, autofill) depend on `matchCredentialsByDomain()`.

**Files:**
- Modify: `packages/core/src/domain/domain-utils.ts:51-73`
- Modify: `packages/core/src/domain/domain-utils.test.ts:65-161`

- [ ] **Step 1: Update existing tests to reflect new matching behavior**

In `packages/core/src/domain/domain-utils.test.ts`, the existing tests should still pass because `domain` matching is a superset of `domainWithoutSuffix` for standard TLDs. Add new test cases for subdomain matching and cross-TLD non-matching:

```ts
// Add inside the existing describe('matchCredentialsByDomain') block, after the existing tests:

it('should match credentials across different subdomains of the same base domain', () => {
  const googleItems: VaultItem[] = [
    {
      id: 'g1',
      type: 'credential',
      name: 'Google Account',
      username: 'user',
      password: 'pass',
      url: 'https://accounts.google.com',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
  ];
  // mail.google.com should match accounts.google.com (same base domain google.com)
  const matches = matchCredentialsByDomain('mail.google.com', googleItems);
  expect(matches).toHaveLength(1);
  expect(matches[0]!.id).toBe('g1');
});

it('should not match different registrable domains even with similar names', () => {
  const items: VaultItem[] = [
    {
      id: 'g1',
      type: 'credential',
      name: 'Google',
      username: 'user',
      password: 'pass',
      url: 'https://google.com',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
  ];
  // notgoogle.com should NOT match google.com
  const matches = matchCredentialsByDomain('notgoogle.com', items);
  expect(matches).toHaveLength(0);
});

it('should not match across different TLDs', () => {
  const items: VaultItem[] = [
    {
      id: 'g1',
      type: 'credential',
      name: 'Google',
      username: 'user',
      password: 'pass',
      url: 'https://google.com',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
  ];
  // google.co.uk is a different registrable domain than google.com
  const matches = matchCredentialsByDomain('google.co.uk', items);
  expect(matches).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify new tests fail (the subdomain test) and existing pass**

Run: `pnpm --filter @keykeykey/core test -- --run src/domain/domain-utils.test.ts`

The subdomain test ("match credentials across different subdomains") should PASS since the current `domainWithoutSuffix` comparison already handles this case (both extract "google"). The cross-TLD test should also PASS since "google" !== "google" is false... wait, actually `domainWithoutSuffix` for both `google.com` and `google.co.uk` is `"google"`, so the cross-TLD test WILL FAIL with the current code — it would match when it shouldn't.

Expected: The cross-TLD test FAILS (current code matches `google.com` against `google.co.uk` because both have `domainWithoutSuffix: "google"`).

- [ ] **Step 3: Update `matchCredentialsByDomain` to use `domain`**

In `packages/core/src/domain/domain-utils.ts`, change two lines:

```ts
// Line 53: change from domainWithoutSuffix to domain
const queryDomain = queryParsed.domain?.toLowerCase();

// Line 68: change from domainWithoutSuffix to domain
const itemDomain = itemParsed.domain?.toLowerCase();
```

Lines 54 and 69-71 remain unchanged.

- [ ] **Step 4: Run all domain-utils tests**

Run: `pnpm --filter @keykeykey/core test -- --run src/domain/domain-utils.test.ts`

Expected: ALL tests pass, including the new cross-TLD test.

- [ ] **Step 5: Run full core test suite to check for regressions**

Run: `pnpm --filter @keykeykey/core test -- --run`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/domain/domain-utils.ts packages/core/src/domain/domain-utils.test.ts
git commit -m "fix(core): use registrable domain for credential matching

Switch matchCredentialsByDomain from domainWithoutSuffix to domain
(tldts). This prevents false matches across different TLDs (e.g.,
google.com vs google.co.uk) while still matching subdomains correctly."
```

---

### Task 2: Fix badge disappearing on page refresh (Bug 3)

**Files:**
- Modify: `apps/extension/src/background/index.ts:92-100`

- [ ] **Step 1: Update the `tabs.onUpdated` listener**

In `apps/extension/src/background/index.ts`, replace the existing listener (lines 92-100):

```ts
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    // Clear allowlist for tab on URL change
    tabAllowlists.delete(tabId);
  }

  if (changeInfo.url || changeInfo.status === 'complete') {
    const hostname = extractHostname(changeInfo.url ?? tab.url);
    await refreshBadge(hostname, tabId);
  }
});
```

Note: The listener signature now includes the `tab` parameter (third argument) which was not previously used.

- [ ] **Step 2: Run extension tests**

Run: `pnpm --filter @keykeykey/extension test -- --run`

Expected: All existing tests pass. (The `tabs.onUpdated` listener is in the service worker entry point which is not directly unit-tested — it will be verified via E2E.)

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/background/index.ts
git commit -m "fix(extension): refresh badge on page reload, not just URL change

Also trigger refreshBadge when changeInfo.status === 'complete', which
fires on same-page refreshes where changeInfo.url is not set."
```

---

### Task 3: Auto-sync after item mutations (Bug 1)

**Files:**
- Modify: `apps/extension/src/background/index.ts:26-49`

- [ ] **Step 1: Add sync imports and auto-sync logic**

In `apps/extension/src/background/index.ts`, add the sync imports at the top (after the existing imports):

```ts
import {
  getLifecycle,
  setLastSynced,
  setSyncError,
} from './sync.js';
```

Then, inside the `.then(async (result) => { ... })` callback, after the `VAULT_CHANGED` notification block (lines 38-49), add auto-sync:

```ts
      if (
        msg.type === 'ADD_ITEM' ||
        msg.type === 'UPDATE_ITEM' ||
        msg.type === 'DELETE_ITEM' ||
        msg.type === 'SAVE_CREDENTIAL' ||
        msg.type === 'UPDATE_CREDENTIAL'
      ) {
        const r = result as Record<string, unknown>;
        if (!r.error) {
          notifyContentScripts({ type: 'VAULT_CHANGED' });

          // Fire-and-forget background sync
          const lc = getLifecycle();
          if (lc) {
            lc.triggerSync()
              .then((syncResult) => {
                if (syncResult.lastSynced) {
                  setLastSynced(syncResult.lastSynced);
                  setSyncError(null);
                }
                if (syncResult.error) {
                  setSyncError(syncResult.error);
                }
              })
              .catch(() => {});
          }
        }
      }
```

- [ ] **Step 2: Run extension tests**

Run: `pnpm --filter @keykeykey/extension test -- --run`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/background/index.ts
git commit -m "fix(extension): auto-sync to cloud after item mutations

Trigger fire-and-forget sync after ADD_ITEM, UPDATE_ITEM, DELETE_ITEM,
SAVE_CREDENTIAL, and UPDATE_CREDENTIAL. Covers both Chrome and Firefox
via shared webextension-polyfill codebase."
```

---

### Task 4: Add `GET_ITEMS_FOR_HOST` message and popup tab filtering (Bug 2)

**Files:**
- Modify: `apps/extension/src/lib/messages.ts:48-95`
- Modify: `apps/extension/src/background/message-handler.ts:265-268`
- Modify: `apps/extension/src/background/message-handler.test.ts`
- Modify: `apps/extension/src/popup/screens/VaultListScreen.tsx`
- Modify: `apps/extension/src/popup/screens/VaultListScreen.test.tsx`

- [ ] **Step 1: Add message type to `messages.ts`**

In `apps/extension/src/lib/messages.ts`, add to the `BackgroundMessage` union (after the `GET_ITEMS` line):

```ts
  | { type: 'GET_ITEMS_FOR_HOST'; hostname: string }
```

- [ ] **Step 2: Write failing test for `GET_ITEMS_FOR_HOST` handler**

In `apps/extension/src/background/message-handler.test.ts`, add a new describe block:

```ts
describe('GET_ITEMS_FOR_HOST', () => {
  it('returns all items and matched IDs for a given hostname', async () => {
    await send({ type: 'SETUP', password: 'TestPass123!' });

    // Add two credentials — one matching github.com, one for gitlab.com
    await send({
      type: 'ADD_ITEM',
      item: {
        type: 'credential',
        name: 'GitHub',
        username: 'user',
        password: 'pass',
        url: 'https://github.com',
        notes: '',
        tags: [],
        favorite: false,
      },
    });
    await send({
      type: 'ADD_ITEM',
      item: {
        type: 'credential',
        name: 'GitLab',
        username: 'user2',
        password: 'pass2',
        url: 'https://gitlab.com',
        notes: '',
        tags: [],
        favorite: false,
      },
    });

    const result = await send({ type: 'GET_ITEMS_FOR_HOST', hostname: 'github.com' });
    expect(result.items).toHaveLength(2);
    expect(result.matchedIds).toHaveLength(1);
    // The matched ID should be the GitHub credential
    const githubItem = (result.items as Array<{ id: string; name: string }>).find(
      (i) => i.name === 'GitHub',
    );
    expect(result.matchedIds).toContain(githubItem!.id);
  });

  it('returns empty matchedIds when no credentials match hostname', async () => {
    await send({ type: 'SETUP', password: 'TestPass123!' });
    await send({
      type: 'ADD_ITEM',
      item: {
        type: 'credential',
        name: 'GitHub',
        username: 'user',
        password: 'pass',
        url: 'https://github.com',
        notes: '',
        tags: [],
        favorite: false,
      },
    });

    const result = await send({ type: 'GET_ITEMS_FOR_HOST', hostname: 'example.com' });
    expect(result.items).toHaveLength(1);
    expect(result.matchedIds).toHaveLength(0);
  });

  it('returns error when vault is locked', async () => {
    const result = await send({ type: 'GET_ITEMS_FOR_HOST', hostname: 'github.com' });
    expect(result.error).toBe('Vault is locked');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/extension test -- --run src/background/message-handler.test.ts`

Expected: FAIL — `GET_ITEMS_FOR_HOST` is not handled, returns `Unknown message type`.

- [ ] **Step 4: Add handler in `message-handler.ts`**

In `apps/extension/src/background/message-handler.ts`, add after the `GET_ITEMS` case (line 268):

```ts
      case 'GET_ITEMS_FOR_HOST': {
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
        const all = store.getState().items;
        const matches = matchCredentialsByDomain(message.hostname, all);
        const matchIds = matches.map((m) => m.id);
        return { items: all, matchedIds: matchIds };
      }
```

- [ ] **Step 5: Run message-handler tests**

Run: `pnpm --filter @keykeykey/extension test -- --run src/background/message-handler.test.ts`

Expected: ALL tests pass.

- [ ] **Step 6: Update `VaultListScreen.tsx` to show "For this site" section**

Replace the `useEffect` on mount in `apps/extension/src/popup/screens/VaultListScreen.tsx` (lines 61-77) with:

```tsx
  const [matchedIds, setMatchedIds] = useState<Set<string>>(new Set());

  // Load items and sync status on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Get active tab URL first
        const tabResult = (await sendMessage<{ url?: string | null }>({
          type: 'GET_ACTIVE_TAB_URL',
        })) as { url?: string | null };

        let hostname: string | null = null;
        if (tabResult.url) {
          try {
            hostname = new URL(tabResult.url).hostname;
          } catch {
            // ignore invalid URLs
          }
        }

        const [itemsResult, syncResult] = await Promise.all([
          hostname
            ? sendMessage<{ items?: VaultItem[]; matchedIds?: string[] }>({
                type: 'GET_ITEMS_FOR_HOST',
                hostname,
              })
            : sendMessage<{ items?: VaultItem[] }>({ type: 'GET_ITEMS' }),
          sendMessage<{ provider?: string }>({ type: 'GET_SYNC_STATUS' }),
        ]);

        const r = itemsResult as { items?: VaultItem[]; matchedIds?: string[] };
        setItems(r.items ?? []);
        setMatchedIds(new Set(r.matchedIds ?? []));
        const provider = (syncResult as { provider?: string }).provider;
        setSyncConnected(!!provider && provider !== 'none');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);
```

Then update the item list rendering section (inside the `<div>` with `flex: 1, overflowY: 'auto'`). Replace the `filteredItems.map(...)` block:

```tsx
          <>
            {/* "For this site" section */}
            {matchedIds.size > 0 && filter === 'all' && !query && (
              <>
                <div
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    fontWeight: theme.typography.weights.semibold,
                    color: theme.colors.textSecondary,
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.05em',
                    paddingTop: theme.spacing.xs,
                  }}
                >
                  For this site
                </div>
                {filteredItems
                  .filter((item) => matchedIds.has(item.id))
                  .map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onClick={() => onNavigate(`detail:${item.id}`)}
                    />
                  ))}
                <div
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    fontWeight: theme.typography.weights.semibold,
                    color: theme.colors.textSecondary,
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.05em',
                    paddingTop: theme.spacing.sm,
                  }}
                >
                  All items
                </div>
              </>
            )}
            {filteredItems
              .filter((item) => !query && matchedIds.size > 0 && filter === 'all' ? !matchedIds.has(item.id) : true)
              .map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onClick={() => onNavigate(`detail:${item.id}`)}
                />
              ))}
          </>
```

- [ ] **Step 7: Update `VaultListScreen.test.tsx`**

Add a test for the "For this site" section:

```tsx
it('shows "For this site" section when active tab has matching credentials', async () => {
  mockSendMessage.mockImplementation(async (msg: { type: string }) => {
    if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: 'https://github.com/login' };
    if (msg.type === 'GET_ITEMS_FOR_HOST')
      return {
        items: sampleItems,
        matchedIds: [sampleItems[0]!.id],
      };
    if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
    return { items: sampleItems };
  });
  renderVaultList();

  await waitFor(() => {
    expect(screen.getByText('For this site')).toBeInTheDocument();
    expect(screen.getByText('All items')).toBeInTheDocument();
  });
});

it('does not show "For this site" when no tab URL', async () => {
  mockSendMessage.mockImplementation(async (msg: { type: string }) => {
    if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
    if (msg.type === 'GET_ITEMS') return { items: sampleItems };
    if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
    return { items: sampleItems };
  });
  renderVaultList();

  await waitFor(() => {
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  expect(screen.queryByText('For this site')).not.toBeInTheDocument();
});
```

- [ ] **Step 8: Run VaultListScreen tests**

Run: `pnpm --filter @keykeykey/extension test -- --run src/popup/screens/VaultListScreen.test.tsx`

Expected: ALL tests pass. Note: Existing tests that mock `sendMessage` to return `{ items: [...] }` will need updating since the mount effect now also calls `GET_ACTIVE_TAB_URL`. Update existing `beforeEach` or individual `mockSendMessage` setups to handle the new message:

```ts
// Update existing tests' mockSendMessage to handle GET_ACTIVE_TAB_URL
mockSendMessage.mockImplementation(async (msg: { type: string }) => {
  if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
  if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
  return { items: sampleItems }; // or [] depending on the test
});
```

- [ ] **Step 9: Run all extension tests**

Run: `pnpm --filter @keykeykey/extension test -- --run`

Expected: All pass.

- [ ] **Step 10: Commit**

```bash
git add apps/extension/src/lib/messages.ts apps/extension/src/background/message-handler.ts apps/extension/src/background/message-handler.test.ts apps/extension/src/popup/screens/VaultListScreen.tsx apps/extension/src/popup/screens/VaultListScreen.test.tsx
git commit -m "feat(extension): filter popup by active tab domain

Add GET_ITEMS_FOR_HOST message type. Popup now shows 'For this site'
section with matching credentials above the full item list."
```

---

### Task 5: Fix autofill icon reliability (Bug 5)

**Files:**
- Modify: `apps/extension/src/content/autofill-icon.ts:34-205`
- Modify: `apps/extension/src/content/autofill-icon.test.ts`
- Modify: `apps/extension/src/content/index.ts:16-47`

- [ ] **Step 1: Update `injectAutofillIcon` to use fixed positioning and reposition on scroll**

Replace the positioning logic and add scroll/resize listeners in `apps/extension/src/content/autofill-icon.ts`. Replace from line 34 (`export function injectAutofillIcon`) to the end of the function:

```ts
// Module-level cleanup tracking for scroll/resize listeners
const cleanupFns: (() => void)[] = [];

export function injectAutofillIcon(
  field: HTMLInputElement,
  onGetCredentials: () => Promise<Credential[]>,
  onSelectCredential: (id: string) => Promise<void>,
): void {
  const host = document.createElement('div');
  host.className = AUTOFILL_HOST_CLASS;
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';

  const shadow = host.attachShadow({ mode: 'closed' });

  // Styles
  const style = document.createElement('style');
  style.textContent = [
    ':host { font-family: system-ui, sans-serif; font-size: 14px; }',
    '.icon { width: 24px; height: 24px; cursor: pointer; display: flex;',
    '  align-items: center; justify-content: center; border-radius: 4px;',
    '  background: #f0f0f0; border: 1px solid #ccc; user-select: none; }',
    '.icon:hover { background: #e0e0e0; }',
    '.dropdown { position: absolute; top: 28px; left: 0; min-width: 200px;',
    '  background: white; border: 1px solid #ccc; border-radius: 6px;',
    '  box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none;',
    '  max-height: 200px; overflow-y: auto; }',
    '.dropdown.open { display: block; }',
    '.item { padding: 8px 12px; cursor: pointer; outline: none; }',
    '.item:hover, .item.active { background: #e8f0fe; }',
    '.item-name { font-weight: 500; }',
    '.item-username { font-size: 12px; color: #666; }',
    '.empty { padding: 8px 12px; color: #999; }',
  ].join('\n');
  shadow.appendChild(style);

  // Icon button
  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.setAttribute('role', 'button');
  icon.setAttribute('aria-label', 'Autofill credentials');
  icon.setAttribute('tabindex', '0');
  icon.textContent = '\uD83D\uDD11';
  shadow.appendChild(icon);

  // Dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'dropdown';
  dropdown.setAttribute('role', 'listbox');
  dropdown.setAttribute('aria-label', 'Credential list');
  shadow.appendChild(dropdown);

  let activeIndex = -1;
  let items: HTMLElement[] = [];

  function setActiveItem(index: number): void {
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add('active');
        item.setAttribute('aria-selected', 'true');
      } else {
        item.classList.remove('active');
        item.removeAttribute('aria-selected');
      }
    });
    activeIndex = index;
  }

  function closeDropdown(): void {
    dropdown.classList.remove('open');
    activeIndex = -1;
    items = [];
  }

  async function openDropdown(): Promise<void> {
    while (dropdown.firstChild) {
      dropdown.removeChild(dropdown.firstChild);
    }

    const credentials = await onGetCredentials();
    items = [];
    activeIndex = -1;

    if (credentials.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No credentials found';
      dropdown.appendChild(empty);
    } else {
      for (const cred of credentials) {
        const item = document.createElement('div');
        item.className = 'item';
        item.setAttribute('role', 'option');
        item.setAttribute('tabindex', '-1');

        const nameEl = document.createElement('div');
        nameEl.className = 'item-name';
        nameEl.textContent = cred.name;
        item.appendChild(nameEl);

        const usernameEl = document.createElement('div');
        usernameEl.className = 'item-username';
        usernameEl.textContent = cred.username;
        item.appendChild(usernameEl);

        item.addEventListener('click', (e: Event) => {
          if (!e.isTrusted) return;
          onSelectCredential(cred.id);
          closeDropdown();
        });

        dropdown.appendChild(item);
        items.push(item);
      }
    }

    dropdown.classList.add('open');
  }

  icon.addEventListener('click', (e: Event) => {
    if (!e.isTrusted) return;
    if (dropdown.classList.contains('open')) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  icon.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (dropdown.classList.contains('open')) {
        closeDropdown();
      } else {
        openDropdown();
      }
    }
  });

  shadow.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (!dropdown.classList.contains('open')) return;

    if (ke.key === 'ArrowDown') {
      ke.preventDefault();
      const next = activeIndex < items.length - 1 ? activeIndex + 1 : 0;
      setActiveItem(next);
    } else if (ke.key === 'ArrowUp') {
      ke.preventDefault();
      const prev = activeIndex > 0 ? activeIndex - 1 : items.length - 1;
      setActiveItem(prev);
    } else if (ke.key === 'Enter' && activeIndex >= 0) {
      ke.preventDefault();
      items[activeIndex].click();
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      closeDropdown();
    }
  });

  // Position using fixed coordinates from getBoundingClientRect
  function updatePosition(): void {
    const rect = field.getBoundingClientRect();
    // Hide if field is not visible
    if (rect.width === 0 && rect.height === 0) {
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    host.style.left = `${rect.right - 28}px`;
    host.style.top = `${rect.top + (rect.height - 24) / 2}px`;
  }

  document.body.appendChild(host);
  updatePosition();

  // Throttled reposition on scroll/resize
  let ticking = false;
  const onScrollOrResize = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        updatePosition();
        ticking = false;
      });
    }
  };

  window.addEventListener('scroll', onScrollOrResize, true); // capture phase for inner scrolls
  window.addEventListener('resize', onScrollOrResize);

  cleanupFns.push(() => {
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize);
  });
}
```

- [ ] **Step 2: Update `removeAllAutofillIcons` to clean up listeners**

In the same file, update the `removeAllAutofillIcons` function:

```ts
export function removeAllAutofillIcons(): void {
  const hosts = document.querySelectorAll(`.${AUTOFILL_HOST_CLASS}`);
  hosts.forEach((host) => host.remove());
  // Clean up scroll/resize listeners
  for (const cleanup of cleanupFns) {
    cleanup();
  }
  cleanupFns.length = 0;
}
```

- [ ] **Step 3: Add deferred injection for hidden fields in `content/index.ts`**

In `apps/extension/src/content/index.ts`, update the `handleForm` function. Replace lines 17-47 (the hostname declaration through the end of the `injectAutofillIcon` call):

```ts
function handleForm(form: LoginForm): void {
  const hostname = window.location.hostname;

  // Ask background how many credentials match this tab's hostname.
  browser.runtime
    .sendMessage({ type: 'GET_CREDENTIALS_FOR_TAB', hostname })
    .then((response: unknown) => {
      const res = response as { count?: number; error?: string };
      if (res.error || !res.count || res.count === 0) return;

      const targetField = form.usernameField ?? form.passwordField;
      if (!targetField) return;

      const doInject = () => {
        injectAutofillIcon(
          targetField,
          async () => {
            const credRes = (await browser.runtime.sendMessage({
              type: 'GET_MATCHING_CREDENTIALS',
              hostname,
            })) as { credentials?: { id: string; name: string; username: string }[]; error?: string };
            return credRes.credentials ?? [];
          },
          async (id: string) => {
            const fillRes = (await browser.runtime.sendMessage({
              type: 'FILL_CREDENTIAL',
              id,
            })) as { username?: string; password?: string; error?: string };
            if (fillRes.error || !fillRes.username || !fillRes.password) return;
            fillCredential(form, fillRes.username, fillRes.password);
          },
        );
      };

      // Defer injection if field is not visible (e.g., multi-step login)
      if (targetField.offsetWidth > 0 && targetField.offsetHeight > 0) {
        doInject();
      } else {
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                observer.disconnect();
                doInject();
                break;
              }
            }
          },
          { threshold: 0.1 },
        );
        observer.observe(targetField);
      }
    });
```

The rest of the function (submission watching) stays unchanged.

- [ ] **Step 4: Update autofill-icon tests for fixed positioning**

In `apps/extension/src/content/autofill-icon.test.ts`, update the test that checks positioning. The existing test "creates a shadow DOM host element near the field" should still pass since it just checks for the host element's existence. Add a test for the fixed positioning:

```ts
it('uses fixed positioning and appends to document.body', () => {
  const field = document.createElement('input');
  field.type = 'password';
  document.body.appendChild(field);

  injectAutofillIcon(field, vi.fn().mockResolvedValue([]), vi.fn());

  const host = document.querySelector('.keykeykey-autofill-host') as HTMLElement;
  expect(host).not.toBeNull();
  expect(host.style.position).toBe('fixed');
  expect(host.parentElement).toBe(document.body);
});
```

- [ ] **Step 5: Run autofill-icon tests**

Run: `pnpm --filter @keykeykey/extension test -- --run src/content/autofill-icon.test.ts`

Expected: All tests pass.

- [ ] **Step 6: Run all extension tests**

Run: `pnpm --filter @keykeykey/extension test -- --run`

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/content/autofill-icon.ts apps/extension/src/content/autofill-icon.test.ts apps/extension/src/content/index.ts
git commit -m "fix(extension): improve autofill icon positioning and visibility

Use fixed positioning instead of offsetParent-relative. Reposition on
scroll/resize. Defer injection for hidden fields using
IntersectionObserver (handles multi-step login flows)."
```

---

### Task 6: Add fill button to popup (Bug 6)

**Files:**
- Modify: `apps/extension/src/lib/messages.ts`
- Modify: `apps/extension/src/popup/components/ItemCard.tsx`
- Modify: `apps/extension/src/popup/screens/VaultListScreen.tsx`
- Modify: `apps/extension/src/popup/screens/VaultListScreen.test.tsx`
- Modify: `apps/extension/src/content/index.ts`

- [ ] **Step 1: Add `FILL_FROM_POPUP` to content push messages**

In `apps/extension/src/lib/messages.ts`, update the `ContentPushMessage` type:

```ts
export type ContentPushMessage =
  | { type: 'VAULT_LOCKED' }
  | { type: 'VAULT_UNLOCKED' }
  | { type: 'VAULT_CHANGED' }
  | { type: 'FILL_FROM_POPUP'; username: string; password: string };
```

- [ ] **Step 2: Add `onFill` prop to `ItemCard`**

In `apps/extension/src/popup/components/ItemCard.tsx`, update the component:

```tsx
import React from 'react';
import { useTheme } from '../../lib/theme.js';
import type { VaultItem } from '@keykeykey/core';

interface ItemCardProps {
  item: VaultItem;
  onClick: () => void;
  onFill?: () => void;
}

export function ItemCard({ item, onClick, onFill }: ItemCardProps) {
  const { theme } = useTheme();
  const initial = item.name.charAt(0).toUpperCase();
  const subtitle =
    item.type === 'credential'
      ? item.username
      : item.type === 'card'
        ? '•••• ' + (item.number?.slice(-4) ?? '')
        : 'Note';

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        background: theme.colors.surface,
        borderRadius: theme.radii.md,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: theme.radii.sm,
          background: theme.colors.primaryMuted,
          color: theme.colors.primary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: theme.typography.weights.semibold,
          fontSize: theme.typography.sizes.sm,
        }}
      >
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.medium,
            color: theme.colors.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </div>
        <div
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {subtitle}
        </div>
      </div>
      {item.favorite && <span style={{ color: theme.colors.primary, fontSize: 14 }}>&#9733;</span>}
      {onFill && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFill();
          }}
          aria-label="Fill credentials"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            borderRadius: theme.radii.sm,
            color: theme.colors.primary,
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          &#8626;
        </button>
      )}
      <span style={{ color: theme.colors.textSecondary, fontSize: 14 }}>&#8250;</span>
    </div>
  );
}
```

- [ ] **Step 3: Add fill handler in `VaultListScreen.tsx`**

In `apps/extension/src/popup/screens/VaultListScreen.tsx`, add the import for browser at the top:

```ts
import browser from 'webextension-polyfill';
```

Add the fill handler function inside the component, after the `handleLock` function:

```ts
  const handleFill = useCallback(
    async (itemId: string) => {
      const item = items.find((i) => i.id === itemId);
      if (!item || item.type !== 'credential') return;

      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      await browser.tabs.sendMessage(tabId, {
        type: 'FILL_FROM_POPUP',
        username: item.username,
        password: item.password,
      });
      window.close();
    },
    [items],
  );
```

Update the `ItemCard` usage in the render to pass `onFill` for credential items. In both the "For this site" section and the "All items" section, update the `ItemCard` rendering:

```tsx
<ItemCard
  key={item.id}
  item={item}
  onClick={() => onNavigate(`detail:${item.id}`)}
  onFill={item.type === 'credential' ? () => handleFill(item.id) : undefined}
/>
```

- [ ] **Step 4: Handle `FILL_FROM_POPUP` in content script**

In `apps/extension/src/content/index.ts`, update the message listener to handle the new message. In the `browser.runtime.onMessage.addListener` callback (around line 144):

```ts
  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as ContentPushMessage;
    switch (msg.type) {
      case 'VAULT_LOCKED':
        teardown();
        break;
      case 'VAULT_UNLOCKED':
      case 'VAULT_CHANGED':
        scanAndHandle();
        break;
      case 'FILL_FROM_POPUP': {
        const forms = detectLoginForms();
        if (forms.length > 0) {
          fillCredential(forms[0]!, msg.username, msg.password);
        }
        break;
      }
    }
  });
```

- [ ] **Step 5: Add test for fill button in VaultListScreen**

In `apps/extension/src/popup/screens/VaultListScreen.test.tsx`, add:

```tsx
it('renders fill button for credential items', async () => {
  mockSendMessage.mockImplementation(async (msg: { type: string }) => {
    if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
    if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
    return { items: sampleItems };
  });
  renderVaultList();

  await waitFor(() => {
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  const fillButtons = screen.getAllByLabelText('Fill credentials');
  // Both sample items are credentials, so both should have fill buttons
  expect(fillButtons).toHaveLength(2);
});
```

- [ ] **Step 6: Run VaultListScreen tests**

Run: `pnpm --filter @keykeykey/extension test -- --run src/popup/screens/VaultListScreen.test.tsx`

Expected: All tests pass.

- [ ] **Step 7: Run all extension tests**

Run: `pnpm --filter @keykeykey/extension test -- --run`

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add apps/extension/src/lib/messages.ts apps/extension/src/popup/components/ItemCard.tsx apps/extension/src/popup/screens/VaultListScreen.tsx apps/extension/src/popup/screens/VaultListScreen.test.tsx apps/extension/src/content/index.ts
git commit -m "feat(extension): add fill button to popup item list

Credential items now show a fill button that sends credentials to the
active tab's content script and closes the popup. Content script
handles FILL_FROM_POPUP by detecting login forms and filling them."
```

---

### Task 7: Final verification

- [ ] **Step 1: Build all packages**

Run: `pnpm build`

Expected: Clean build with no errors.

- [ ] **Step 2: Run all tests across the monorepo**

Run: `pnpm test`

Expected: All tests pass.

- [ ] **Step 3: Run linter**

Run: `pnpm lint`

Expected: No lint errors.

- [ ] **Step 4: Run critical E2E tests**

Run: `cd e2e && npx playwright test --grep @critical`

Expected: Critical E2E tests pass.
