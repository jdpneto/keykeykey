---
status: accepted
---

# `PlatformStorage` is intentionally narrow

`PlatformStorage` (`packages/core/src/sync/lifecycle/platform-storage.ts`) is a
9-method contract covering only sync-relevant state: vault header, encrypted
items, sync config blob, vault-setup flag. It is conformance-tested across all
three platforms.

A future reviewer will notice that each app's storage module is much larger
(extension ~280 LOC, mobile ~440 LOC) than the slice exposed via
`PlatformStorage`, and may flag the gap as "narrow seam under wide platform
divergence." That gap is intentional. The non-sync state — settings, PIN data,
biometric DEK, biometric-enabled flag, iOS Keychain access groups, Android
BIOMETRIC_STRONG, Tauri keyring — has fundamentally different threat-model
semantics on each platform and is **not** synced. Pulling it behind a shared
abstraction would force every platform to satisfy the union of every other
platform's quirks (Keychain ACLs, App Group containers, browser.storage caps),
buying nothing.

The desktop fetch-proxy install (`installFetchProxy` in
`apps/desktop/src/lib/sync.ts`) is sometimes mistaken for the same disease,
but it is a separate seam — see CLEANUP.md candidate #6.

## Considered alternatives

- **Widen `PlatformStorage` to a `PlatformSecureStore`** covering biometric DEK
  and PIN data. Rejected: would couple core's sync lifecycle to platform-
  specific Keychain ACL semantics that have no business in core.
- **Add lifecycle hooks (`setup` / `teardown`) to `PlatformStorage`.** Rejected:
  the only platform that wants this is desktop (fetch proxy), and it has its
  own seam coming.
