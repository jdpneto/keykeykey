# Native Argon2id Adapter — Implementation Plan

## Context

Vault creation on mobile (Pixel 10 Pro) takes **20-60 seconds** because `createVaultHeader()` calls `deriveKEK()` twice (master password + recovery key), each using pure-JS `@noble/hashes/argon2` on Hermes. The mobile preset (`t:2, m:19456, p:1`) takes 10-30s per derivation in pure JS. Target: **<2s total**.

## Strategy

1. **Adapter pattern**: Inject a platform-specific Argon2id implementation via a global singleton
2. **Native module**: Expo native module wrapping the reference C `libargon2` for iOS (Swift) and Android (Kotlin + JNI)
3. **JS fallback**: `@noble/hashes/argon2` remains the default for tests, browser extension, and desktop
4. **Parallel derivation**: The two `deriveKEK` calls in `createVaultHeader` run concurrently via `Promise.all`

## Architecture

```
setArgon2Adapter(nativeAdapter)   ← called once at mobile app startup
        │
        ▼
┌─────────────────────┐
│  Argon2Adapter      │  (interface: hash(pwd, salt, params) → Promise<Uint8Array>)
├─────────────────────┤
│ JS fallback         │  ← @noble/hashes/argon2 (tests, browser, desktop)
│ Native iOS (Swift)  │  ← libargon2 C via DispatchQueue.global
│ Native Android (Kt) │  ← libargon2 C via JNI + coroutines
└─────────────────────┘
        │
        ▼
  deriveKEK() → async, uses getArgon2Adapter()
        │
        ▼
  vault-header.ts functions → all async
  vault-store.ts unlock()  → async
```

## Files to Create

### 1. `packages/core/src/crypto/argon2-adapter.ts` (NEW)

Adapter interface + JS fallback + global singleton:

```typescript
import { argon2id } from '@noble/hashes/argon2';
import type { Argon2Params } from './constants.js';

export interface Argon2Adapter {
  hash(password: Uint8Array, salt: Uint8Array, params: Argon2Params): Promise<Uint8Array>;
}

export const jsArgon2Adapter: Argon2Adapter = {
  async hash(password, salt, params) {
    return argon2id(password, salt, { t: params.t, m: params.m, p: params.p, dkLen: params.dkLen });
  },
};

let currentAdapter: Argon2Adapter = jsArgon2Adapter;

export function setArgon2Adapter(adapter: Argon2Adapter): void {
  currentAdapter = adapter;
}

export function getArgon2Adapter(): Argon2Adapter {
  return currentAdapter;
}
```

### 2. `packages/expo-argon2/` (NEW — Expo native module)

```
packages/expo-argon2/
  package.json
  expo-module.config.json
  src/index.ts
  ios/
    ExpoArgon2Module.swift     # Calls argon2id_hash_raw via DispatchQueue.global
    ExpoArgon2.podspec
    argon2/                    # Vendored C source from reference impl
  android/
    build.gradle
    CMakeLists.txt             # Compiles vendored C source
    src/main/java/expo/modules/argon2/
      ExpoArgon2Module.kt     # Kotlin + coroutines, loads libargon2jni
    jni/argon2_jni.c           # JNI bridge to argon2id_hash_raw
```

### 3. `apps/mobile/lib/native-argon2-adapter.ts` (NEW)

Bridges the Expo native module to the `Argon2Adapter` interface using base64 for binary transport.

### 4. `packages/core/src/crypto/argon2-adapter.test.ts` (NEW)

Tests for adapter singleton behavior and JS fallback correctness.

## Files to Modify

### 5. `packages/core/src/crypto/kdf.ts`

- `deriveKEK()` becomes **async**, returns `Promise<Uint8Array>`
- Remove direct `import { argon2id }` — use `getArgon2Adapter()` instead
- Validation (salt length, dkLen) stays synchronous before the async call
- Password bytes still zeroed in `finally` block

### 6. `packages/core/src/crypto/vault-header.ts`

All 4 public functions become **async**:

| Function | Change |
|---|---|
| `createVaultHeader()` | `async`, returns `Promise<CreateVaultResult>`. Two `deriveKEK` calls run in parallel via `Promise.all` |
| `unlockVault()` | `async`, returns `Promise<Uint8Array>` |
| `unlockVaultWithRecovery()` | `async`, returns `Promise<Uint8Array>` |
| `changeMasterPassword()` | `async`, returns `Promise<VaultHeader>` |

`serializeVaultHeader` and `deserializeVaultHeader` stay synchronous (no KDF).

### 7. `packages/core/src/store/vault-store.ts`

- `unlock()` action becomes `async` — `await unlockVault(...)` then `set()`
- `unlockWithRecovery()` becomes `async` — same pattern
- `VaultActions` type updated: `unlock: (...) => Promise<void>`

### 8. `packages/core/src/crypto/index.ts`

Add new exports:

```typescript
export { setArgon2Adapter, jsArgon2Adapter } from './argon2-adapter.js';
export type { Argon2Adapter } from './argon2-adapter.js';
```

### 9. `apps/mobile/lib/vault-context.tsx`

- Add `await` to `createVaultHeader(...)` call (line 102)
- Add `await` to `store.getState().unlock(...)` call (line 110)
- Wire up native adapter at module load: `setArgon2Adapter(nativeArgon2Adapter)`

### 10. `apps/mobile/package.json`

Add dependency: `"expo-argon2": "workspace:*"`

### 11. Test files (mechanical async/await migration)

| File | Changes |
|---|---|
| `packages/core/src/crypto/kdf.test.ts` | All 13 tests: add `async`/`await`, error tests use `rejects.toThrow()` |
| `packages/core/src/crypto/vault-header.test.ts` | ~13 tests that call KDF functions: add `async`/`await` |
| `packages/core/src/store/vault-store.test.ts` | `beforeEach` + unlock tests become async |
| `packages/core/src/sync/sync-conflict.test.ts` | `makeTwoDevices()` helper becomes async, all callers add `await` |
| `packages/core/src/crypto/crypto.bench.ts` | Bench functions become async |

## Implementation Order

Each step keeps the codebase building and tests passing:

| Step | What | Risk |
|---|---|---|
| 1 | Create `argon2-adapter.ts` + test + exports | None — additive only |
| 2 | Make `deriveKEK` async, update `kdf.test.ts` | Low — mechanical |
| 3 | Make vault-header functions async + `Promise.all`, update tests | Low — mechanical |
| 4 | Make vault store `unlock`/`unlockWithRecovery` async, update tests | Low — mechanical |
| 5 | Update mobile `vault-context.tsx` (add awaits) | Low — already async |
| 6 | Build `packages/expo-argon2` native module (iOS + Android) | Medium — native code |
| 7 | Create `native-argon2-adapter.ts`, wire up `setArgon2Adapter` at startup | Low |
| 8 | Benchmark on real devices, tune params if needed | None |

## Expected Performance

| Scenario | Before (pure JS/Hermes) | After (native C) |
|---|---|---|
| Single `deriveKEK` (mobile preset) | 10-30s | 0.3-0.8s |
| `createVaultHeader` (2x serial) | 20-60s | N/A |
| `createVaultHeader` (2x parallel) | N/A | 0.3-0.8s (wall clock) |
| `unlockVault` (single derivation) | 10-30s | 0.3-0.8s |

With native C + `Promise.all` parallelism, vault creation should be **<1s** on a Pixel 10 Pro.

## Risk Mitigation

- **Test regressions**: JS fallback means identical code paths in tests — no behavioral change, just async/await wrapping
- **Zustand async**: Store actions can be async; `set()` after `await` is safe for vanilla Zustand
- **CI**: Core tests use JS fallback, never touch native code. Native module only built for mobile app
- **Memory (parallel)**: Two concurrent derivations use ~38 MiB — negligible on modern phones
- **Fallback if adapter not set**: JS adapter is the default. Add `console.warn` on React Native if JS fallback is used (signals missing native setup)

## Verification

1. `cd packages/core && pnpm test` — all core tests pass with async migration
2. `cd packages/core && pnpm bench` — benchmarks run with async deriveKEK
3. Build mobile app: `cd apps/mobile && npx expo prebuild && npx expo run:android`
4. On-device test: create vault, measure time (should be <1s)
5. On-device test: lock and unlock vault, measure time (should be <0.8s)
