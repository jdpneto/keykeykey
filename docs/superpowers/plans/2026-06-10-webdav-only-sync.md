# WebDAV-Only Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the OAuth sync providers (Google Drive, Dropbox, OneDrive) behind a core feature flag so every shipped surface offers only None/WebDAV, scrub all docs, keep OAuth code dormant and compiling.

**Architecture:** A new core module `enabled-providers.ts` exports `ENABLED_SYNC_PROVIDERS = ['none', 'webdav']` and `isSyncProviderEnabled()`. The adapter factory throws `SyncAdapterUnsupportedError` for disabled providers; all four UI pickers derive their options from the flag. OAuth UI blocks, drivers, background handlers, and adapters stay in the code, unreachable. Spec: `docs/superpowers/specs/2026-06-10-webdav-only-sync-design.md`.

**Tech Stack:** TypeScript monorepo (pnpm + Turbo), Vitest (core/desktop/extension), Jest (mobile), React / React Native.

**Verification baseline:** Before starting, `pnpm build && pnpm test && pnpm lint` must pass on `main`.

---

### Task 1: Core flag module `enabled-providers.ts`

**Files:**

- Create: `packages/core/src/sync/config/enabled-providers.ts`
- Create: `packages/core/src/sync/config/enabled-providers.test.ts`
- Modify: `packages/core/src/sync/index.ts` (add export after line 81, next to the other `./config/` exports)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/sync/config/enabled-providers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ENABLED_SYNC_PROVIDERS, isSyncProviderEnabled } from './enabled-providers.js';

describe('ENABLED_SYNC_PROVIDERS', () => {
  it('contains exactly none and webdav', () => {
    expect(ENABLED_SYNC_PROVIDERS).toEqual(['none', 'webdav']);
  });
});

describe('isSyncProviderEnabled', () => {
  it('returns true for none and webdav', () => {
    expect(isSyncProviderEnabled('none')).toBe(true);
    expect(isSyncProviderEnabled('webdav')).toBe(true);
  });

  it('returns false for the OAuth providers', () => {
    expect(isSyncProviderEnabled('google-drive')).toBe(false);
    expect(isSyncProviderEnabled('dropbox')).toBe(false);
    expect(isSyncProviderEnabled('onedrive')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @keykeykey/core test -- src/sync/config/enabled-providers.test.ts`
Expected: FAIL — cannot resolve `./enabled-providers.js`

- [ ] **Step 3: Write the module**

Create `packages/core/src/sync/config/enabled-providers.ts`:

```ts
import type { SyncProvider } from './schema.js';

/**
 * The sync providers offered in the UI and instantiable by the sync engine.
 *
 * The OAuth providers (google-drive, dropbox, onedrive) are fully implemented
 * but disabled: provider rate limits make sync unreliable and full-vault
 * downloads unacceptably slow. See docs/OAUTH_DISABLED.md before changing
 * this list — re-enabling requires more than editing it.
 */
export const ENABLED_SYNC_PROVIDERS: readonly SyncProvider[] = ['none', 'webdav'];

/** Whether a provider may be offered in the UI / instantiated by the engine. */
export function isSyncProviderEnabled(provider: SyncProvider): boolean {
  return ENABLED_SYNC_PROVIDERS.includes(provider);
}
```

- [ ] **Step 4: Export from the sync entry point**

In `packages/core/src/sync/index.ts`, after the `AdapterOverrides` export (line 81: `export type { AdapterOverrides } from './config/factory.js';`), add:

```ts
export { ENABLED_SYNC_PROVIDERS, isSyncProviderEnabled } from './config/enabled-providers.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @keykeykey/core test -- src/sync/config/enabled-providers.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/config/enabled-providers.ts packages/core/src/sync/config/enabled-providers.test.ts packages/core/src/sync/index.ts
git commit -m "feat(core): add ENABLED_SYNC_PROVIDERS flag (none + webdav only)"
```

---

### Task 2: Gate the adapter factory

**Files:**

- Modify: `packages/core/src/sync/config/factory.ts` (gate at top of `createAdapterFromConfig`, line ~47; rewrite `getAvailableProviders`, lines 166-168)
- Modify: `packages/core/src/sync/config/sync-config.test.ts` (replace OAuth factory tests, lines ~86-160; replace `getAvailableProviders` tests, lines 162-177)

Note: the `encryptSyncConfig`/`decryptSyncConfig` round-trip tests for Google Drive/Dropbox/OneDrive configs earlier in this file do NOT touch the factory — leave them untouched (stored OAuth configs must still parse).

- [ ] **Step 1: Update the tests first**

In `packages/core/src/sync/config/sync-config.test.ts`:

a) Add to the imports at the top of the file (it already imports `createAdapterFromConfig, getAvailableProviders` from `./factory.js`):

```ts
import { SyncAdapterUnsupportedError } from '../core/errors.js';
```

b) In the `describe('createAdapterFromConfig', ...)` block, DELETE these seven tests:

- `'should return GoogleDriveAdapter for google-drive provider'`
- `'should throw if google-drive config is missing googleDrive settings'`
- `'should create adapter without platform callbacks for google-drive'`
- `'should return DropboxAdapter for dropbox provider'`
- `'should throw if dropbox config is missing dropbox settings'`
- `'should return OneDriveAdapter for onedrive provider'`
- `'should throw if onedrive config is missing onedrive settings'`

Keep the `'none'` and both `'webdav'` tests. In their place add:

```ts
it.each(['google-drive', 'dropbox', 'onedrive'] as const)(
  'should throw SyncAdapterUnsupportedError for disabled provider %s',
  (provider) => {
    const config: SyncConfig = { provider };
    expect(() => createAdapterFromConfig(config)).toThrow(SyncAdapterUnsupportedError);
  },
);

it('should throw even when the disabled provider has credentials configured', () => {
  const config: SyncConfig = {
    provider: 'google-drive',
    googleDrive: { refreshToken: 'tok', clientId: 'cid' },
  };
  expect(() => createAdapterFromConfig(config)).toThrow(SyncAdapterUnsupportedError);
});
```

c) Replace the entire `describe('getAvailableProviders', ...)` block (both tests) with:

```ts
describe('getAvailableProviders', () => {
  it('should return exactly none and webdav', () => {
    expect(getAvailableProviders()).toEqual(['none', 'webdav']);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @keykeykey/core test -- src/sync/config/sync-config.test.ts`
Expected: FAIL — disabled-provider tests get a real adapter (or a missing-settings `Error`) instead of `SyncAdapterUnsupportedError`; `getAvailableProviders` still returns 5 entries

- [ ] **Step 3: Gate the factory**

In `packages/core/src/sync/config/factory.ts`:

a) Add two imports after line 12 (`import type { ISyncAdapter } ...`):

```ts
import { SyncAdapterUnsupportedError } from '../core/errors.js';
import { ENABLED_SYNC_PROVIDERS, isSyncProviderEnabled } from './enabled-providers.js';
```

b) In `createAdapterFromConfig`, immediately after the `adapterFactory` override line (`if (overrides?.adapterFactory) return overrides.adapterFactory(config);`) and before the `switch`, add:

```ts
if (!isSyncProviderEnabled(config.provider)) {
  throw new SyncAdapterUnsupportedError(`${config.provider} sync`, 'this build');
}
```

(The `adapterFactory` override stays first on purpose — tests inject MemoryAdapter through it.)

c) Replace the `getAvailableProviders` body:

```ts
export function getAvailableProviders(): SyncProvider[] {
  return [...ENABLED_SYNC_PROVIDERS];
}
```

- [ ] **Step 4: Run the full core suite**

Run: `pnpm --filter @keykeykey/core test`
Expected: PASS. If any lifecycle/integration test fails by constructing an OAuth adapter through the factory without the `adapterFactory` override, fix that test to use the override or a webdav config — do not weaken the gate.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync/config/factory.ts packages/core/src/sync/config/sync-config.test.ts
git commit -m "feat(core): adapter factory rejects disabled sync providers"
```

---

### Task 3: Shared ProviderSelector (packages/ui) offers only enabled providers

**Files:**

- Modify: `packages/ui/src/components/sync-settings/ProviderSelector.tsx` (imports line 2, options lines 183-187)

This component renders the picker for BOTH the desktop and extension Sync Settings screens. Its behavior is asserted by the desktop/extension tests updated in Tasks 4 and 6 (packages/ui has no own test suite for it).

- [ ] **Step 1: Import the flag**

Change line 2 from:

```ts
import type { SyncProvider } from '@keykeykey/core/sync';
```

to:

```ts
import { ENABLED_SYNC_PROVIDERS } from '@keykeykey/core/sync';
import type { SyncProvider } from '@keykeykey/core/sync';
```

- [ ] **Step 2: Replace the hardcoded options**

Below the existing `oauthLabel` map (line ~161), add:

```ts
const providerLabel: Record<SyncProvider, string> = {
  none: 'None',
  webdav: 'WebDAV',
  'google-drive': 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
};
```

Replace the five hardcoded `<option>` lines inside the `<select data-testid="sync-provider">`:

```tsx
          <option value="none">None</option>
          <option value="webdav">WebDAV</option>
          <option value="google-drive">Google Drive</option>
          <option value="dropbox">Dropbox</option>
          <option value="onedrive">OneDrive</option>
```

with:

```tsx
{
  ENABLED_SYNC_PROVIDERS.map((p) => (
    <option key={p} value={p}>
      {providerLabel[p]}
    </option>
  ));
}
```

Leave everything else in the file untouched — the `isOAuth` master-password block, `onOAuthConnect` prop, and the OAuth sign-in button remain (unreachable: an OAuth provider can no longer be selected).

- [ ] **Step 3: Build the ui package**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/ui build`
Expected: both succeed (core first — ui consumes the new export)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/sync-settings/ProviderSelector.tsx
git commit -m "feat(ui): ProviderSelector renders only enabled sync providers"
```

---

### Task 4: Desktop — restore picker + tests

**Files:**

- Modify: `apps/desktop/src/screens/RestoreScreen.tsx` (provider `<select>` options, lines ~296-299)
- Modify: `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx` (provider-options test lines ~119-131; sign-in tests lines ~284-313)

- [ ] **Step 1: Update the tests first**

In `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx`:

a) KEEP all `vi.mock(...)` blocks for `../../lib/google-oauth.js`, `../../lib/dropbox-oauth`, `../../lib/onedrive-oauth` — the screen still imports those modules.

b) In the test around lines 119-131 that asserts the provider options render, replace:

```ts
expect(screen.getByText('Google Drive')).toBeInTheDocument();
expect(screen.getByText('Dropbox')).toBeInTheDocument();
expect(screen.getByText('OneDrive')).toBeInTheDocument();
```

with:

```ts
expect(screen.getByText('WebDAV')).toBeInTheDocument();
expect(screen.queryByText('Google Drive')).not.toBeInTheDocument();
expect(screen.queryByText('Dropbox')).not.toBeInTheDocument();
expect(screen.queryByText('OneDrive')).not.toBeInTheDocument();
```

(If the surrounding test already asserts WebDAV/None render, don't duplicate those lines.)

c) DELETE these three tests entirely (lines ~284-313):

- `'shows Sign in with Google button for google-drive'`
- `'shows Sign in with Dropbox button for dropbox'`
- `'shows Sign in with Microsoft button for onedrive'`

They drive the select to an OAuth value that no longer exists as an option.

- [ ] **Step 2: Run desktop tests to see the expected failure pattern**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/ui build && pnpm --filter @keykeykey/desktop test -- SyncSettingsScreen`
Expected: PASS already if Task 3 landed (the options come from the shared ProviderSelector). If the absence assertions fail, the ProviderSelector change didn't take — fix that, not the test.

- [ ] **Step 3: Filter the RestoreScreen picker**

In `apps/desktop/src/screens/RestoreScreen.tsx`:

a) Add to the file's existing `@keykeykey/core/sync` import (or as a new import near the other core imports at the top):

```ts
import { ENABLED_SYNC_PROVIDERS } from '@keykeykey/core/sync';
```

b) Above the component (module scope), add:

```ts
const RESTORE_PROVIDER_LABELS: Record<string, string> = {
  webdav: 'WebDAV',
  'google-drive': 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
};
```

c) Replace the four hardcoded options inside `<select data-testid="restore-provider">`:

```tsx
                <option value="webdav">WebDAV</option>
                <option value="google-drive">Google Drive</option>
                <option value="dropbox">Dropbox</option>
                <option value="onedrive">OneDrive</option>
```

with:

```tsx
{
  ENABLED_SYNC_PROVIDERS.filter((p) => p !== 'none').map((p) => (
    <option key={p} value={p}>
      {RESTORE_PROVIDER_LABELS[p]}
    </option>
  ));
}
```

('none' is excluded: restoring requires an actual remote. The Google/Dropbox/OneDrive sign-in blocks and handlers further down the file stay untouched — unreachable.)

- [ ] **Step 4: Run the full desktop suite**

Run: `pnpm --filter @keykeykey/desktop test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/screens/RestoreScreen.tsx apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx
git commit -m "feat(desktop): offer only enabled sync providers in restore picker"
```

---

### Task 5: Mobile — provider radio list + tests

**Files:**

- Modify: `apps/mobile/app/settings/sync.tsx` (providers array, lines ~131-138)
- Modify: `apps/mobile/__tests__/screens/sync-settings.test.tsx` (provider list test, lines ~189-197)

- [ ] **Step 1: Update the test first**

In `apps/mobile/__tests__/screens/sync-settings.test.tsx`:

a) KEEP the `jest.mock(...)` blocks for `../../lib/google-oauth`, `../../lib/dropbox-oauth`, `../../lib/onedrive-oauth` — the screen still imports them.

b) In the provider-list test (~lines 189-197), the render helper returns `getByText`/`queryByText` from `@testing-library/react-native`. Replace:

```ts
expect(getByText('Google Drive')).toBeTruthy();
expect(getByText('Dropbox')).toBeTruthy();
expect(getByText('OneDrive')).toBeTruthy();
```

with:

```ts
expect(queryByText('Google Drive')).toBeNull();
expect(queryByText('Dropbox')).toBeNull();
expect(queryByText('OneDrive')).toBeNull();
```

(Destructure `queryByText` from the same render result; keep the existing assertions that `None (Local Only)` and `WebDAV` render.)

c) Scan the rest of the file for tests that select an OAuth provider via the UI (pressing a 'Google Drive' radio etc.) and delete them — they can no longer reach that state. Tests that exercise `lib/google-oauth` etc. directly (e.g. `__tests__/lib/google-oauth.test.ts`) stay untouched.

- [ ] **Step 2: Run mobile tests to verify the new assertions fail**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/mobile test -- sync-settings`
Expected: FAIL — 'Google Drive' still renders

- [ ] **Step 3: Filter the providers array**

In `apps/mobile/app/settings/sync.tsx`:

a) Add `isSyncProviderEnabled` to the existing `@keykeykey/core/sync` import (the file already imports `SyncProvider` type from core).

b) Replace:

```ts
const providers: { id: SyncProvider; label: string; comingSoon?: boolean }[] = [
  { id: 'none', label: 'None (Local Only)' },
  { id: 'webdav', label: 'WebDAV' },
  { id: 'google-drive', label: 'Google Drive' },
  { id: 'dropbox', label: 'Dropbox' },
  { id: 'onedrive', label: 'OneDrive' },
];
```

with:

```ts
const providers: { id: SyncProvider; label: string; comingSoon?: boolean }[] = (
  [
    { id: 'none', label: 'None (Local Only)' },
    { id: 'webdav', label: 'WebDAV' },
    { id: 'google-drive', label: 'Google Drive' },
    { id: 'dropbox', label: 'Dropbox' },
    { id: 'onedrive', label: 'OneDrive' },
  ] as { id: SyncProvider; label: string; comingSoon?: boolean }[]
).filter((p) => isSyncProviderEnabled(p.id));
```

The `startOAuth` driver, disconnect branches, and `Sign in with …` buttons below stay untouched (unreachable).

- [ ] **Step 4: Run the full mobile suite**

Run: `pnpm --filter @keykeykey/mobile test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/settings/sync.tsx apps/mobile/__tests__/screens/sync-settings.test.tsx
git commit -m "feat(mobile): offer only enabled sync providers in settings"
```

---

### Task 6: Extension — restore picker, manifest, tests

**Files:**

- Modify: `apps/extension/src/popup/screens/RestoreScreen/ProviderStep.tsx` (options, lines ~99-102)
- Modify: `apps/extension/manifest.chrome.json` (remove `oauth2` block, lines 3-6)
- Modify: `apps/extension/src/popup/screens/SyncSettingsScreen.test.tsx` (OAuth cases, lines ~95-309)

- [ ] **Step 1: Update the tests first**

In `apps/extension/src/popup/screens/SyncSettingsScreen.test.tsx`, DELETE these ten tests:

- `'shows Google Drive as an enabled option'`
- `'shows Sign in with Google button when google-drive is selected'`
- `'sends GOOGLE_OAUTH_CONNECT when Sign in with Google is clicked'`
- `'shows connected state when provider is google-drive'`
- `'shows Dropbox as an enabled option'`
- `'shows OneDrive as an enabled option'`
- `'shows Sign in with Dropbox button when dropbox is selected'`
- `'shows Sign in with OneDrive button when onedrive is selected'`
- `'sends DROPBOX_OAUTH_CONNECT when Sign in with Dropbox is clicked'`
- `'sends ONEDRIVE_OAUTH_CONNECT when Sign in with OneDrive is clicked'`

In their place add one absence test (reuse the file's existing render/mock helpers, matching the style of the deleted `'shows Google Drive as an enabled option'` test):

```tsx
it('offers only None and WebDAV as provider options', async () => {
  renderSyncSettings(); // use this file's existing helper for mounting the screen
  await screen.findByTestId('sync-provider');
  const options = screen.getAllByRole('option').map((o) => o.textContent);
  expect(options).toEqual(['None', 'WebDAV']);
});
```

Any other test in the file that drives the select to an OAuth value must be deleted too; tests covering webdav/none flows stay.

- [ ] **Step 2: Run extension tests to verify the new test fails**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/ui build && pnpm --filter @keykeykey/extension test -- SyncSettingsScreen`
Expected: the new absence test FAILS (5 options render) — it passes once Task 3's ProviderSelector change is in the built `@keykeykey/ui`. If Task 3 is already built, expected: PASS.

- [ ] **Step 3: Filter the ProviderStep picker**

In `apps/extension/src/popup/screens/RestoreScreen/ProviderStep.tsx`:

a) Add the import (alongside the existing `SyncProvider` type import from `@keykeykey/core/sync`):

```ts
import { ENABLED_SYNC_PROVIDERS } from '@keykeykey/core/sync';
```

b) Above the component (module scope), add:

```ts
const RESTORE_PROVIDER_LABELS: Record<string, string> = {
  webdav: 'WebDAV',
  'google-drive': 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
};
```

c) Replace the four hardcoded options inside `<select data-testid="restore-provider">`:

```tsx
          <option value="webdav">WebDAV</option>
          <option value="google-drive">Google Drive</option>
          <option value="dropbox">Dropbox</option>
          <option value="onedrive">OneDrive</option>
```

with:

```tsx
{
  ENABLED_SYNC_PROVIDERS.filter((p) => p !== 'none').map((p) => (
    <option key={p} value={p}>
      {RESTORE_PROVIDER_LABELS[p]}
    </option>
  ));
}
```

The OAuth sign-in blocks below (lines ~155-272) and the background handlers/router stay untouched.

- [ ] **Step 4: Remove the oauth2 block from the Chrome manifest**

In `apps/extension/manifest.chrome.json`, delete lines 3-6:

```json
  "oauth2": {
    "client_id": "960196785492-54nhfo9h2f8ef90j4srjdsa7tvsl4jdq.apps.googleusercontent.com",
    "scopes": ["https://www.googleapis.com/auth/drive.appdata"]
  },
```

Keep the `"identity"` permission (no install-warning string; the dormant handlers reference the API). Note: `chrome.identity.getAuthToken` (the Chrome Google path) requires this block — restoring it is step 1 of re-enabling, recorded in `docs/OAUTH_DISABLED.md` (Task 7).

- [ ] **Step 5: Run the full extension suite and build**

Run: `pnpm --filter @keykeykey/extension test && pnpm --filter @keykeykey/extension build`
Expected: tests PASS; build succeeds. Verify the built manifest:

Run: `grep -c oauth2 apps/extension/dist-chrome/manifest.json || echo CLEAN`
Expected: `CLEAN` (or grep exits 1 with count 0)

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/popup/screens/RestoreScreen/ProviderStep.tsx apps/extension/manifest.chrome.json apps/extension/src/popup/screens/SyncSettingsScreen.test.tsx
git commit -m "feat(extension): WebDAV-only pickers, drop oauth2 manifest block"
```

---

### Task 7: Documentation scrub + dev note

**Files:**

- Create: `docs/OAUTH_DISABLED.md`
- Delete: `.oauth-redirect-urls.md`
- Modify: `README.md`, `PRESENTING_KEYKEYKEY.md`, `PRIVACY_POLICY.md`, `CONTEXT.md`, `CLAUDE.md`, `packages/core/README.md`, `apps/extension/README.md`

NOTE: mentions of "iCloud / Apple Passwords" in the **Password Import** tables (README.md line 177, PRESENTING_KEYKEYKEY.md line 66, README.md line 9) are about CSV import, not sync — leave those alone.

- [ ] **Step 1: Create `docs/OAUTH_DISABLED.md`**

```markdown
# OAuth sync providers are disabled

The Google Drive, Dropbox, and OneDrive sync adapters are **fully implemented
but disabled**. No shipped surface (UI, docs, store metadata) mentions them.
WebDAV is the only supported sync provider.

## Why

- Provider API **rate limits** make sync unreliable in normal use.
- Rate-limit workarounds make full-vault downloads (restore, fresh device)
  unacceptably slow — the per-item file layout means one request per item.

## What is dormant (do not delete)

- `packages/core/src/sync/oauth/` — PKCE, token clients for all three providers
- `packages/core/src/sync/adapters/{google-drive,dropbox,onedrive}-adapter.ts`
- `apps/desktop/src/lib/{google,dropbox,onedrive}-oauth.ts`
- `apps/mobile/lib/{google,dropbox,onedrive}-oauth.ts`
- `apps/extension/src/lib/{google,dropbox,onedrive}-oauth.ts` + background
  handlers in `apps/extension/src/background/handlers/oauth.ts` and their
  router entries
- OAuth UI blocks in the sync/restore screens (unreachable — the pickers only
  offer enabled providers)
- The `SyncConfig` schema still parses OAuth provider configs on purpose.

## The flag

`packages/core/src/sync/config/enabled-providers.ts` —
`ENABLED_SYNC_PROVIDERS = ['none', 'webdav']`. Every picker filters through it
and `createAdapterFromConfig` throws `SyncAdapterUnsupportedError` for
anything not listed.

## Re-enable checklist

1. Add the provider(s) back to `ENABLED_SYNC_PROVIDERS`.
2. Restore the `oauth2` block in `apps/extension/manifest.chrome.json`
   (required by `chrome.identity.getAuthToken`):
   client_id `960196785492-54nhfo9h2f8ef90j4srjdsa7tvsl4jdq.apps.googleusercontent.com`,
   scope `https://www.googleapis.com/auth/drive.appdata`.
3. Extension OAuth redirect URLs that must stay registered with each provider:
   - Firefox: `https://3c49e7b76ea3e960825fdf27877252c3f6775139.extensions.allizom.org/`
     (derived from gecko.id `keykeykey@keykeykey.app`)
   - Chrome: `https://gcncigogpcmiibpfijffmhgebjhbfaio.chromiumapp.org/`
   - Safari: not supported — `browser.identity.launchWebAuthFlow` unavailable
4. Restore provider tests (git history: the commits in this change deleted
   them) and docs/privacy-policy sections.
5. Re-test rate-limit behavior before shipping — the reason for disabling.
```

- [ ] **Step 2: Delete `.oauth-redirect-urls.md`**

```bash
git rm .oauth-redirect-urls.md
```

- [ ] **Step 3: README.md**

a) Line 10 — replace:

```markdown
- **BYOC Sync** — Bring Your Own Cloud — sync encrypted vaults across devices via WebDAV, Google Drive, or iCloud with tombstone-based conflict resolution
```

with:

```markdown
- **BYOC Sync** — Bring Your Own Cloud — sync encrypted vaults across devices via your own WebDAV server with tombstone-based conflict resolution
```

b) Line 119 — replace:

```markdown
        sync/          # SyncEngine, adapters (WebDAV, Google Drive, iCloud), tombstones
```

with:

```markdown
        sync/          # SyncEngine, WebDAV adapter, tombstones
```

c) Cloud Sync table (lines ~160-164) — replace:

```markdown
| Provider     | Platforms                   | Auth        |
| ------------ | --------------------------- | ----------- |
| WebDAV       | All (HTTPS enforced)        | Basic Auth  |
| Google Drive | All (`appDataFolder` scope) | OAuth 2.0   |
| iCloud       | iOS, macOS, Safari only     | Native APIs |
```

with:

```markdown
| Provider | Platforms            | Auth       |
| -------- | -------------------- | ---------- |
| WebDAV   | All (HTTPS enforced) | Basic Auth |
```

- [ ] **Step 4: PRESENTING_KEYKEYKEY.md**

Line 21 — replace:

```markdown
Most password managers force you onto their servers. KeyKeyKey flips the model: pick the storage you already pay for — **WebDAV**, **Google Drive**, **Dropbox**, or **OneDrive** — and your encrypted vault syncs there. Your data never touches infrastructure you don't control.
```

with:

```markdown
Most password managers force you onto their servers. KeyKeyKey flips the model: bring the storage you already control — any **WebDAV** server (Nextcloud, ownCloud, Synology, …) — and your encrypted vault syncs there. Your data never touches infrastructure you don't control.
```

- [ ] **Step 5: PRIVACY_POLICY.md**

a) Line 20 (data table row) — replace:

```markdown
| Sync configuration | Cloud provider credentials, OAuth tokens | Yes (encrypted with your DEK) | Device secure storage |
```

with:

```markdown
| Sync configuration | WebDAV server credentials | Yes (encrypted with your DEK) | Device secure storage |
```

b) Cloud Sync section (lines ~46-51) — replace:

```markdown
Sync is entirely optional and user-configured. If you enable sync, you choose one of the following providers:

- **WebDAV** (e.g., Nextcloud, ownCloud)
- **Google Drive** (app-specific folder only — scope: `drive.appdata`)
- **Dropbox** (app-specific folder only)
- **OneDrive** (app-specific folder only — scope: `Files.ReadWrite.AppFolder`)
```

with:

```markdown
Sync is entirely optional and user-configured. If you enable sync, your vault syncs to a **WebDAV** server you control (e.g., Nextcloud, ownCloud).
```

c) Delete the whole `### OAuth tokens` subsection (heading + paragraph, lines ~57-59).

d) Line ~97 — replace:

```markdown
The only third-party services contacted are the **cloud storage providers you explicitly configure** for sync (Google Drive, Dropbox, OneDrive, or your own WebDAV server). These services only receive encrypted data.
```

with:

```markdown
The only third-party service contacted is the **WebDAV server you explicitly configure** for sync. It only receives encrypted data.
```

- [ ] **Step 6: CONTEXT.md**

Lines 84-85 — replace:

```markdown
A concrete cloud-storage backend (WebDAV / Dropbox / Google Drive /
OneDrive) implementing `ISyncAdapter`. Cloud adapters extend
```

with:

```markdown
A concrete cloud-storage backend (currently WebDAV) implementing
`ISyncAdapter`. Blob-style cloud adapters extend
```

- [ ] **Step 7: CLAUDE.md**

Line 105 — replace:

```markdown
- `@keykeykey/core/sync` — BYOC sync adapters (WebDAV, Google Drive, Dropbox, OneDrive) with conflict resolution
```

with:

```markdown
- `@keykeykey/core/sync` — BYOC sync (WebDAV) with conflict resolution; some adapters exist but are disabled — see `docs/OAUTH_DISABLED.md` before touching sync providers
```

- [ ] **Step 8: packages/core/README.md**

In the `### sync` section (lines ~32-38), delete the `- Google Drive adapter` bullet. Result:

```markdown
BYOC (Bring Your Own Cloud) synchronization:

- `ISyncAdapter` interface
- Local filesystem adapter
- WebDAV adapter
- Conflict resolution (Last-Write-Wins per item)
```

- [ ] **Step 9: apps/extension/README.md**

a) Line 9 — replace:

```markdown
- Cloud sync via Google Drive, WebDAV, or iCloud (Safari only)
```

with:

```markdown
- Cloud sync via WebDAV
```

b) Persistence note (lines ~165-170) — replace:

```markdown
`keykeykey@keykeykey.app`. This means `browser.storage.local` persists across
extension reloads during development — you won't lose your vault when you
click "Reload" on `about:debugging`. The gecko.id also drives the OAuth
redirect URL (`https://3c49e7b76ea3e960825fdf27877252c3f6775139.extensions.allizom.org/`),
which is why OAuth providers must have that exact URL registered.
```

with:

```markdown
`keykeykey@keykeykey.app`. This means `browser.storage.local` persists across
extension reloads during development — you won't lose your vault when you
click "Reload" on `about:debugging`.
```

c) Safari note (lines ~185-187) — replace:

```markdown
> Safari currently uses the Chrome build (`dist-chrome/`). A dedicated Safari
> target may be added in the future — Safari's OAuth limitations (no
> `launchWebAuthFlow`) make the Chrome manifest close enough for now.
```

with:

```markdown
> Safari currently uses the Chrome build (`dist-chrome/`). A dedicated Safari
> target may be added in the future.
```

d) Project structure (line ~335) — replace:

```markdown
manifest.chrome.json # Chrome-only overrides (key, oauth2, offscreen, service_worker)
```

with:

```markdown
manifest.chrome.json # Chrome-only overrides (key, offscreen, service_worker)
```

e) Project structure (lines ~357-359) — delete the three lines:

```markdown
      google-oauth.ts      # Google OAuth (Chrome: getAuthToken, Firefox: PKCE)
      dropbox-oauth.ts     # Dropbox OAuth via launchWebAuthFlow
      onedrive-oauth.ts    # OneDrive OAuth via launchWebAuthFlow
```

- [ ] **Step 10: Verify the scrub**

Run: `grep -rn -i "google drive\|dropbox\|onedrive\|oauth" --include='*.md' . --exclude-dir=node_modules --exclude-dir=graphify-out --exclude-dir=docs | grep -v -i "apple passwords\|icloud / apple"`
Expected: no hits outside `docs/OAUTH_DISABLED.md`, `docs/superpowers/`, and historical audit docs (`docs/STATUS_AUDIT*`). Anything else found: scrub it.

- [ ] **Step 11: Commit**

```bash
git add -A README.md PRESENTING_KEYKEYKEY.md PRIVACY_POLICY.md CONTEXT.md CLAUDE.md packages/core/README.md apps/extension/README.md docs/OAUTH_DISABLED.md
git commit -m "docs: WebDAV is the only supported sync provider"
```

---

### Task 8: Full verification + rebuild

- [ ] **Step 1: Full build, tests, lint, format**

Run: `pnpm build && pnpm test && pnpm lint && pnpm format:check`
Expected: all PASS. Fix anything that fails (per project policy: fix, never skip).

- [ ] **Step 2: Critical E2E**

Run: `cd e2e && npx playwright test --grep @critical`
Expected: PASS (the critical flows use WebDAV/local-only; the `sync-provider` and `restore-provider` testids still exist).

- [ ] **Step 3: Rebuild apps for the user**

`pnpm build` (Step 1) already produced fresh `dist/` outputs for core/ui/desktop-frontend/extension. Confirm the extension bundles exist: `ls apps/extension/dist-chrome/manifest.json`.

- [ ] **Step 4: Final commit if anything changed during verification**

```bash
git status --short   # commit any stragglers with an appropriate type(scope): message
```
