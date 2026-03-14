# Browser Extension: Popup + Background + Storage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the browser extension's popup UI, background service worker, and storage layer with full vault management (setup, unlock, CRUD, search, generator, settings), cloud sync integration, PIN unlock, and auto-lock — targeting Chrome, Firefox, and Safari.

**Architecture:** The background service worker owns the Zustand vault store and responds to typed messages from the popup. The popup is stateless — it sends messages via `browser.runtime.sendMessage` and renders the response. Cloud sync uses `@keykeykey/core/sync` (SyncEngine + adapters). All browser APIs accessed via `webextension-polyfill`. Theming uses `@keykeykey/ui` tokens matching the desktop ThemeProvider pattern.

**Tech Stack:** TypeScript, React 19, Vite, Vitest (jsdom), `webextension-polyfill`, `@keykeykey/core` (crypto, models, store, sync, generator), `@keykeykey/ui` (design tokens), `tldts` (domain extraction).

**Spec:** `docs/superpowers/specs/2026-03-14-browser-extension-popup-design.md`

---

## File Structure

### New files in `packages/core/src/`

| File | Responsibility |
|------|---------------|
| `domain/domain-utils.ts` | `extractDomainBrand(url)` and `matchCredentialsByDomain(hostname, items)` |
| `domain/domain-utils.test.ts` | Tests for domain extraction and matching |
| `domain/index.ts` | Re-exports domain utilities |

### New files in `apps/extension/src/`

| File | Responsibility |
|------|---------------|
| `lib/messages.ts` | Message type definitions (BackgroundMessage, responses) |
| `lib/browser-mock.ts` | Test helper: in-memory mock of `browser.storage`, `browser.runtime`, `browser.alarms`, `browser.tabs` |
| `lib/theme.tsx` | ThemeProvider for popup (adapted from desktop pattern) |
| `lib/theme.test.tsx` | Theme provider tests |
| `background/message-handler.ts` | Message dispatcher: routes messages to store/storage/sync |
| `background/message-handler.test.ts` | Tests for each message type |
| `background/storage.ts` | `browser.storage.local` persistence layer (load/save header, items, settings) |
| `background/storage.test.ts` | Storage layer tests |
| `background/auto-lock.ts` | Alarm-based auto-lock logic |
| `background/auto-lock.test.ts` | Auto-lock tests |
| `background/pin.ts` | PIN derivation, DEK wrapping/unwrapping, attempt tracking |
| `background/pin.test.ts` | PIN unlock tests |
| `background/index.ts` | Service worker entry: wires message handler, initializes store |
| `popup/hooks/useMessage.ts` | Hook for sending typed messages to background |
| `popup/hooks/useVaultStatus.ts` | Hook that fetches vault status on mount |
| `popup/screens/SetupScreen.tsx` | Master password creation + "Restore from Cloud" option |
| `popup/screens/SetupScreen.test.tsx` | Setup screen tests |
| `popup/screens/RecoveryKeyScreen.tsx` | Display recovery key with confirmation |
| `popup/screens/UnlockScreen.tsx` | Master password + PIN pad unlock |
| `popup/screens/UnlockScreen.test.tsx` | Unlock screen tests |
| `popup/screens/VaultListScreen.tsx` | Search, filter, item list with copy buttons |
| `popup/screens/VaultListScreen.test.tsx` | List screen tests |
| `popup/screens/CredentialDetailScreen.tsx` | Field display, copy buttons, reveal toggle |
| `popup/screens/AddItemScreen.tsx` | Type picker, form, URL auto-fill from active tab |
| `popup/screens/AddItemScreen.test.tsx` | Add screen tests |
| `popup/screens/EditItemScreen.tsx` | Pre-filled form, save/cancel |
| `popup/screens/GeneratorScreen.tsx` | Password/passphrase generator UI |
| `popup/screens/SettingsScreen.tsx` | Sync config, auto-lock, theme, PIN, lock button |
| `popup/components/ItemCard.tsx` | Credential/card/note list item component |
| `popup/components/PinPad.tsx` | 4-8 digit PIN input pad |
| `popup/components/CopyButton.tsx` | Copy-to-clipboard with feedback |
| `popup/styles/global.css` | Base styles, scrollbar, light/dark CSS variables |
| `popup/Popup.tsx` | Root component: status-based screen router |
| `popup/Popup.test.tsx` | Root component tests |

### Modified files

| File | Changes |
|------|---------|
| `packages/core/src/index.ts` | Add domain module re-exports |
| `packages/core/package.json` | Add `tldts` dependency |
| `packages/core/tsup.config.ts` | Add `domain/index.ts` entry point |
| `apps/extension/package.json` | Add `webextension-polyfill` dependency |
| `apps/extension/manifest.json` | Add `windows` permission, remove content scripts |
| `apps/extension/vite.config.ts` | Remove content script entry (deferred to sub-project #2) |
| `apps/extension/src/popup/main.tsx` | Wrap with ThemeProvider |
| `apps/extension/src/popup/index.html` | Update styles for popup dimensions |
| `apps/extension/src/background/index.ts` | Replace stub with full implementation |

---

## Chunk 1: Domain Utilities in Core

### Task 1: Domain extraction and matching utilities

**Files:**
- Create: `packages/core/src/domain/domain-utils.ts`
- Create: `packages/core/src/domain/domain-utils.test.ts`
- Create: `packages/core/src/domain/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/package.json`
- Modify: `packages/core/tsup.config.ts`

- [ ] **Step 1: Add `tldts` dependency to core**

```bash
cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core add tldts
```

- [ ] **Step 2: Add domain entry point to tsup config and package.json exports**

Modify `packages/core/tsup.config.ts` — add `'src/domain/index.ts'` to the `entry` array.

Modify `packages/core/package.json` — add to the `exports` field (alongside existing subpath entries like `./crypto`, `./models`, etc.):

```json
"./domain": {
  "import": "./dist/domain/index.js",
  "types": "./dist/domain/index.d.ts"
}
```

**Note:** `tldts` adds ~150KB (Public Suffix List). This is acceptable for the core package since domain matching is used across all platforms. Use `tldts` (not `tldts-experimental`) for stability.

- [ ] **Step 3: Write failing tests for domain extraction**

Create `packages/core/src/domain/domain-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractDomainBrand, matchCredentialsByDomain, normalizeUrl } from './domain-utils.js';
import type { VaultItem } from '../models/vault-item.js';

describe('normalizeUrl', () => {
  it('should add https:// to URLs without protocol', () => {
    expect(normalizeUrl('github.com')).toBe('https://github.com');
  });

  it('should leave URLs with protocol unchanged', () => {
    expect(normalizeUrl('https://github.com')).toBe('https://github.com');
    expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('should return empty string for empty input', () => {
    expect(normalizeUrl('')).toBe('');
  });
});

describe('extractDomainBrand', () => {
  it('should extract brand from simple URL', () => {
    expect(extractDomainBrand('https://github.com')).toBe('github');
  });

  it('should strip common subdomains', () => {
    expect(extractDomainBrand('https://login.github.com/oauth')).toBe('github');
    expect(extractDomainBrand('https://www.google.com')).toBe('google');
    expect(extractDomainBrand('https://accounts.google.com')).toBe('google');
    expect(extractDomainBrand('https://app.slack.com')).toBe('slack');
    expect(extractDomainBrand('https://mail.yahoo.com')).toBe('yahoo');
  });

  it('should handle multi-level TLDs', () => {
    expect(extractDomainBrand('https://www.bbc.co.uk')).toBe('bbc');
    expect(extractDomainBrand('https://login.empresa.com.br')).toBe('empresa');
  });

  it('should handle URLs with paths and query strings', () => {
    expect(extractDomainBrand('https://github.com/user/repo?tab=code')).toBe('github');
  });

  it('should handle URLs without protocol', () => {
    expect(extractDomainBrand('github.com')).toBe('github');
  });

  it('should return hostname for IP addresses', () => {
    expect(extractDomainBrand('http://192.168.1.1:8080')).toBe('192.168.1.1');
  });

  it('should handle localhost', () => {
    expect(extractDomainBrand('http://localhost:3000')).toBe('localhost');
  });

  it('should return empty string for invalid input', () => {
    expect(extractDomainBrand('')).toBe('');
  });
});

describe('matchCredentialsByDomain', () => {
  const items: VaultItem[] = [
    {
      id: '1', type: 'credential', name: 'GitHub', username: 'user',
      password: 'pass', url: 'https://github.com', tags: [], favorite: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '2', type: 'credential', name: 'Google', username: 'user',
      password: 'pass', url: 'https://accounts.google.com', tags: [], favorite: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '3', type: 'secure-note', name: 'Note', content: 'secret',
      tags: [], favorite: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as VaultItem,
  ];

  it('should match credentials by domain contains', () => {
    const matches = matchCredentialsByDomain('login.github.com', items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('1');
  });

  it('should match when stored URL domain contains query hostname', () => {
    const matches = matchCredentialsByDomain('google.com', items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('2');
  });

  it('should return empty array when no matches', () => {
    const matches = matchCredentialsByDomain('netflix.com', items);
    expect(matches).toHaveLength(0);
  });

  it('should only match credential type items', () => {
    const matches = matchCredentialsByDomain('note.com', items);
    expect(matches).toHaveLength(0);
  });

  it('should handle credentials without URL', () => {
    const noUrl = [{
      id: '4', type: 'credential', name: 'NoURL', username: 'u',
      password: 'p', tags: [], favorite: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as VaultItem];
    const matches = matchCredentialsByDomain('example.com', noUrl);
    expect(matches).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd /Users/davidneto/keykeykey/packages/core && npx vitest run src/domain/domain-utils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement domain utilities**

Create `packages/core/src/domain/domain-utils.ts`:

```typescript
import { parse } from 'tldts';
import type { VaultItem } from '../models/vault-item.js';

const KNOWN_SUBDOMAINS = new Set([
  'www', 'login', 'auth', 'accounts', 'app', 'm', 'mail',
  'signin', 'sso', 'id', 'my', 'secure', 'portal',
]);

/**
 * Extract the "brand" name from a URL for use as a credential name.
 *
 * Examples:
 * - `https://login.github.com/oauth` → `github`
 * - `https://www.bbc.co.uk` → `bbc`
 * - `http://localhost:3000` → `localhost`
 */
/**
 * Normalize a URL by ensuring it has a protocol.
 * Used before saving to vault (Zod's z.string().url() requires protocol).
 */
export function normalizeUrl(url: string): string {
  if (!url) return url;
  if (!url.includes('://')) return `https://${url}`;
  return url;
}

export function extractDomainBrand(url: string): string {
  if (!url) return '';

  const normalized = normalizeUrl(url);

  let hostname: string;
  try {
    hostname = new URL(normalized).hostname;
  } catch {
    return '';
  }

  // Handle IP addresses and localhost
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname === 'localhost') {
    return hostname;
  }

  const parsed = parse(hostname);
  if (!parsed.domain) return hostname;

  // parsed.domain = "github.com", parsed.domainWithoutSuffix = "github"
  return parsed.domainWithoutSuffix ?? hostname;
}

/**
 * Find credentials whose stored URL domain matches the given hostname.
 *
 * Uses contains-based matching: if the stored credential's domain contains
 * the query's base domain (or vice versa), it's a match.
 *
 * Only matches `credential` type items that have a `url` field.
 */
export function matchCredentialsByDomain(
  hostname: string,
  items: VaultItem[],
): VaultItem[] {
  const queryParsed = parse(hostname);
  const queryDomain = queryParsed.domainWithoutSuffix?.toLowerCase();
  if (!queryDomain) return [];

  return items.filter((item) => {
    if (item.type !== 'credential' || !item.url) return false;

    let itemHostname: string;
    try {
      const normalized = item.url.includes('://') ? item.url : `https://${item.url}`;
      itemHostname = new URL(normalized).hostname;
    } catch {
      return false;
    }

    const itemParsed = parse(itemHostname);
    const itemDomain = itemParsed.domainWithoutSuffix?.toLowerCase();
    if (!itemDomain) return false;

    // Contains-based matching in both directions
    return itemDomain.includes(queryDomain) || queryDomain.includes(itemDomain);
  });
}
```

- [ ] **Step 6: Create index.ts for domain module**

Create `packages/core/src/domain/index.ts`:

```typescript
export { extractDomainBrand, matchCredentialsByDomain, normalizeUrl } from './domain-utils.js';
```

- [ ] **Step 7: Add domain exports to core index.ts**

Add to `packages/core/src/index.ts`:

```typescript
export { extractDomainBrand, matchCredentialsByDomain, normalizeUrl } from './domain/index.js';
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /Users/davidneto/keykeykey/packages/core && npx vitest run src/domain/`
Expected: PASS

- [ ] **Step 9: Build core to verify exports work**

Run: `pnpm --filter @keykeykey/core build`
Expected: ESM + DTS build success

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/domain/ packages/core/src/index.ts packages/core/package.json packages/core/tsup.config.ts pnpm-lock.yaml
git commit -m "feat(core): add domain extraction and matching utilities"
```

---

## Chunk 2: Extension Configuration & Manifest

### Task 2: Update manifest, dependencies, and build config

**Files:**
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/manifest.json`
- Modify: `apps/extension/vite.config.ts`
- Modify: `apps/extension/src/popup/index.html`

- [ ] **Step 1: Add webextension-polyfill dependency**

```bash
cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension add webextension-polyfill
pnpm --filter @keykeykey/extension add -D @types/webextension-polyfill
```

- [ ] **Step 2: Update manifest.json**

Replace `apps/extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "KeyKeyKey",
  "version": "0.0.1",
  "description": "Your credentials, your cloud, your keys.",
  "permissions": ["storage", "activeTab", "alarms", "windows"],
  "action": {
    "default_popup": "src/popup/index.html",
    "default_title": "KeyKeyKey"
  },
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

Changes: added `windows` permission, removed `content_scripts` block (deferred to sub-project #2).

- [ ] **Step 3: Update vite.config.ts**

Replace `apps/extension/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: 'src/popup/index.html',
        background: 'src/background/index.ts',
      },
      output: {
        entryFileNames: '[name]/index.js',
      },
    },
  },
});
```

Removed `content` entry point (deferred).

- [ ] **Step 4: Update popup/index.html for proper dimensions**

Replace `apps/extension/src/popup/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>KeyKeyKey</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 360px; min-height: 480px; overflow-x: hidden; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Commit**

```bash
git add apps/extension/package.json apps/extension/manifest.json apps/extension/vite.config.ts apps/extension/src/popup/index.html pnpm-lock.yaml
git commit -m "feat(extension): update manifest, add webextension-polyfill, configure build"
```

---

## Chunk 3: Message Types & Browser Mock

### Task 3: Define message protocol and test infrastructure

**Files:**
- Create: `apps/extension/src/lib/messages.ts`
- Create: `apps/extension/src/lib/browser-mock.ts`

- [ ] **Step 1: Create message type definitions**

Create `apps/extension/src/lib/messages.ts`:

```typescript
import type { VaultItem } from '@keykeykey/core';
import type { PasswordGeneratorOptions } from '@keykeykey/core';

// ---------------------------------------------------------------------------
// Item data types matching core store signatures
// ---------------------------------------------------------------------------

export type NewItemData = Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>;
export type ItemUpdates = Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type AutoLockMode = 'timed' | 'browser_close' | 'never';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface Settings {
  autoLockMode: AutoLockMode;
  autoLockMinutes: number;
  themeMode: ThemeMode;
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMode: 'timed',
  autoLockMinutes: 15,
  themeMode: 'system',
};

// ---------------------------------------------------------------------------
// Sync config
// ---------------------------------------------------------------------------

export type SyncProvider = 'google-drive' | 'icloud' | 'webdav' | 'none';

export interface SyncConfig {
  provider: SyncProvider;
  webdavUrl?: string;
  webdavUsername?: string;
  // WebDAV password is encrypted with DEK before storage
}

export interface SyncStatus {
  provider: SyncProvider;
  lastSynced: string | null;
  isSyncing: boolean;
}

// ---------------------------------------------------------------------------
// Messages: Popup → Background
// ---------------------------------------------------------------------------

export type BackgroundMessage =
  | { type: 'GET_STATUS' }
  | { type: 'SETUP'; password: string }
  | { type: 'UNLOCK'; password: string }
  | { type: 'UNLOCK_PIN'; pin: string }
  | { type: 'LOCK' }
  | { type: 'GET_ITEMS' }
  | { type: 'SEARCH'; query: string }
  | { type: 'ADD_ITEM'; item: NewItemData }
  | { type: 'UPDATE_ITEM'; id: string; updates: ItemUpdates }
  | { type: 'DELETE_ITEM'; id: string }
  | { type: 'GENERATE_PASSWORD'; options: Partial<PasswordGeneratorOptions> & { mode: 'random' | 'passphrase' } }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<Settings> }
  | { type: 'SET_PIN'; pin: string }
  | { type: 'REMOVE_PIN' }
  | { type: 'GET_ACTIVE_TAB_URL' }
  | { type: 'CLIPBOARD_COPIED' }
  | { type: 'GET_SYNC_STATUS' }
  | { type: 'CONFIGURE_SYNC'; config: SyncConfig }
  | { type: 'TRIGGER_SYNC' }
  | { type: 'DISCONNECT_SYNC' };

// ---------------------------------------------------------------------------
// Responses: Background → Popup
// ---------------------------------------------------------------------------

export type VaultStatusResponse = {
  status: 'loading' | 'needs_setup' | 'locked' | 'unlocked';
  hasPIN: boolean;
  itemCount: number;
};

// Generic response wrapper — all responses may include error
export type MessageResponse<T = void> =
  | (T extends void ? { ok: true } : T)
  | { error: string };
```

- [ ] **Step 2: Create browser API mock for tests**

Create `apps/extension/src/lib/browser-mock.ts`:

```typescript
/**
 * In-memory mock of browser.* APIs for testing.
 *
 * Provides: storage.local, runtime, alarms, tabs.
 * Import and assign to globalThis in test setup.
 */

type StorageData = Record<string, unknown>;
type Listener = (...args: unknown[]) => void;

export function createBrowserMock() {
  let storageData: StorageData = {};
  const listeners: Record<string, Listener[]> = {};

  const alarms: Record<string, { name: string; scheduledTime: number }> = {};

  return {
    storage: {
      local: {
        get: async (keys: string | string[] | null) => {
          if (keys === null) return { ...storageData };
          const keyList = typeof keys === 'string' ? [keys] : keys;
          const result: StorageData = {};
          for (const k of keyList) {
            if (k in storageData) result[k] = storageData[k];
          }
          return result;
        },
        set: async (items: StorageData) => {
          Object.assign(storageData, items);
        },
        remove: async (keys: string | string[]) => {
          const keyList = typeof keys === 'string' ? [keys] : keys;
          for (const k of keyList) delete storageData[k];
        },
      },
    },
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => {
          listeners['message'] = listeners['message'] ?? [];
          listeners['message'].push(fn);
        },
        removeListener: (fn: Listener) => {
          listeners['message'] = (listeners['message'] ?? []).filter((l) => l !== fn);
        },
      },
      sendMessage: async (msg: unknown) => {
        const fns = listeners['message'] ?? [];
        for (const fn of fns) {
          return new Promise((resolve) => fn(msg, {}, resolve));
        }
      },
    },
    alarms: {
      create: (name: string, info: { delayInMinutes: number }) => {
        alarms[name] = { name, scheduledTime: Date.now() + info.delayInMinutes * 60_000 };
      },
      clear: async (name: string) => {
        delete alarms[name];
        return true;
      },
      get: async (name: string) => alarms[name] ?? null,
      onAlarm: {
        addListener: (fn: Listener) => {
          listeners['alarm'] = listeners['alarm'] ?? [];
          listeners['alarm'].push(fn);
        },
      },
      // Test helper: fire an alarm
      _fire: (name: string) => {
        const fns = listeners['alarm'] ?? [];
        for (const fn of fns) fn({ name });
      },
    },
    tabs: {
      query: async () => [{ url: 'https://github.com/user/repo' }],
    },
    windows: {
      onRemoved: {
        addListener: (fn: Listener) => {
          listeners['windowRemoved'] = listeners['windowRemoved'] ?? [];
          listeners['windowRemoved'].push(fn);
        },
      },
      getAll: async () => [{ id: 1 }],
    },
    // Test helper: reset all state
    _reset: () => {
      storageData = {};
      for (const key of Object.keys(listeners)) delete listeners[key];
      for (const key of Object.keys(alarms)) delete alarms[key];
    },
  };
}

export type BrowserMock = ReturnType<typeof createBrowserMock>;
```

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/lib/messages.ts apps/extension/src/lib/browser-mock.ts
git commit -m "feat(extension): add message type definitions and browser API mock"
```

---

## Chunk 4: Storage Layer

### Task 4: Implement browser.storage.local persistence

**Files:**
- Create: `apps/extension/src/background/storage.ts`
- Create: `apps/extension/src/background/storage.test.ts`

- [ ] **Step 1: Write failing tests for storage layer**

Create `apps/extension/src/background/storage.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadVaultHeader,
  saveVaultHeader,
  loadEncryptedItems,
  saveEncryptedItem,
  deleteEncryptedItem,
  loadSettings,
  saveSettings,
} from './storage.js';
import { createBrowserMock } from '../lib/browser-mock.js';
import { DEFAULT_SETTINGS } from '../lib/messages.js';

const browserMock = createBrowserMock();
vi.stubGlobal('browser', browserMock);

describe('storage', () => {
  beforeEach(() => {
    browserMock._reset();
  });

  describe('vault header', () => {
    it('should return null when no header exists', async () => {
      expect(await loadVaultHeader()).toBeNull();
    });

    it('should round-trip a vault header', async () => {
      await saveVaultHeader('base64-header-data');
      expect(await loadVaultHeader()).toBe('base64-header-data');
    });
  });

  describe('encrypted items', () => {
    it('should return empty record when no items exist', async () => {
      const items = await loadEncryptedItems();
      expect(Object.keys(items)).toHaveLength(0);
    });

    it('should save and load items with item_ prefix', async () => {
      await saveEncryptedItem('abc-123', 'encrypted-data-1');
      await saveEncryptedItem('def-456', 'encrypted-data-2');
      const items = await loadEncryptedItems();
      expect(items['abc-123']).toBe('encrypted-data-1');
      expect(items['def-456']).toBe('encrypted-data-2');
    });

    it('should delete a single item', async () => {
      await saveEncryptedItem('abc-123', 'data');
      await deleteEncryptedItem('abc-123');
      const items = await loadEncryptedItems();
      expect(items['abc-123']).toBeUndefined();
    });
  });

  describe('settings', () => {
    it('should return defaults when no settings saved', async () => {
      const settings = await loadSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should merge partial settings updates', async () => {
      await saveSettings({ themeMode: 'dark' });
      const settings = await loadSettings();
      expect(settings.themeMode).toBe('dark');
      expect(settings.autoLockMinutes).toBe(15); // default preserved
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/davidneto/keykeykey/apps/extension && npx vitest run src/background/storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement storage layer**

Create `apps/extension/src/background/storage.ts`:

```typescript
import browser from 'webextension-polyfill';
import type { Settings } from '../lib/messages.js';
import { DEFAULT_SETTINGS } from '../lib/messages.js';

const ITEM_PREFIX = 'item_';

// ---------------------------------------------------------------------------
// Vault header
// ---------------------------------------------------------------------------

export async function loadVaultHeader(): Promise<string | null> {
  const result = await browser.storage.local.get('vault_header');
  return (result.vault_header as string) ?? null;
}

export async function saveVaultHeader(headerBase64: string): Promise<void> {
  await browser.storage.local.set({ vault_header: headerBase64 });
}

// ---------------------------------------------------------------------------
// Encrypted items (one key per item: item_<id>)
// ---------------------------------------------------------------------------

export async function loadEncryptedItems(): Promise<Record<string, string>> {
  const all = await browser.storage.local.get(null);
  const items: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(ITEM_PREFIX) && typeof value === 'string') {
      items[key.slice(ITEM_PREFIX.length)] = value;
    }
  }
  return items;
}

export async function saveEncryptedItem(id: string, encryptedBase64: string): Promise<void> {
  await browser.storage.local.set({ [`${ITEM_PREFIX}${id}`]: encryptedBase64 });
}

export async function deleteEncryptedItem(id: string): Promise<void> {
  await browser.storage.local.remove(`${ITEM_PREFIX}${id}`);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function loadSettings(): Promise<Settings> {
  const result = await browser.storage.local.get('settings');
  const saved = result.settings as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(partial: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await browser.storage.local.set({ settings: { ...current, ...partial } });
}

// ---------------------------------------------------------------------------
// PIN data
// ---------------------------------------------------------------------------

export async function loadPinData(): Promise<{
  wrappedDek: string;
  salt: string;
  attemptsRemaining: number;
} | null> {
  const result = await browser.storage.local.get([
    'pin_wrapped_dek',
    'pin_salt',
    'pin_attempts_remaining',
  ]);
  if (!result.pin_wrapped_dek || !result.pin_salt) return null;
  return {
    wrappedDek: result.pin_wrapped_dek as string,
    salt: result.pin_salt as string,
    attemptsRemaining: (result.pin_attempts_remaining as number) ?? 5,
  };
}

export async function savePinData(wrappedDek: string, salt: string): Promise<void> {
  await browser.storage.local.set({
    pin_wrapped_dek: wrappedDek,
    pin_salt: salt,
    pin_attempts_remaining: 5,
  });
}

export async function updatePinAttempts(remaining: number): Promise<void> {
  if (remaining <= 0) {
    // Wipe PIN data on exhaustion
    await browser.storage.local.remove(['pin_wrapped_dek', 'pin_salt', 'pin_attempts_remaining']);
  } else {
    await browser.storage.local.set({ pin_attempts_remaining: remaining });
  }
}

export async function clearPinData(): Promise<void> {
  await browser.storage.local.remove(['pin_wrapped_dek', 'pin_salt', 'pin_attempts_remaining']);
}

// ---------------------------------------------------------------------------
// Sync config
// ---------------------------------------------------------------------------

export async function loadSyncConfig() {
  const result = await browser.storage.local.get(['sync_provider', 'sync_webdav_url', 'sync_webdav_creds']);
  return {
    provider: (result.sync_provider as string) ?? 'none',
    webdavUrl: result.sync_webdav_url as string | undefined,
    webdavCreds: result.sync_webdav_creds as string | undefined,
  };
}

export async function saveSyncConfig(config: {
  provider: string;
  webdavUrl?: string;
  webdavCreds?: string;
}): Promise<void> {
  await browser.storage.local.set({
    sync_provider: config.provider,
    ...(config.webdavUrl && { sync_webdav_url: config.webdavUrl }),
    ...(config.webdavCreds && { sync_webdav_creds: config.webdavCreds }),
  });
}

export async function clearSyncConfig(): Promise<void> {
  await browser.storage.local.remove(['sync_provider', 'sync_webdav_url', 'sync_webdav_creds']);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/davidneto/keykeykey/apps/extension && npx vitest run src/background/storage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/background/storage.ts apps/extension/src/background/storage.test.ts
git commit -m "feat(extension): add browser.storage.local persistence layer"
```

---

## Chunk 5: Auto-Lock & PIN

### Task 5: Implement auto-lock timer and PIN unlock

**Files:**
- Create: `apps/extension/src/background/auto-lock.ts`
- Create: `apps/extension/src/background/auto-lock.test.ts`
- Create: `apps/extension/src/background/pin.ts`
- Create: `apps/extension/src/background/pin.test.ts`

- [ ] **Step 1: Write failing tests for auto-lock**

Create `apps/extension/src/background/auto-lock.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutoLockManager } from './auto-lock.js';
import { createBrowserMock } from '../lib/browser-mock.js';

const browserMock = createBrowserMock();
vi.stubGlobal('browser', browserMock);

describe('AutoLockManager', () => {
  let lockCallback: ReturnType<typeof vi.fn>;
  let manager: AutoLockManager;

  beforeEach(() => {
    browserMock._reset();
    lockCallback = vi.fn();
    manager = new AutoLockManager(lockCallback);
  });

  it('should create an alarm when started in timed mode', () => {
    manager.start('timed', 15);
    expect(browserMock.alarms.get('auto-lock')).resolves.not.toBeNull();
  });

  it('should reset the alarm on activity', async () => {
    manager.start('timed', 15);
    manager.resetTimer();
    const alarm = await browserMock.alarms.get('auto-lock');
    expect(alarm).not.toBeNull();
  });

  it('should call lock callback when alarm fires', () => {
    manager.start('timed', 15);
    browserMock.alarms._fire('auto-lock');
    expect(lockCallback).toHaveBeenCalled();
  });

  it('should not create alarm in never mode', async () => {
    manager.start('never', 15);
    const alarm = await browserMock.alarms.get('auto-lock');
    expect(alarm).toBeNull();
  });

  it('should stop clearing alarm', async () => {
    manager.start('timed', 15);
    manager.stop();
    const alarm = await browserMock.alarms.get('auto-lock');
    expect(alarm).toBeNull();
  });
});
```

- [ ] **Step 2: Implement auto-lock manager**

Create `apps/extension/src/background/auto-lock.ts`:

```typescript
import browser from 'webextension-polyfill';
import type { AutoLockMode } from '../lib/messages.js';

const ALARM_NAME = 'auto-lock';

export class AutoLockManager {
  private onLock: () => void;
  private mode: AutoLockMode = 'timed';
  private minutes = 15;
  private windowRemovedHandler: ((windowId: number) => void) | null = null;

  constructor(onLock: () => void) {
    this.onLock = onLock;

    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARM_NAME) {
        this.onLock();
      }
    });
  }

  start(mode: AutoLockMode, minutes: number): void {
    this.mode = mode;
    this.minutes = minutes;
    this.stop();

    if (mode === 'timed') {
      browser.alarms.create(ALARM_NAME, { delayInMinutes: minutes });
    } else if (mode === 'browser_close') {
      this.windowRemovedHandler = () => {
        browser.windows.getAll().then((windows) => {
          if (windows.length === 0) this.onLock();
        });
      };
      browser.windows.onRemoved.addListener(this.windowRemovedHandler);
    }
    // 'never' — no alarm, no listener
  }

  resetTimer(): void {
    if (this.mode === 'timed') {
      browser.alarms.clear(ALARM_NAME);
      browser.alarms.create(ALARM_NAME, { delayInMinutes: this.minutes });
    }
  }

  stop(): void {
    browser.alarms.clear(ALARM_NAME);
    // Clean up window listener to prevent leaks on mode switch
    if (this.windowRemovedHandler) {
      browser.windows.onRemoved.removeListener(this.windowRemovedHandler);
      this.windowRemovedHandler = null;
    }
  }
}
```

- [ ] **Step 3: Run auto-lock tests**

Run: `cd /Users/davidneto/keykeykey/apps/extension && npx vitest run src/background/auto-lock.test.ts`
Expected: PASS

- [ ] **Step 4: Write failing tests for PIN**

Create `apps/extension/src/background/pin.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wrapDekWithPin, unwrapDekWithPin } from './pin.js';

describe('PIN DEK wrapping', () => {
  // Use a known DEK for testing
  const testDek = new Uint8Array(32);
  testDek.fill(0xAB);

  it('should round-trip wrap and unwrap DEK with correct PIN', async () => {
    const pin = '1234';
    const { wrappedDek, salt } = await wrapDekWithPin(testDek, pin);

    expect(wrappedDek).toBeTruthy();
    expect(salt).toBeTruthy();

    const recovered = await unwrapDekWithPin(wrappedDek, salt, pin);
    expect(recovered).toEqual(testDek);
  });

  it('should fail to unwrap with wrong PIN', async () => {
    const { wrappedDek, salt } = await wrapDekWithPin(testDek, '1234');
    await expect(unwrapDekWithPin(wrappedDek, salt, '9999')).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Implement PIN wrapping**

Create `apps/extension/src/background/pin.ts`:

```typescript
import { deriveKEK } from '@keykeykey/core';
import { encrypt, decrypt } from '@keykeykey/core';
import { ARGON2_PRESETS } from '@keykeykey/core';

/**
 * Wrap a DEK with a PIN-derived KEK.
 * Returns the wrapped blob and the salt used for derivation.
 */
export async function wrapDekWithPin(
  dek: Uint8Array,
  pin: string,
): Promise<{ wrappedDek: Uint8Array; salt: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pinKek = await deriveKEK(pin, salt, ARGON2_PRESETS.browser);
  const wrapped = encrypt(dek, pinKek);
  return { wrappedDek: wrapped, salt };
}

/**
 * Unwrap a DEK using a PIN-derived KEK.
 * Throws if the PIN is wrong (decryption fails).
 */
export async function unwrapDekWithPin(
  wrappedDek: Uint8Array,
  salt: Uint8Array,
  pin: string,
): Promise<Uint8Array> {
  const pinKek = await deriveKEK(pin, salt, ARGON2_PRESETS.browser);
  return decrypt(wrappedDek, pinKek);
}
```

- [ ] **Step 6: Run PIN tests**

Run: `cd /Users/davidneto/keykeykey/apps/extension && npx vitest run src/background/pin.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/background/auto-lock.ts apps/extension/src/background/auto-lock.test.ts apps/extension/src/background/pin.ts apps/extension/src/background/pin.test.ts
git commit -m "feat(extension): add auto-lock manager and PIN DEK wrapping"
```

---

## Chunk 6: Background Message Handler

### Task 6: Implement the background worker message handler

**Files:**
- Create: `apps/extension/src/background/message-handler.ts`
- Create: `apps/extension/src/background/message-handler.test.ts`
- Modify: `apps/extension/src/background/index.ts`

- [ ] **Step 1: Write failing tests for message handler**

Create `apps/extension/src/background/message-handler.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMessageHandler } from './message-handler.js';
import { createBrowserMock } from '../lib/browser-mock.js';
import type { BackgroundMessage } from '../lib/messages.js';

const browserMock = createBrowserMock();
vi.stubGlobal('browser', browserMock);

describe('message handler', () => {
  let handler: ReturnType<typeof createMessageHandler>;

  beforeEach(() => {
    browserMock._reset();
    handler = createMessageHandler();
  });

  it('should return needs_setup when no vault header exists', async () => {
    const response = await handler({ type: 'GET_STATUS' } as BackgroundMessage);
    expect(response.status).toBe('needs_setup');
  });

  it('should return locked after setup', async () => {
    // Setup creates a vault
    const setupResponse = await handler({ type: 'SETUP', password: 'TestPassword123!' } as BackgroundMessage);
    expect(setupResponse.recoveryKey).toBeTruthy();

    // Lock
    await handler({ type: 'LOCK' } as BackgroundMessage);

    // Status should be locked
    const status = await handler({ type: 'GET_STATUS' } as BackgroundMessage);
    expect(status.status).toBe('locked');
  });

  it('should unlock with correct password', async () => {
    await handler({ type: 'SETUP', password: 'TestPassword123!' } as BackgroundMessage);
    await handler({ type: 'LOCK' } as BackgroundMessage);

    const response = await handler({ type: 'UNLOCK', password: 'TestPassword123!' } as BackgroundMessage);
    expect(response.success).toBe(true);
  });

  it('should fail to unlock with wrong password', async () => {
    await handler({ type: 'SETUP', password: 'TestPassword123!' } as BackgroundMessage);
    await handler({ type: 'LOCK' } as BackgroundMessage);

    const response = await handler({ type: 'UNLOCK', password: 'WrongPassword!' } as BackgroundMessage);
    expect(response.error).toBeTruthy();
  });

  it('should add and retrieve items', async () => {
    await handler({ type: 'SETUP', password: 'TestPassword123!' } as BackgroundMessage);

    const addResponse = await handler({
      type: 'ADD_ITEM',
      item: {
        type: 'credential',
        name: 'GitHub',
        username: 'user',
        password: 'pass',
        url: 'https://github.com',
        tags: [],
        favorite: false,
      },
    } as BackgroundMessage);
    expect(addResponse.id).toBeTruthy();

    const items = await handler({ type: 'GET_ITEMS' } as BackgroundMessage);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('GitHub');
  });

  it('should search items', async () => {
    await handler({ type: 'SETUP', password: 'TestPassword123!' } as BackgroundMessage);
    await handler({
      type: 'ADD_ITEM',
      item: {
        type: 'credential', name: 'GitHub', username: 'user',
        password: 'pass', url: 'https://github.com', tags: [], favorite: false,
      },
    } as BackgroundMessage);

    const results = await handler({ type: 'SEARCH', query: 'git' } as BackgroundMessage);
    expect(results).toHaveLength(1);
  });

  it('should generate a password', async () => {
    const response = await handler({
      type: 'GENERATE_PASSWORD',
      options: { mode: 'random', length: 20 },
    } as BackgroundMessage);
    expect(response.password).toHaveLength(20);
    expect(response.entropy).toBeGreaterThan(0);
  });

  it('should return active tab URL', async () => {
    const response = await handler({ type: 'GET_ACTIVE_TAB_URL' } as BackgroundMessage);
    expect(response.url).toBe('https://github.com/user/repo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/davidneto/keykeykey/apps/extension && npx vitest run src/background/message-handler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement message handler**

Create `apps/extension/src/background/message-handler.ts`:

The message handler creates a vault store, manages its lifecycle, and dispatches messages. This is a large file (~200 lines) — implement it with a `createMessageHandler()` factory that returns an async handler function. The handler should:

1. Create a `createVaultStore()` from core on first call
2. Load vault header from storage on init to determine status
3. Route each message type to the appropriate store/storage/utility call
4. Reset the auto-lock timer on every message
5. Return typed responses

Key implementation details:
- `GET_STATUS`: check if vault_header exists in storage → `needs_setup`, else check if DEK in memory → `locked` / `unlocked`
- `SETUP`: `generateRecoveryKey()` → `createVaultHeader(password, raw, ARGON2_PRESETS.browser)` → `serializeVaultHeader()` → base64 → save to storage → return recovery key
- `UNLOCK`: `deserializeVaultHeader()` → load encrypted items from storage → `store.unlock(password, encryptedItems)` → start auto-lock
- `ADD_ITEM` / `UPDATE_ITEM` / `DELETE_ITEM`: call store method → encrypt changed item → persist to storage
- `GENERATE_PASSWORD`: call `generatePassword()` + `calculateEntropy()` from core
- `GET_ACTIVE_TAB_URL`: `browser.tabs.query({ active: true, currentWindow: true })` → return URL
- `CLIPBOARD_COPIED`: call `scheduleClipboardClear()` from clipboard module
- `GET_SYNC_STATUS`: return current sync provider, last synced timestamp, isSyncing flag
- `CONFIGURE_SYNC`: save sync config to storage, create adapter + SyncEngine, connect to store
- `TRIGGER_SYNC`: call `engine.sync()`, return SyncResult
- `DISCONNECT_SYNC`: disconnect engine, clear sync config from storage

Sync integration: on unlock, load sync config from storage. If provider is not 'none', create the appropriate adapter (GoogleDriveAdapter / WebDavAdapter / ICloudAdapter), create SyncEngine, call `connectSyncEngine(store, engine)`, then `engine.sync()` for initial pull. On lock, disconnect the sync engine.

On `DELETE_ITEM`: call `engine.recordTombstone(id)` before deleting from store (if sync is active).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/davidneto/keykeykey/apps/extension && npx vitest run src/background/message-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Wire message handler in background/index.ts**

Replace `apps/extension/src/background/index.ts`:

```typescript
import browser from 'webextension-polyfill';
import { createMessageHandler } from './message-handler.js';

const handler = createMessageHandler();

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handler(message).then(sendResponse);
  return true; // indicates async response
});

console.log('KeyKeyKey background worker started.');
```

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/background/
git commit -m "feat(extension): implement background message handler with full vault lifecycle"
```

---

## Chunk 6b: Clipboard Clearing

### Task 6b: Implement clipboard auto-clear via offscreen document

**Files:**
- Create: `apps/extension/src/background/clipboard.ts`
- Create: `apps/extension/src/offscreen/clipboard-clear.html`
- Create: `apps/extension/src/offscreen/clipboard-clear.ts`
- Modify: `apps/extension/manifest.json` (add `offscreen` permission)

The `CLIPBOARD_COPIED` message handler in the background sets a 30-second alarm (`clipboard-clear`). When the alarm fires, the background creates a short-lived offscreen document that clears the clipboard:

- [ ] **Step 1: Add `offscreen` permission to manifest.json**

Add `"offscreen"` to the permissions array in `apps/extension/manifest.json`.

- [ ] **Step 2: Create offscreen HTML and script**

Create `apps/extension/src/offscreen/clipboard-clear.html`:
```html
<!doctype html>
<script src="clipboard-clear.ts" type="module"></script>
```

Create `apps/extension/src/offscreen/clipboard-clear.ts`:
```typescript
// Called by the background worker to clear clipboard
navigator.clipboard.writeText('').then(() => {
  // Notify background we're done so it can close us
  window.close();
});
```

- [ ] **Step 3: Implement clipboard manager**

Create `apps/extension/src/background/clipboard.ts`:
```typescript
import browser from 'webextension-polyfill';

const CLIPBOARD_ALARM = 'clipboard-clear';

export function setupClipboardClear(): void {
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== CLIPBOARD_ALARM) return;

    try {
      await (browser as any).offscreen.createDocument({
        url: 'offscreen/clipboard-clear.html',
        reasons: ['CLIPBOARD'],
        justification: 'Clear clipboard after copy timeout',
      });
    } catch {
      // Offscreen document may already exist or not be supported (Firefox/Safari)
      // Graceful degradation — clipboard just won't auto-clear
    }
  });
}

export function scheduleClipboardClear(): void {
  browser.alarms.clear(CLIPBOARD_ALARM);
  browser.alarms.create(CLIPBOARD_ALARM, { delayInMinutes: 0.5 }); // 30 seconds
}
```

- [ ] **Step 4: Wire into message handler**

The `CLIPBOARD_COPIED` case in the message handler calls `scheduleClipboardClear()`.

- [ ] **Step 5: Add offscreen entry to vite config**

Add `offscreen: 'src/offscreen/clipboard-clear.html'` to the `rollupOptions.input` in `vite.config.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/background/clipboard.ts apps/extension/src/offscreen/ apps/extension/manifest.json apps/extension/vite.config.ts
git commit -m "feat(extension): add clipboard auto-clear via offscreen document"
```

---

## Chunk 7: Theme Provider & Popup Shell

### Task 7: Implement ThemeProvider and root Popup component

**Files:**
- Create: `apps/extension/src/lib/theme.tsx`
- Create: `apps/extension/src/lib/theme.test.tsx`
- Create: `apps/extension/src/popup/hooks/useMessage.ts`
- Create: `apps/extension/src/popup/hooks/useVaultStatus.ts`
- Create: `apps/extension/src/popup/styles/global.css`
- Modify: `apps/extension/src/popup/Popup.tsx`
- Create: `apps/extension/src/popup/Popup.test.tsx`
- Modify: `apps/extension/src/popup/main.tsx`

- [ ] **Step 1: Create ThemeProvider**

Create `apps/extension/src/lib/theme.tsx` — adapt desktop's `ThemeProvider` pattern. Use `@keykeykey/ui` tokens for `lightTheme` and `darkTheme`. Instead of `localStorage`, read initial theme from background via message. Apply `data-theme` attribute to `document.documentElement`.

- [ ] **Step 2: Create useMessage hook**

Create `apps/extension/src/popup/hooks/useMessage.ts`:

```typescript
import browser from 'webextension-polyfill';
import type { BackgroundMessage } from '../../lib/messages.js';

/**
 * Send a typed message to the background worker and return the response.
 */
export async function sendMessage<T>(message: BackgroundMessage): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}
```

- [ ] **Step 3: Create useVaultStatus hook**

Create `apps/extension/src/popup/hooks/useVaultStatus.ts`:

```typescript
import { useState, useEffect } from 'react';
import { sendMessage } from './useMessage.js';
import type { VaultStatusResponse } from '../../lib/messages.js';

export function useVaultStatus() {
  const [status, setStatus] = useState<VaultStatusResponse>({
    status: 'loading',
    hasPIN: false,
    itemCount: 0,
  });

  const refresh = async () => {
    const response = await sendMessage<VaultStatusResponse>({ type: 'GET_STATUS' });
    setStatus(response);
  };

  useEffect(() => {
    refresh();
  }, []);

  return { ...status, refresh };
}
```

- [ ] **Step 4: Create global CSS**

Create `apps/extension/src/popup/styles/global.css` with CSS variables from `@keykeykey/ui` tokens for light/dark modes, base font styling, and scrollbar styling.

- [ ] **Step 5: Create root Popup component**

Replace `apps/extension/src/popup/Popup.tsx` with a status-based router:

```typescript
import { useVaultStatus } from './hooks/useVaultStatus.js';
// Import screens as they are created (stubs initially)

export function Popup() {
  const { status, hasPIN, refresh } = useVaultStatus();

  switch (status) {
    case 'loading':
      return <LoadingSpinner />;
    case 'needs_setup':
      return <SetupScreen onComplete={refresh} />;
    case 'locked':
      return <UnlockScreen hasPIN={hasPIN} onUnlock={refresh} />;
    case 'unlocked':
      return <VaultListScreen />;
  }
}
```

Initially, create minimal stub screens that just render the screen name so the shell is testable.

- [ ] **Step 6: Write Popup test**

Create `apps/extension/src/popup/Popup.test.tsx` — test that the correct screen renders for each status value by mocking `sendMessage`.

- [ ] **Step 7: Update main.tsx with ThemeProvider**

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../lib/theme.js';
import { Popup } from './Popup.js';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Popup />
    </ThemeProvider>
  </StrictMode>,
);
```

- [ ] **Step 8: Commit**

```bash
git add apps/extension/src/lib/theme.tsx apps/extension/src/lib/theme.test.tsx apps/extension/src/popup/
git commit -m "feat(extension): add ThemeProvider, popup shell, and navigation hooks"
```

---

## Chunk 8: Popup Screens (Setup, Unlock, VaultList)

### Task 8: Implement the three primary screens

**Files:**
- Create/replace: `apps/extension/src/popup/screens/SetupScreen.tsx`
- Create: `apps/extension/src/popup/screens/SetupScreen.test.tsx`
- Create/replace: `apps/extension/src/popup/screens/UnlockScreen.tsx`
- Create: `apps/extension/src/popup/screens/UnlockScreen.test.tsx`
- Create/replace: `apps/extension/src/popup/screens/VaultListScreen.tsx`
- Create: `apps/extension/src/popup/screens/VaultListScreen.test.tsx`
- Create: `apps/extension/src/popup/screens/RecoveryKeyScreen.tsx`
- Create: `apps/extension/src/popup/components/ItemCard.tsx`
- Create: `apps/extension/src/popup/components/PinPad.tsx`
- Create: `apps/extension/src/popup/components/CopyButton.tsx`

Each screen follows the desktop pattern:
- Inline styles using `useTheme()` tokens
- Local state for form inputs, loading, errors
- `sendMessage()` to communicate with background
- No external component library

**SetupScreen:** Two paths — "Create New Vault" (password + confirm → SETUP message → RecoveryKeyScreen) and "Restore from Cloud" (provider picker → authenticate → download → unlock).

**UnlockScreen:** Password field with submit. If `hasPIN`, show toggle to switch to PinPad component. Sends `UNLOCK` or `UNLOCK_PIN` message.

**VaultListScreen:** Search bar, filter chips (all/logins/cards/notes), scrollable ItemCard list. Floating "+" button navigates to AddItemScreen. Each ItemCard shows icon, name, username, copy button. Clicking a card navigates to detail screen.

**Navigation within unlocked state:** Use React state (`useState<string>`) for screen routing within the popup since React Router is overkill for an extension popup. Example: `currentScreen: 'list' | 'detail:id' | 'add' | 'edit:id' | 'generator' | 'settings'`.

- [ ] **Steps:** TDD for each screen — write test, verify fail, implement, verify pass, commit.

- [ ] **Commit**

```bash
git add apps/extension/src/popup/
git commit -m "feat(extension): implement setup, unlock, and vault list screens"
```

---

## Chunk 9: Remaining Screens (Detail, Add, Edit, Generator, Settings)

### Task 9: Implement secondary screens

**Files:**
- Create: `apps/extension/src/popup/screens/CredentialDetailScreen.tsx`
- Create: `apps/extension/src/popup/screens/CredentialDetailScreen.test.tsx`
- Create: `apps/extension/src/popup/screens/AddItemScreen.tsx`
- Create: `apps/extension/src/popup/screens/AddItemScreen.test.tsx`
- Create: `apps/extension/src/popup/screens/EditItemScreen.tsx`
- Create: `apps/extension/src/popup/screens/EditItemScreen.test.tsx`
- Create: `apps/extension/src/popup/screens/GeneratorScreen.tsx`
- Create: `apps/extension/src/popup/screens/GeneratorScreen.test.tsx`
- Create: `apps/extension/src/popup/screens/SettingsScreen.tsx`
- Create: `apps/extension/src/popup/screens/SettingsScreen.test.tsx`

**CredentialDetailScreen:** Displays all fields. Copy buttons for username, password, URL (sends `CLIPBOARD_COPIED` to background for auto-clear). Reveal toggle for password. Edit button → EditItemScreen. Delete button with confirmation.

**AddItemScreen:** Type picker dropdown. Form fields vary by type. For credentials: name, URL (auto-filled via `GET_ACTIVE_TAB_URL`, name auto-populated via `extractDomainBrand`), username, password (with generate button → GeneratorScreen), notes. Save sends `ADD_ITEM`.

**EditItemScreen:** Same form as AddItemScreen but pre-filled. Save sends `UPDATE_ITEM`.

**GeneratorScreen:** Random/passphrase toggle. Random: length slider, character class checkboxes. Passphrase: word count slider, separator picker. Entropy meter with strength label. Copy and "Use" buttons (Use fills the password field if navigated from Add/Edit).

**SettingsScreen:** Sections: Cloud Sync (provider picker, connect/disconnect, status), Auto-Lock (mode picker, timeout), Appearance (theme toggle), Security (set/change/remove PIN), About (version), Lock Vault button.

- [ ] **Steps:** TDD for each screen — focusing on AddItemScreen (URL auto-fill logic) and SettingsScreen (sync config).

- [ ] **Commit**

```bash
git add apps/extension/src/popup/screens/
git commit -m "feat(extension): implement detail, add, edit, generator, and settings screens"
```

---

## Chunk 10: Final Integration & Verification

### Task 10: Build, lint, test, and verify everything

- [ ] **Step 1: Run all extension tests**

Run: `cd /Users/davidneto/keykeykey/apps/extension && npx vitest run`
Expected: PASS (all test files)

- [ ] **Step 2: Run lint**

Run: `pnpm --filter @keykeykey/extension lint`
Expected: PASS

- [ ] **Step 3: Run format**

Run: `pnpm format && pnpm format:check`
Expected: PASS

- [ ] **Step 4: Build core + extension**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/extension build`
Expected: PASS

- [ ] **Step 5: Run full monorepo test suite**

Run: `pnpm test`
Expected: PASS (all packages)

- [ ] **Step 6: Verify extension loads in Chrome**

Follow README instructions:
1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `apps/extension/dist/`
4. Click the extension icon → verify popup renders
5. Test: create vault → recovery key → lock → unlock → add credential → search

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix(extension): final integration fixes"
```
