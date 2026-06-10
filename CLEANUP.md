# Architecture Cleanup — Deepening Candidates

Findings from `/improve-codebase-architecture` on 2026-04-29. Goal of each item
is to turn a **shallow** module (interface ~ as complex as the implementation)
into a **deep** one (a lot of behaviour behind a small, honest interface).

Vocabulary: _module / interface / implementation / depth / seam / adapter /
leverage / locality_ — see `~/.claude/skills/improve-codebase-architecture/LANGUAGE.md`.

Status legend: `[ ]` open · `[x]` done · `[~]` in progress · `[-]` rejected (see ADR).

---

## 1. Sync adapter seam leaks "not-found" semantics — `[x]`

_Done 2026-04-29 on `refactor/sync-adapter-error-contract`. Three new hooks
on the adapter base classes — `providerName` (uniform error names),
`isAuthFailure` (default 401/403; overridden by some adapters), and
`isNotFound` (default 404; overridden where the provider uses a different
error shape) — plus a `handleNotFound(res, op)` helper and a
`throwIfError(res, op)` helper. Each adapter now declares its identity
once via `providerName` and lets the shared shape do the rest. The
disabled cloud adapters shed significant duplicated error boilerplate (see
docs/OAUTH_DISABLED.md), so a new HTTP adapter author has a clear path:
implement the 4 primitives + `providerName`. Public `ISyncAdapter` API
unchanged; all 959 core / 83 desktop / 226 extension tests pass._

**Files:** `packages/core/src/sync/adapters/base-http-adapter.ts`,
`webdav-adapter.ts`, and the disabled cloud adapters (see docs/OAUTH_DISABLED.md)

**Problem.** The template-method base looks like a real seam — subclasses
override `downloadBlob` / `uploadBlob` / `deleteBlob` / `listBlobsRaw`. But the
interface of "this blob doesn't exist" is **not** part of the contract: the
cloud adapters use provider-specific error shapes (see docs/OAUTH_DISABLED.md),
and WebDAV does its own thing. Each adapter re-implements `isNotFound`. Deletion
test: removing the base wouldn't concentrate complexity — each adapter already
has its own error-handling spine.

**Deepening direction.** Either pull error-shape normalization _into_ the seam
so the base owns the contract, or admit the adapters don't share enough and
fold the base back. Two of the blob-template adapters fit one shape, two fit
another — possibly two seams, not one.

---

## 2. `PlatformStorage` is a narrow seam under wide platform divergence — `[-]`

_Rejected 2026-04-30 — see [ADR-0001](docs/adr/0001-platformstorage-is-narrow-on-purpose.md).
The original framing was a misread: PlatformStorage is conformance-tested and
honestly narrow; the apparent "wide divergence" is in non-sync state
(biometric DEK, PIN, settings) that has different threat-model semantics on
each platform and rightfully has no shared seam. The desktop fetch-proxy
install — sometimes confused for this disease — is candidate #6._

**Files:** `packages/core/src/sync/lifecycle/platform-storage.ts`,
`apps/extension/src/background/storage.ts`, `apps/desktop/src/lib/sync.ts`,
mobile (different shape entirely)

**Problem.** 8-method KV-ish contract. What callers actually do _alongside_
storage diverges: extension carries legacy unencrypted-config migration in
adapter code, desktop bundles a fetch-proxy install step, mobile doesn't even
use the same factory shape. The seam is too narrow — "one adapter satisfies
it" is actually "one adapter plus app-side ceremony the contract doesn't
admit."

**Deepening direction.** Widen the interface to include lifecycle hooks
(setup / teardown / migrations) the platform owns, or push platform-specific
ceremony out of `createXPlatformStorage` into a sibling module so storage
stays narrow and honest.

---

## 3. `vaultStore` is a fat module hiding three concerns — `[x]`

_Done 2026-04-29 on `refactor/vault-store-split`. Extracted `dek-holder.ts`
(DEK lifecycle + zeroize) and `vault-decryptor.ts` (silent-skip-on-corruption
loop, policy now documented in the module). Public API unchanged; all 959
core tests + 83 desktop + 226 extension tests pass. `vault-store.ts` shrunk
from 369 → 338 lines; 12 new focused tests added for the extracted modules._

**File:** `packages/core/src/store/vault-store.ts` (~370 lines)

**Problem.** Holds DEK in a closure, owns the lock/unlock state machine, owns
the per-item decryption loop, owns search, owns add/update/delete, forwards to
two crypto entry points (`unlockVault` / `unlockVaultWithRecovery`). Locality
is real, but inside the module three things are tangled: DEK lifecycle, the
decrypt-all-items loop, and store state. Bugs in one (e.g. one bad item killing
the whole unlock) can't be tested in isolation through the current interface.

**Deepening direction.** A `DEKHolder` (zeroize on lock, single writer) and a
`vaultDecryptor` (loop with skip/quarantine policy) sitting _behind_ the store
would shrink the store's interface without flattening into pass-throughs. Both
should pass the deletion test — kill them and the orchestration logic would
have to reappear inside the store's methods.

---

## 4. Biometric: shallow core interface with logic scattered into each app — `[x]`

\_Done 2026-04-29 on `refactor/biometric-dek-protector`. Re-seamed: a thinner
`OSBiometricStore` interface (bytes I/O + discriminated `LoadBytesResult`)
is the platform contract; `createBiometricAdapter(store)` in core composes
it with the JSON+base64 envelope, 14-day `MAX_DEK_AGE_MS` policy,
auto-clear-on-invalidate handshake, and `LoadBytesResult → BiometricResult`
mapping. Mobile and desktop adapters became thin RPC + error-mapping layers
(~30 LOC each) plus mobile's iOS-only sibling-fingerprint side effect.
Dropped the redundant `dekFingerprint` field from the mobile JSON envelope.
Cancel/invalidated decisions now live in each platform's store
implementation (no string-matching in core). 19 new core tests; existing
mobile/desktop suites unchanged. CONTEXT.md seeded with `BiometricDEKProtector`

- `OSBiometricStore` definitions.\_

**Files:** `packages/core/src/biometric/biometric-adapter.ts` (37 lines,
interface only), `apps/desktop/src/lib/desktop-biometric-adapter.ts`,
`apps/mobile/lib/biometric-adapter.ts`,
`apps/desktop/src-tauri/src/biometric_cmds/{macos,stub}.rs`

**Problem.** Core "interface" is shallow — just a discriminated union return
type. Real cross-platform invariants — DEK age (`MAX_DEK_AGE_MS = 14 days`),
DEK ↔ JSON+base64 codec, "biometrics changed → invalidate" — are duplicated in
mobile and desktop adapters. Native dispatcher (`biometric_cmds.rs`) is thin
ceremony around a macOS-only impl with a stub for everything else. Will
worsen the moment Windows Hello or Android Keystore lands.

**Deepening direction.** Move age policy + DEK codec into core; let platform
adapters be RPC-thin (call-and-discriminate, no logic). Re-pose the seam: is
it "biometric DEK protector" (depth = the protector's invariants) or "OS
biometric prompt" (depth = the prompt UX)? They're not the same module.

---

## 5. Tauri command surface has no ownership pattern — `[-]`

_Rejected 2026-04-30 — see [ADR-0002](docs/adr/0002-tauri-command-set-stays-flat.md).
`tauri::generate_handler!` is a compile-time macro that requires every handler
name to be statically present at the call site, so a `TauriModule` dispatcher
can't replace the flat list. The remaining half (setup-closure cleanup) is too
small to be worth an abstraction at today's command count. Revisit when the
set crosses ~50 commands._

**Files:** `apps/desktop/src-tauri/src/lib.rs` and per-feature modules
(`http_proxy`, `biometric_cmds`, `keyring`, `argon2`, `storage`)

**Problem.** Commands registered as a flat `invoke_handler!` list. Some are
stateless, some carry `&State<T>`, some hide module-level state. `setup`
initializes some of it; the rest is implicit. There is no module abstraction —
adding a stateful command requires touching three places. Worth it only if the
command set will keep growing.

**Deepening direction.** A `TauriModule`-shaped trait (name + setup-returning-
state + handlers list) would give each feature a real interface and make
`lib.rs` a dispatcher.

---

## 6. Desktop fetch proxy is an implicit precondition of sync — `[x]`

_Done 2026-04-30 on `refactor/desktop-fetch-proxy-split`. The original
"implicit precondition" framing turned out to be overstated — `setSyncUrlPrefix`
is already in `PlatformStorage` and wired through `SyncLifecycle`, and
`installFetchProxy()` is called at line 10 of `main.tsx` (the standard React
init pattern, not buried). Real friction was a fat 254-line `sync.ts` mixing
storage adapter + 200 lines of fetch-proxy logic, three module-level globals
(`originalFetch`, `allowedUrlPrefix`, `schemeDowngradeDetected`), and zero
tests. Split into `apps/desktop/src/lib/fetch-proxy.ts` (factory +
module-singleton, deps-injectable for testing) and a slim 70-line `sync.ts`.
Local base64 helpers replaced with `@keykeykey/core/utils`. 24 new tests
cover marshalling (string / Uint8Array / ArrayBuffer / ReadableStream
bodies; Headers / array / object headers; URL / Request inputs), null-body
status handling, scheme-downgrade detection + flag lifecycle + internal-
header filtering, statusText mapping, and install-time fetch capture.
Public API of the module unchanged (production callers updated to import
from the new path)._

**File:** `apps/desktop/src/lib/sync.ts`

**Problem.** Sync only works on desktop if `installFetchProxy()` and
`setSyncUrlPrefix(prefix)` are both called before any adapter request. Neither
is part of `PlatformStorage` or `ISyncAdapter`. Skipping them produces silent
CORS failures, not a typed error. Same disease as #2 (narrow seam, app-layer
ceremony).

**Deepening direction.** Either fold proxy install into a desktop-specific
`setupSync()` that returns a wired runtime, or hoist "request transport" into
core so all adapters take a transport — and desktop hands them a Tauri-backed
one. The second is the deeper move.

---

## Skipped

- **Base64 codec duplicated in `apps/desktop/src/lib/sync.ts` and
  `apps/desktop/src/lib/tauri-argon2-adapter.ts`.** Real duplication, but it's
  a visibility/import fix (use `@keykeykey/core/utils`), not architecture.
