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
