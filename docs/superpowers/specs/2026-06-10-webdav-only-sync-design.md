# WebDAV-only sync: hide OAuth providers behind a flag

**Date:** 2026-06-10
**Status:** Approved

## Problem

The OAuth-based BYOC providers (Google Drive, Dropbox, OneDrive) are not viable in
practice: provider rate limits make sync unreliable, and working around them makes
full-vault downloads unacceptably slow. The product decision is to support **WebDAV
only** (plus local-only "None") in every shipped version of the application.

The OAuth implementation code must **remain in the repository** — compiled, lint-clean,
and re-enableable — but no user-visible surface (UI, store metadata, docs, marketing,
privacy policy) may mention OAuth or the three providers.

## Decisions (settled with the user)

1. **Hiding method: feature flag.** A single shared constant in core gates which
   providers the UI offers and which adapters the sync engine will instantiate.
2. **No migration.** There are no real installs with OAuth configs; no fallback logic
   for stored configs pointing at a disabled provider beyond the engine refusing to
   instantiate the adapter.
3. **Docs: scrub everything, keep one dev note.** All markdown loses provider/OAuth
   mentions; a single internal note documents that the code exists, why it is off, and
   how to re-enable it.
4. **Tests: assert absence only.** UI tests verify only None/WebDAV are offered; OAuth
   UI test cases and mocks are deleted. Core OAuth unit tests stay untouched.

## Design

### 1. Flag (packages/core)

New module `packages/core/src/sync/config/enabled-providers.ts`:

```ts
export const ENABLED_SYNC_PROVIDERS = ['none', 'webdav'] as const;
export function isSyncProviderEnabled(provider: SyncProvider): boolean;
```

- Exported via the existing `@keykeykey/core/sync` entry point.
- The `SyncProvider` type union and the Zod `provider` enum in `sync-config.ts` are
  **unchanged** — stored configs still parse, OAuth code still compiles.
- The adapter factory in `sync-engine.ts` checks `isSyncProviderEnabled()` first and
  throws `SyncAdapterUnsupportedError` for disabled providers. Adapter imports and
  branches remain.

### 2. UI surfaces

All pickers derive their options by filtering through `ENABLED_SYNC_PROVIDERS`:

- `packages/ui/src/components/sync-settings/ProviderSelector.tsx` — option list filtered;
  OAuth sign-in block remains in code (unreachable).
- `apps/desktop/src/screens/SyncSettingsScreen.tsx` and `RestoreScreen.tsx` — restore
  provider `<select>` filtered; `startOAuth`, sign-in blocks, disconnect branches remain.
- `apps/mobile/app/settings/sync.tsx` — provider radio list filtered; OAuth driver and
  sign-in buttons remain.
- `apps/extension/src/popup/screens/SyncSettingsScreen/SyncSettingsScreen.tsx` and
  `RestoreScreen/ProviderStep.tsx` — same treatment.
- Extension background OAuth handlers and router entries stay registered (inert, not
  user-visible).

Rationale for leaving the conditional OAuth blocks in place: a disabled provider can
never be selected, so the blocks are dead but compiling. Re-enabling is a one-line edit
to `ENABLED_SYNC_PROVIDERS`.

### 3. Extension manifest

Remove the `oauth2` block (Google client ID + `drive.appdata` scope) from
`apps/extension/manifest.chrome.json`. It is user-visible in Chrome Web Store review and
install-time permissions. Restoring it is documented as a re-enable step.

### 4. Documentation

Scrub all mentions of OAuth / Google Drive / Dropbox / OneDrive from:

- `README.md` (BYOC + architecture sections → WebDAV only)
- `PRESENTING_KEYKEYKEY.md` (marketing copy)
- `PRIVACY_POLICY.md` (provider data-handling sections → WebDAV only)
- `CONTEXT.md`, `CLAUDE.md`, `packages/core/README.md`, `apps/extension/README.md`

Create `docs/OAUTH_DISABLED.md` — the single internal note:

- Why OAuth providers are disabled (rate limiting; unacceptably slow full-vault sync).
- Where the flag lives and what is dormant (core adapters, oauth/ module, per-app
  oauth starters, extension background handlers).
- Re-enable checklist: extend `ENABLED_SYNC_PROVIDERS`, restore the manifest `oauth2`
  block, redirect-URL registrations (content absorbed from `.oauth-redirect-urls.md`,
  which is deleted).

`CLAUDE.md` carries exactly one pointer line to that note.

### 5. Tests

- Desktop `SyncSettingsScreen.test.tsx`, mobile `sync-settings.test.tsx`, extension
  `SyncSettingsScreen.test.tsx`: delete OAuth option/sign-in/connect test cases and
  OAuth mocks; add assertions that the picker offers exactly None and WebDAV.
- New small unit test for `enabled-providers.ts` and for the engine rejecting a
  disabled provider (core coverage thresholds are strict: 100% stmt/line/function).
- `packages/core/src/sync/oauth/*.test.ts` untouched.
- e2e suite checked for provider references; critical path already uses WebDAV.

### Error handling

Only one new path: `SyncEngine` (or its adapter factory) throws
`SyncAdapterUnsupportedError` when asked for a disabled provider. UI can never trigger
it; it guards programmatic/stored-config paths.

### Verification

`pnpm build`, `pnpm test`, `pnpm lint`, `cd e2e && npx playwright test --grep @critical`,
then rebuild the apps (per project policy).

## Out of scope

- Deleting any OAuth implementation code.
- Migration/UX for hypothetical existing OAuth-configured installs.
- Safari/iCloud sync claims (extension README's iCloud mention is corrected as part of
  the doc scrub since it describes unsupported sync).
