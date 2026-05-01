# Security Review Findings

Source scan: `/tmp/codex-security-scans/keykeykey/93b6b9a_20260501T120842Z/report.md`

This file tracks the eight prioritized findings from the full repository
security review. Work these in order unless a later finding becomes a blocker.

| #   | Status | Severity | Finding                                                                                                                        | Primary files                                                                                                                       |
| --- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fixed  | Medium   | Android autofill PIN lockout can reset because native `pin_attempts` writes are not readable by the native SecureStore reader. | `apps/mobile/plugins/autofill-service/android/SecureStoreReader.kt`, `apps/mobile/plugins/autofill-service/android/AuthActivity.kt` |
| 2   | Fixed  | Medium   | WebDAV allows `http://localhost...` prefix-confusion URLs, leaking Basic auth to attacker hosts over HTTP.                     | `packages/core/src/sync/adapters/webdav-adapter.ts`                                                                                 |
| 3   | Fixed  | Medium   | Desktop WebDAV proxy preserves `Authorization` across HTTPS to HTTP redirects.                                                 | `apps/desktop/src-tauri/src/http_proxy.rs`, `apps/desktop/src/lib/fetch-proxy.ts`                                                   |
| 4   | Fixed  | Medium   | Desktop keyring fallback silently stores PIN/biometric quick-unlock material in SQLite if OS keyring fails.                    | `apps/desktop/src-tauri/src/keyring_cmds.rs`, `apps/desktop/src/lib/keyring-storage.ts`                                             |
| 5   | Fixed  | Medium   | Legacy plaintext sync manifest fallback can delete local vault items through remote tombstones.                                | `packages/core/src/sync/core/sync-engine.ts`, `packages/core/src/sync/core/merge.ts`                                                |
| 6   | Fixed  | Medium   | Sync item hashes are stored but not enforced on pull/restore, enabling replay or swap of old valid encrypted blobs.            | `packages/core/src/sync/core/sync-engine.ts`, `packages/core/src/sync/lifecycle/restore.ts`                                         |
| 7   | Fixed  | Medium   | CI WebDAV secrets can land in uploaded E2E artifacts on failures.                                                              | `.github/workflows/ci.yml`, `e2e/playwright.config.ts`                                                                              |
| 8   | Open   | Medium   | `TURBO_TOKEN` is workflow-wide on PR jobs that execute workspace scripts.                                                      | `.github/workflows/ci.yml`, `package.json`                                                                                          |

## Finding 1 Validation

- Expo SecureStore writes the JSON field `keystoreAlias` as the keychain service
  (`key_v1`) and stores the real AndroidKeyStore key under
  `AES/GCM/NoPadding:key_v1:keystoreUnauthenticated`.
- The native reader mirrors that by deriving the real alias from
  `keystoreAlias` and `requireAuthentication`.
- Before the fix, the native writer created `expo_secure_store_pin_attempts`
  and stored that raw alias as `keystoreAlias`, so later native reads derived
  `AES/GCM/NoPadding:expo_secure_store_pin_attempts:keystoreUnauthenticated`
  and cannot load the key.
- Before the fix, `AuthActivity` treated unreadable `pin_attempts` as a missing
  counter and restored the full attempt quota.

## Finding 2 Validation

- Before the fix, `http://localhost.evil.test/vault` and
  `http://localhost@evil.test/vault` passed the WebDAV constructor's
  `startsWith('http://localhost')` exception while parsing to non-localhost
  hosts.
- The adapter now parses the URL before accepting it, rejects embedded URL
  credentials, allows cleartext HTTP only when the parsed hostname is exactly
  `localhost`, and keeps HTTPS as the normal accepted scheme.

## Finding 3 Validation

- Before the fix, the desktop WebDAV proxy accepted a same-host redirect from a
  configured HTTPS prefix to an HTTP target, then replayed the original request
  headers, including `Authorization`, on the downgraded request.
- Redirect validation now rejects HTTPS to HTTP downgrades before the redirect
  loop can send the follow-up request.
- Focused Rust coverage verifies the blocked downgrade and preserves legitimate
  same-host HTTPS redirects plus HTTP to HTTPS upgrades.

## Finding 4 Validation

- Before the fix, `save_to_keyring` wrote any key/value pair into
  `key_value_store` when the OS keyring write or round-trip verification failed,
  including `keykeykey_pin_data`, `keykeykey_pin_attempts`, and the legacy
  `keykeykey_biometric_dek` key.
- The SQLite fallback now rejects those sensitive quick-unlock keys on save,
  purges any legacy sensitive fallback rows on save/load, and still permits
  non-secret fallback keys such as `keykeykey_quick_unlock_prompt`.
- Focused Rust coverage verifies blocked sensitive saves, ignored/purged legacy
  sensitive loads, and retained non-secret fallback behavior.

## Finding 5 Validation

- Before the fix, when `vault.enc` was absent, `SyncEngine` accepted the
  plaintext legacy `manifest.json` as remote metadata and merged its
  tombstones. A crafted legacy tombstone for a valid local item ID could win the
  merge and delete the local item plus its remote blob.
- Legacy plaintext manifests are now sanitized at the migration boundary:
  item metadata can still be migrated, but tombstones are discarded before
  merge because destructive plaintext metadata is not authoritative.
- Focused sync-engine coverage verifies a future-dated legacy plaintext
  tombstone does not delete the local item, does not call `deleteItem`, and is
  omitted from the encrypted migrated manifest.

## Finding 6 Validation

- Before the fix, sync manifests stored a SHA-256 hash for each encrypted item
  blob, but `SyncEngine` and `restoreFromCloud` accepted any blob returned for a
  manifest item ID without checking it against the manifest hash.
- Sync pull and cloud restore now compute the downloaded encrypted blob hash
  against the authenticated manifest metadata. Sync pull skips mismatched remote
  blobs; full cloud restore fails closed before replacing local storage.
- Focused coverage verifies mismatched blobs are not pulled into an unlocked
  store, invalid or incomplete restore data does not delete local storage, and
  valid hashed blobs still restore normally. It also verifies a fresh no-op sync
  preserves the existing remote blob hash instead of committing a hash for
  ciphertext that was never uploaded.

## Finding 7 Validation

- Before the fix, extension E2E CI jobs passed live `KKK_WEBDAV_*` secrets into
  sync-flow tests, retained Playwright failure traces/screenshots/videos, and
  uploaded `e2e/test-results/` or Firefox `/tmp/kkk-ff-*` diagnostics with
  `if: always()`.
- Playwright now disables trace, screenshot, and video capture whenever WebDAV
  credentials are present in the test environment.
- Firefox Selenium restore diagnostics now skip screenshot and DOM HTML writes
  whenever WebDAV credentials are present.
- CI only uploads extension E2E artifacts for fork pull requests, where
  repository WebDAV secrets are unavailable and sync-flow specs self-skip.
