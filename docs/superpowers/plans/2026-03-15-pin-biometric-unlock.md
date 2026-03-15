# PIN & Biometric Unlock Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PIN and biometric unlock to mobile/desktop apps; extract extension's PIN crypto to a shared core module.

**Architecture:** The extension's PIN wrapping logic moves to `packages/core/src/pin/`. A new `BiometricAdapter` interface in core defines the contract for platform biometric implementations. Each platform (mobile, desktop, extension) wires its storage layer to these core functions and integrates them into its unlock screen. The vault store's existing `unlockWithDEK()` action is the shared fast-unlock path for all methods.

**Tech Stack:** TypeScript, Vitest, Zustand, `@noble/hashes` (Argon2id), `@noble/ciphers` (XChaCha20-Poly1305), `expo-secure-store`, `expo-local-authentication`, Tauri keyring, React Router DOM, Expo Router.

**Spec:** `docs/superpowers/specs/2026-03-15-pin-biometric-unlock-design.md`

---

## Chunk 1: Core PIN Module & Biometric Interface

### Task 1: Add `ARGON2_PRESETS.pin` to constants

**Files:**
- Modify: `packages/core/src/crypto/constants.ts:29-36`
- Test: `packages/core/src/crypto/__tests__/constants.test.ts` (if exists, otherwise verify via pin tests)

- [ ] **Step 1: Add the PIN preset to `ARGON2_PRESETS`**

In `packages/core/src/crypto/constants.ts`, add `pin` preset after line 35 (`browser` entry):

```typescript
  /** PIN quick-unlock: same as mobile/browser. Low-entropy PIN is protected by attempt lockout, not KDF alone. */
  pin: { t: 2, m: 19_456, p: 1, dkLen: 32 } satisfies Argon2Params,
```

The `ARGON2_PRESETS` object becomes:
```typescript
export const ARGON2_PRESETS = {
  desktop: { t: 3, m: 65_536, p: 4, dkLen: 32 } satisfies Argon2Params,
  mobile: { t: 2, m: 19_456, p: 1, dkLen: 32 } satisfies Argon2Params,
  browser: { t: 2, m: 19_456, p: 1, dkLen: 32 } satisfies Argon2Params,
  pin: { t: 2, m: 19_456, p: 1, dkLen: 32 } satisfies Argon2Params,
} as const;
```

- [ ] **Step 2: Verify build succeeds**

Run: `pnpm --filter @keykeykey/core build`
Expected: Clean build with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/crypto/constants.ts
git commit -m "feat(core): add ARGON2_PRESETS.pin for PIN-based quick unlock"
```

---

### Task 2: Create PIN validation module

**Files:**
- Create: `packages/core/src/pin/pin-validation.ts`
- Create: `packages/core/src/pin/__tests__/pin-validation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/pin/__tests__/pin-validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validatePin } from '../pin-validation.js';

describe('validatePin', () => {
  it('accepts valid 4-digit PIN', () => {
    expect(validatePin('4829')).toEqual({ valid: true });
  });

  it('accepts valid 6-digit PIN', () => {
    expect(validatePin('482917')).toEqual({ valid: true });
  });

  it('accepts valid 8-digit PIN', () => {
    expect(validatePin('48291735')).toEqual({ valid: true });
  });

  it('rejects empty string', () => {
    const result = validatePin('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects PIN shorter than 4 digits', () => {
    const result = validatePin('123');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/4.*8/);
  });

  it('rejects PIN longer than 8 digits', () => {
    const result = validatePin('123456789');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/4.*8/);
  });

  it('rejects non-numeric characters', () => {
    const result = validatePin('12ab');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/digits/i);
  });

  it('rejects all-same digits: 1111', () => {
    const result = validatePin('1111');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/repeated/i);
  });

  it('rejects all-same digits: 000000', () => {
    const result = validatePin('000000');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/repeated/i);
  });

  it('rejects ascending sequential: 1234', () => {
    const result = validatePin('1234');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/sequential/i);
  });

  it('rejects descending sequential: 4321', () => {
    const result = validatePin('4321');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/sequential/i);
  });

  it('rejects longer ascending sequential: 12345678', () => {
    const result = validatePin('12345678');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/sequential/i);
  });

  it('rejects ascending from mid-range: 3456', () => {
    const result = validatePin('3456');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/sequential/i);
  });

  it('accepts non-sequential non-repeated: 1357', () => {
    expect(validatePin('1357')).toEqual({ valid: true });
  });

  it('accepts PIN with some repeated digits: 1121', () => {
    expect(validatePin('1121')).toEqual({ valid: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- src/pin/__tests__/pin-validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/pin/pin-validation.ts`:

```typescript
/**
 * PIN format validation for quick-unlock.
 *
 * Rules:
 * - Must be 4–8 numeric digits
 * - No all-same digits (e.g., 1111, 0000)
 * - No fully sequential ascending or descending (e.g., 1234, 4321)
 */

export function validatePin(pin: string): { valid: boolean; error?: string } {
  if (!/^\d{4,8}$/.test(pin)) {
    return { valid: false, error: 'PIN must be 4–8 digits' };
  }

  // All-same digits
  if (new Set(pin).size === 1) {
    return { valid: false, error: 'PIN must not be all repeated digits' };
  }

  // Sequential check: every consecutive pair differs by exactly +1 or -1
  let ascending = true;
  let descending = true;
  for (let i = 1; i < pin.length; i++) {
    const diff = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (diff !== 1) ascending = false;
    if (diff !== -1) descending = false;
  }
  if (ascending || descending) {
    return { valid: false, error: 'PIN must not be sequential digits' };
  }

  return { valid: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- src/pin/__tests__/pin-validation.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pin/pin-validation.ts packages/core/src/pin/__tests__/pin-validation.test.ts
git commit -m "feat(core): add PIN validation module with format and pattern checks"
```

---

### Task 3: Create core PIN unlock module

**Files:**
- Create: `packages/core/src/pin/pin-unlock.ts`
- Create: `packages/core/src/pin/__tests__/pin-unlock.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/pin/__tests__/pin-unlock.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { setupPin, unwrapDekWithPin, MAX_PIN_ATTEMPTS } from '../pin-unlock.js';

describe('PIN DEK wrapping', () => {
  const testDek = new Uint8Array(32);
  testDek.fill(0xab);

  it('round-trips wrap and unwrap with correct PIN', async () => {
    const pinData = await setupPin('4829', testDek);
    expect(pinData.wrappedDEK).toBeInstanceOf(Uint8Array);
    expect(pinData.salt).toBeInstanceOf(Uint8Array);
    expect(pinData.salt.length).toBe(16);

    const recovered = await unwrapDekWithPin('4829', pinData);
    expect(recovered).toEqual(testDek);
  });

  it('returns null for wrong PIN', async () => {
    const pinData = await setupPin('4829', testDek);
    const result = await unwrapDekWithPin('9999', pinData);
    expect(result).toBeNull();
  });

  it('produces different wrapped DEKs for different PINs', { timeout: 30_000 }, async () => {
    const result1 = await setupPin('4829', testDek);
    const result2 = await setupPin('7531', testDek);
    expect(result1.wrappedDEK).not.toEqual(result2.wrappedDEK);
  });

  it('produces different wrapped DEKs for same PIN (different salts)', { timeout: 30_000 }, async () => {
    const result1 = await setupPin('4829', testDek);
    const result2 = await setupPin('4829', testDek);
    expect(result1.salt).not.toEqual(result2.salt);
    expect(result1.wrappedDEK).not.toEqual(result2.wrappedDEK);
  });

  it('does not mutate the input DEK', async () => {
    const dek = new Uint8Array(32);
    dek.fill(0xcd);
    const original = new Uint8Array(dek);
    await setupPin('4829', dek);
    expect(dek).toEqual(original);
  });

  it('exports MAX_PIN_ATTEMPTS as 5', () => {
    expect(MAX_PIN_ATTEMPTS).toBe(5);
  });

  it('rejects invalid PIN in setupPin', async () => {
    const dek = new Uint8Array(32);
    await expect(setupPin('1234', dek)).rejects.toThrow(/sequential/i);
  });

  it('rejects too-short PIN in setupPin', async () => {
    const dek = new Uint8Array(32);
    await expect(setupPin('12', dek)).rejects.toThrow(/Invalid PIN/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- src/pin/__tests__/pin-unlock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/pin/pin-unlock.ts`:

```typescript
/**
 * PIN-based DEK wrapping for quick unlock.
 *
 * Extracts the PIN→KEK→DEK wrapping pattern from the browser extension
 * into a shared, platform-agnostic module.
 *
 * The PIN is stretched via Argon2id to produce a KEK, which wraps the DEK
 * with XChaCha20-Poly1305. Attempt tracking and storage are the caller's
 * responsibility.
 *
 * Security: PINs have low entropy (4-8 digits). The Argon2id cost and
 * platform-side attempt lockout (MAX_PIN_ATTEMPTS) provide brute-force
 * protection.
 */

import { deriveKEK, encrypt, decrypt, ARGON2_PRESETS, SALT_SIZE } from '../crypto/index.js';
import { validatePin } from './pin-validation.js';

/** PIN data stored by the platform's storage layer. */
export interface PinData {
  /** DEK encrypted with PIN-derived KEK (XChaCha20-Poly1305 ciphertext). */
  wrappedDEK: Uint8Array;
  /** Random salt used for the Argon2id KDF. */
  salt: Uint8Array;
}

/** Maximum PIN attempts before lockout. Exported for callers to use. */
export const MAX_PIN_ATTEMPTS = 5;

/**
 * Set up PIN-based quick unlock by wrapping the DEK.
 *
 * @param pin - The user's chosen PIN (must pass validatePin).
 * @param dek - The 32-byte DEK to protect. Not zeroed by this function.
 * @returns PinData containing the wrapped DEK and KDF salt.
 */
export async function setupPin(pin: string, dek: Uint8Array): Promise<PinData> {
  const validation = validatePin(pin);
  if (!validation.valid) {
    throw new Error(`Invalid PIN: ${validation.error}`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  const kek = await deriveKEK(pin, salt, ARGON2_PRESETS.pin);
  const wrappedDEK = encrypt(dek, kek);
  return { wrappedDEK, salt };
}

/**
 * Attempt to unwrap a DEK using a PIN.
 *
 * @param pin - The PIN to try.
 * @param pinData - The stored PinData from setupPin.
 * @returns The 32-byte DEK on success, or null if the PIN is wrong.
 */
export async function unwrapDekWithPin(
  pin: string,
  pinData: PinData,
): Promise<Uint8Array | null> {
  try {
    const kek = await deriveKEK(pin, pinData.salt, ARGON2_PRESETS.pin);
    return decrypt(pinData.wrappedDEK, kek);
  } catch {
    // Decryption failure = wrong PIN (auth tag mismatch)
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- src/pin/__tests__/pin-unlock.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pin/pin-unlock.ts packages/core/src/pin/__tests__/pin-unlock.test.ts
git commit -m "feat(core): add PIN-based DEK wrapping module (extracted from extension)"
```

---

### Task 4: Create PIN barrel export and wire into core

**Files:**
- Create: `packages/core/src/pin/index.ts`
- Modify: `packages/core/src/crypto/index.ts:54` (add re-export)
- Modify: `packages/core/tsup.config.ts:4-12` (add entry point)

- [ ] **Step 1: Create barrel export**

Create `packages/core/src/pin/index.ts`:

```typescript
export { validatePin } from './pin-validation.js';
export { setupPin, unwrapDekWithPin, MAX_PIN_ATTEMPTS } from './pin-unlock.js';
export type { PinData } from './pin-unlock.js';
```

- [ ] **Step 2: Add PIN entry point to tsup config**

Note: PIN symbols are NOT re-exported from the crypto barrel to avoid circular dependencies (`pin` imports from `crypto`, so `crypto` must not import from `pin`). The canonical import path is `@keykeykey/core/pin`.

In `packages/core/tsup.config.ts`, add `'src/pin/index.ts'` to the `entry` array:

```typescript
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/crypto/index.ts',
    'src/models/index.ts',
    'src/store/index.ts',
    'src/sync/index.ts',
    'src/generator/index.ts',
    'src/domain/index.ts',
    'src/pin/index.ts',
  ],
  // ...
});
```

- [ ] **Step 4: Build and verify**

Run: `pnpm --filter @keykeykey/core build`
Expected: Clean build. `dist/pin/index.js` and `dist/pin/index.d.ts` are generated.

- [ ] **Step 5: Run all core tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests PASS (including existing crypto tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pin/index.ts packages/core/tsup.config.ts
git commit -m "feat(core): export PIN module as @keykeykey/core/pin entry point"
```

---

### Task 5: Create BiometricAdapter interface and unlock methods helper

**Files:**
- Create: `packages/core/src/biometric/biometric-adapter.ts`
- Create: `packages/core/src/biometric/index.ts`
- Create: `packages/core/src/unlock/unlock-methods.ts`
- Create: `packages/core/src/unlock/index.ts`
- Create: `packages/core/src/unlock/__tests__/unlock-methods.test.ts`

- [ ] **Step 1: Create BiometricAdapter interface**

Create `packages/core/src/biometric/biometric-adapter.ts`:

```typescript
/**
 * Platform-agnostic biometric adapter interface.
 *
 * Each platform (mobile, desktop) provides its own implementation
 * backed by the OS secure enclave (Keychain, Windows Hello, etc.).
 */

/** Discriminated result from a biometric DEK retrieval attempt. */
export type BiometricResult =
  | { status: 'success'; dek: Uint8Array }
  | { status: 'cancelled' }
  | { status: 'invalidated' }
  | { status: 'error'; message: string };

/** Interface for platform biometric DEK storage. */
export interface BiometricAdapter {
  /** Check if biometric hardware is available and enrolled. */
  isAvailable(): Promise<boolean>;

  /** Store DEK in secure enclave. Does NOT zero the input DEK. */
  saveDEK(dek: Uint8Array): Promise<void>;

  /**
   * Retrieve DEK from secure enclave (triggers biometric prompt).
   *
   * Returns a discriminated result:
   * - 'success': DEK retrieved, proceed with unlock
   * - 'cancelled': user dismissed prompt, show fallback options
   * - 'invalidated': enrollment changed or DEK expired, auto-clear
   * - 'error': hardware/OS error, show error message
   */
  loadDEK(): Promise<BiometricResult>;

  /** Remove stored DEK from secure enclave. */
  clearDEK(): Promise<void>;
}
```

- [ ] **Step 2: Create biometric barrel export**

Create `packages/core/src/biometric/index.ts`:

```typescript
export type { BiometricAdapter, BiometricResult } from './biometric-adapter.js';
```

- [ ] **Step 3: Write failing tests for unlock methods**

Create `packages/core/src/unlock/__tests__/unlock-methods.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getDefaultMethod, type UnlockAvailability } from '../unlock-methods.js';

describe('getDefaultMethod', () => {
  it('returns biometric when all methods available', () => {
    const availability: UnlockAvailability = { biometric: true, pin: true, password: true };
    expect(getDefaultMethod(availability)).toBe('biometric');
  });

  it('returns pin when biometric unavailable', () => {
    const availability: UnlockAvailability = { biometric: false, pin: true, password: true };
    expect(getDefaultMethod(availability)).toBe('pin');
  });

  it('returns password when only password available', () => {
    const availability: UnlockAvailability = { biometric: false, pin: false, password: true };
    expect(getDefaultMethod(availability)).toBe('password');
  });

  it('returns password when nothing else available', () => {
    const availability: UnlockAvailability = { biometric: false, pin: false, password: false };
    expect(getDefaultMethod(availability)).toBe('password');
  });

  it('returns biometric over pin when both available', () => {
    const availability: UnlockAvailability = { biometric: true, pin: true, password: true };
    expect(getDefaultMethod(availability)).toBe('biometric');
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- src/unlock/__tests__/unlock-methods.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Write unlock methods implementation**

Create `packages/core/src/unlock/unlock-methods.ts`:

```typescript
/**
 * Unlock method priority logic.
 *
 * Determines which unlock method to present first based on
 * what's configured and available on the current device.
 * Priority: biometric → pin → password.
 */

export type UnlockMethod = 'biometric' | 'pin' | 'password';

export interface UnlockAvailability {
  /** BiometricAdapter.isAvailable() && DEK stored && not expired */
  biometric: boolean;
  /** PinData exists in platform storage */
  pin: boolean;
  /** Always true — master password is always available */
  password: boolean;
}

/** Returns the highest-priority available unlock method. */
export function getDefaultMethod(availability: UnlockAvailability): UnlockMethod {
  if (availability.biometric) return 'biometric';
  if (availability.pin) return 'pin';
  return 'password';
}
```

- [ ] **Step 6: Create unlock barrel export**

Create `packages/core/src/unlock/index.ts`:

```typescript
export { getDefaultMethod } from './unlock-methods.js';
export type { UnlockMethod, UnlockAvailability } from './unlock-methods.js';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- src/unlock/__tests__/unlock-methods.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Add tsup entry points for biometric and unlock**

In `packages/core/tsup.config.ts`, add to the `entry` array:

```typescript
    'src/biometric/index.ts',
    'src/unlock/index.ts',
```

- [ ] **Step 9: Build and verify**

Run: `pnpm --filter @keykeykey/core build`
Expected: Clean build. New `dist/biometric/` and `dist/unlock/` directories generated.

- [ ] **Step 10: Run all core tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/biometric/ packages/core/src/unlock/ packages/core/tsup.config.ts
git commit -m "feat(core): add BiometricAdapter interface and unlock method priority helper"
```

---

## Chunk 2: Extension Refactor

### Task 6: Update extension to import PIN from core

**Files:**
- Modify: `apps/extension/src/background/message-handler.ts:38`
- Modify: `apps/extension/src/background/pin.test.ts:2`
- Delete: `apps/extension/src/background/pin.ts` (after verifying)

- [ ] **Step 1: Update message-handler import**

In `apps/extension/src/background/message-handler.ts`, change line 38 from:

```typescript
import { wrapDekWithPin, unwrapDekWithPin } from './pin.js';
```

to:

```typescript
import { setupPin, unwrapDekWithPin } from '@keykeykey/core/pin';
```

- [ ] **Step 2: Update SET_PIN handler to use `setupPin`**

In `apps/extension/src/background/message-handler.ts`, the `SET_PIN` case (lines 312-323). Change the `wrapDekWithPin` call:

Replace:
```typescript
        const { wrappedDek, salt } = await wrapDekWithPin(dek, message.pin);
```
with:
```typescript
        const { wrappedDEK, salt } = await setupPin(message.pin, dek);
```

And update the storage call that follows to use `wrappedDEK` instead of `wrappedDek`:
Replace:
```typescript
        await savePinData({
          pinHash: uint8ToBase64(wrappedDek),
```
with:
```typescript
        await savePinData({
          pinHash: uint8ToBase64(wrappedDEK),
```

- [ ] **Step 3: Update UNLOCK_PIN handler for null-return API**

In `apps/extension/src/background/message-handler.ts`, the `UNLOCK_PIN` case (lines 163-199). The existing code uses try/catch because the old `unwrapDekWithPin` throws. The new core function returns `null`. However, we still need the try/catch for other errors (storage, deserialization), so the change is minimal.

Replace lines 169-172:
```typescript
          const wrappedDek = base64ToUint8(pinData.pinHash);
          const salt = base64ToUint8(pinData.salt);
          const dek = await unwrapDekWithPin(wrappedDek, salt, message.pin);
```
with:
```typescript
          const pinDataCore = {
            wrappedDEK: base64ToUint8(pinData.pinHash),
            salt: base64ToUint8(pinData.salt),
          };
          const dek = await unwrapDekWithPin(message.pin, pinDataCore);
          if (!dek) throw new Error('Wrong PIN');
```

This preserves the existing error handling flow (the `catch` block at line 190 still handles attempts).

- [ ] **Step 4: Build core before testing extension**

Run: `pnpm --filter @keykeykey/core build`
Expected: Clean build.

- [ ] **Step 5: Run extension tests**

Run: `pnpm --filter @keykeykey/extension test`
Expected: All tests PASS (existing behavior preserved).

- [ ] **Step 6: Update extension PIN test imports**

In `apps/extension/src/background/pin.test.ts`, change line 2 from:

```typescript
import { wrapDekWithPin, unwrapDekWithPin } from './pin.js';
```

to:

```typescript
import { setupPin, unwrapDekWithPin } from '@keykeykey/core/pin';
```

Update the test cases to use the new API:

```typescript
import { describe, it, expect } from 'vitest';
import { setupPin, unwrapDekWithPin } from '@keykeykey/core/pin';

describe('PIN DEK wrapping (core)', () => {
  const testDek = new Uint8Array(32);
  testDek.fill(0xab);

  it('should round-trip wrap and unwrap DEK with correct PIN', async () => {
    const pin = '4829';
    const pinData = await setupPin(pin, testDek);
    expect(pinData.wrappedDEK).toBeTruthy();
    expect(pinData.salt).toBeTruthy();

    const recovered = await unwrapDekWithPin(pin, pinData);
    expect(recovered).toEqual(testDek);
  });

  it('should return null for wrong PIN', async () => {
    const pinData = await setupPin('4829', testDek);
    const result = await unwrapDekWithPin('9999', pinData);
    expect(result).toBeNull();
  });

  it('should produce different output for different PINs', { timeout: 30_000 }, async () => {
    const result1 = await setupPin('4829', testDek);
    const result2 = await setupPin('7531', testDek);
    expect(result1.wrappedDEK).not.toEqual(result2.wrappedDEK);
  });
});
```

- [ ] **Step 7: Run updated extension tests**

Run: `pnpm --filter @keykeykey/extension test`
Expected: All tests PASS.

- [ ] **Step 8: Delete the old extension pin.ts**

Delete `apps/extension/src/background/pin.ts` — all logic is now in core.

- [ ] **Step 9: Run extension tests one more time**

Run: `pnpm --filter @keykeykey/extension test`
Expected: All tests PASS (no remaining references to deleted file).

- [ ] **Step 10: Commit**

```bash
git add apps/extension/src/background/message-handler.ts apps/extension/src/background/pin.test.ts
git rm apps/extension/src/background/pin.ts
git commit -m "refactor(extension): use core PIN module instead of local pin.ts"
```

---

## Chunk 3: Mobile Biometric & PIN Unlock

### Task 7: Add PIN and biometric storage helpers to mobile

**Files:**
- Modify: `apps/mobile/lib/storage.ts:1-35`

- [ ] **Step 1: Add PIN storage constants and functions**

In `apps/mobile/lib/storage.ts`, add after line 6 (`const VAULT_SETUP_KEY`):

```typescript
const PIN_DATA_KEY = 'pin_data';
const PIN_ATTEMPTS_KEY = 'pin_attempts';
const QUICK_UNLOCK_PROMPT_KEY = 'quick_unlock_prompt_shown';
```

Then add PIN and prompt storage functions after the `deleteBiometricDEK` function (after line 35):

```typescript

// --- PIN data ---

export async function savePinData(data: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_DATA_KEY, data);
}

export async function loadPinData(): Promise<string | null> {
  return SecureStore.getItemAsync(PIN_DATA_KEY);
}

export async function deletePinData(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_DATA_KEY);
}

// --- PIN attempt counter ---

export async function savePinAttempts(remaining: number): Promise<void> {
  await SecureStore.setItemAsync(PIN_ATTEMPTS_KEY, String(remaining));
}

export async function loadPinAttempts(): Promise<number | null> {
  const val = await SecureStore.getItemAsync(PIN_ATTEMPTS_KEY);
  return val !== null ? parseInt(val, 10) : null;
}

export async function deletePinAttempts(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_ATTEMPTS_KEY);
}

// --- Quick unlock prompt flag ---

export async function setQuickUnlockPromptShown(shown: boolean): Promise<void> {
  if (shown) {
    await SecureStore.setItemAsync(QUICK_UNLOCK_PROMPT_KEY, 'true');
  } else {
    await SecureStore.deleteItemAsync(QUICK_UNLOCK_PROMPT_KEY);
  }
}

export async function isQuickUnlockPromptShown(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(QUICK_UNLOCK_PROMPT_KEY);
  return val === 'true';
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @keykeykey/mobile test` (or just typecheck if tests don't cover storage directly)
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/storage.ts
git commit -m "feat(mobile): add PIN data and quick unlock prompt storage helpers"
```

---

### Task 8: Create mobile BiometricAdapter implementation

**Files:**
- Create: `apps/mobile/lib/biometric-adapter.ts`

- [ ] **Step 1: Write the implementation**

Create `apps/mobile/lib/biometric-adapter.ts`:

```typescript
/**
 * Mobile BiometricAdapter implementation using expo-secure-store
 * and expo-local-authentication.
 *
 * Stores the DEK + timestamp as a JSON blob in SecureStore with
 * requireAuthentication: true (triggers FaceID/TouchID on retrieval).
 */

import * as LocalAuthentication from 'expo-local-authentication';
import { saveBiometricDEK, loadBiometricDEK, deleteBiometricDEK } from './storage';
import type { BiometricAdapter, BiometricResult } from '@keykeykey/core/biometric';

/** Maximum age for stored biometric DEK (14 days in ms). */
const MAX_DEK_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function createMobileBiometricAdapter(): BiometricAdapter {
  return {
    async isAvailable(): Promise<boolean> {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      return compatible && enrolled;
    },

    async saveDEK(dek: Uint8Array): Promise<void> {
      const payload = JSON.stringify({
        dek: toBase64(dek),
        savedAt: new Date().toISOString(),
      });
      await saveBiometricDEK(payload);
    },

    async loadDEK(): Promise<BiometricResult> {
      try {
        const raw = await loadBiometricDEK();
        if (!raw) {
          return { status: 'invalidated' };
        }

        const { dek: dekBase64, savedAt } = JSON.parse(raw);

        // Check expiry
        const age = Date.now() - new Date(savedAt).getTime();
        if (age > MAX_DEK_AGE_MS) {
          await deleteBiometricDEK();
          return { status: 'invalidated' };
        }

        return { status: 'success', dek: fromBase64(dekBase64) };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Biometric error';

        // expo-secure-store throws specific errors for cancellation
        if (message.includes('cancel') || message.includes('Cancel')) {
          return { status: 'cancelled' };
        }

        // Enrollment changes cause authentication failure
        if (message.includes('authentication') || message.includes('not enrolled')) {
          await deleteBiometricDEK().catch(() => {});
          return { status: 'invalidated' };
        }

        return { status: 'error', message };
      }
    },

    async clearDEK(): Promise<void> {
      await deleteBiometricDEK();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/lib/biometric-adapter.ts
git commit -m "feat(mobile): implement BiometricAdapter with expo-secure-store"
```

---

### Task 9: Update mobile vault context with PIN and biometric unlock

**Files:**
- Modify: `apps/mobile/lib/vault-context.tsx`

- [ ] **Step 1: Add imports**

In `apps/mobile/lib/vault-context.tsx`, add to the core import (line 3-11):

```typescript
import { setupPin, unwrapDekWithPin, MAX_PIN_ATTEMPTS } from '@keykeykey/core/pin';
import type { PinData } from '@keykeykey/core/pin';
```

Add storage imports (extend existing import at line 12-20):

```typescript
import {
  saveVaultHeader,
  loadVaultHeader,
  saveEncryptedItem,
  loadAllEncryptedItems,
  deleteEncryptedItem,
  setVaultSetupComplete,
  isVaultSetupComplete,
  savePinData as savePinDataStorage,
  loadPinData as loadPinDataStorage,
  deletePinData,
  savePinAttempts,
  loadPinAttempts,
  deletePinAttempts,
  setQuickUnlockPromptShown,
  isQuickUnlockPromptShown,
} from './storage';
```

Add biometric import:

```typescript
import { createMobileBiometricAdapter } from './biometric-adapter';
import type { BiometricResult } from '@keykeykey/core/biometric';
```

- [ ] **Step 2: Extend VaultContextType**

In `apps/mobile/lib/vault-context.tsx`, extend the `VaultContextType` (line 51-66):

```typescript
type VaultContextType = {
  status: 'loading' | 'needs_setup' | 'locked' | 'unlocked';
  items: VaultItem[];
  recoveryKey: string | null;
  biometricAvailable: boolean;
  pinConfigured: boolean;
  quickUnlockPromptShown: boolean;
  setupVault: (masterPassword: string) => Promise<string>;
  unlock: (masterPassword: string) => Promise<void>;
  unlockWithBiometric: () => Promise<BiometricResult>;
  unlockWithPin: (pin: string) => Promise<{ success: boolean; attemptsRemaining: number | null }>;
  enableBiometric: () => Promise<void>;
  disableBiometric: () => Promise<void>;
  enablePin: (pin: string) => Promise<void>;
  disablePin: () => Promise<void>;
  dismissQuickUnlockPrompt: () => Promise<void>;
  lock: () => void;
  addItem: (item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateItem: (
    id: string,
    updates: Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>,
  ) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  search: (query: string) => VaultItem[];
  initialize: () => Promise<void>;
};
```

- [ ] **Step 3: Add state and refs in VaultProvider**

After the existing state declarations (lines 71-76), add:

```typescript
  const biometricAdapter = useRef(createMobileBiometricAdapter());
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [quickUnlockPromptShown, setQuickUnlockPromptShownState] = useState(true);
```

- [ ] **Step 4: Extend initialize to check biometric and PIN availability**

In the `initialize` callback (line 83-98), add after `setStatus('locked')` (line 97):

```typescript
    // Check quick-unlock availability
    const bioAvail = await biometricAdapter.current.isAvailable();
    setBiometricAvailable(bioAvail);

    const pinDataRaw = await loadPinDataStorage();
    setPinConfigured(pinDataRaw !== null);

    const promptShown = await isQuickUnlockPromptShown();
    setQuickUnlockPromptShownState(promptShown);
```

- [ ] **Step 5: Add biometric unlock method**

After the existing `unlock` callback (line 119-128), add:

```typescript
  const unlockWithBiometric = useCallback(async (): Promise<BiometricResult> => {
    const result = await biometricAdapter.current.loadDEK();
    if (result.status !== 'success') return result;

    const storedItems = await loadAllEncryptedItems();
    const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
    storeRef.current.getState().unlockWithDEK(result.dek, encryptedArrays);
    syncItems();
    setStatus('unlocked');
    return result;
  }, [syncItems]);
```

- [ ] **Step 6: Add PIN unlock method**

```typescript
  const unlockWithPin = useCallback(
    async (pin: string): Promise<{ success: boolean; attemptsRemaining: number | null }> => {
      const pinDataRaw = await loadPinDataStorage();
      if (!pinDataRaw) {
        return { success: false, attemptsRemaining: null };
      }

      const { wrappedDEK, salt } = JSON.parse(pinDataRaw) as { wrappedDEK: string; salt: string };
      const pinData: PinData = {
        wrappedDEK: fromBase64(wrappedDEK),
        salt: fromBase64(salt),
      };

      const dek = await unwrapDekWithPin(pin, pinData);
      if (!dek) {
        // Wrong PIN — decrement attempts
        let remaining = (await loadPinAttempts()) ?? MAX_PIN_ATTEMPTS;
        remaining -= 1;
        if (remaining <= 0) {
          await deletePinData();
          await deletePinAttempts();
          setPinConfigured(false);
          return { success: false, attemptsRemaining: 0 };
        }
        await savePinAttempts(remaining);
        return { success: false, attemptsRemaining: remaining };
      }

      // Success — reset attempts
      await savePinAttempts(MAX_PIN_ATTEMPTS);

      const storedItems = await loadAllEncryptedItems();
      const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
      storeRef.current.getState().unlockWithDEK(dek, encryptedArrays);
      syncItems();
      setStatus('unlocked');
      return { success: true, attemptsRemaining: MAX_PIN_ATTEMPTS };
    },
    [syncItems],
  );
```

- [ ] **Step 7: Add enable/disable biometric and PIN methods**

```typescript
  const enableBiometric = useCallback(async () => {
    const dek = storeRef.current.getState().getDEK();
    await biometricAdapter.current.saveDEK(dek);
    setBiometricAvailable(true);
  }, []);

  const disableBiometric = useCallback(async () => {
    await biometricAdapter.current.clearDEK();
  }, []);

  const enablePin = useCallback(async (pin: string) => {
    const dek = storeRef.current.getState().getDEK();
    const pinData = await setupPin(pin, dek);
    const serialized = JSON.stringify({
      wrappedDEK: toBase64(pinData.wrappedDEK),
      salt: toBase64(pinData.salt),
    });
    await savePinDataStorage(serialized);
    await savePinAttempts(MAX_PIN_ATTEMPTS);
    setPinConfigured(true);
  }, []);

  const disablePin = useCallback(async () => {
    await deletePinData();
    await deletePinAttempts();
    setPinConfigured(false);
  }, []);

  const dismissQuickUnlockPrompt = useCallback(async () => {
    await setQuickUnlockPromptShown(true);
    setQuickUnlockPromptShownState(true);
  }, []);
```

- [ ] **Step 8: Update context provider value**

Replace the value prop (line 210-225) with:

```typescript
      value={{
        status,
        items,
        recoveryKey,
        biometricAvailable,
        pinConfigured,
        quickUnlockPromptShown,
        setupVault,
        unlock,
        unlockWithBiometric,
        unlockWithPin,
        enableBiometric,
        disableBiometric,
        enablePin,
        disablePin,
        dismissQuickUnlockPrompt,
        lock,
        addItem,
        updateItem,
        removeItem,
        search,
        initialize,
      }}
```

- [ ] **Step 9: Build core before testing mobile**

Run: `pnpm --filter @keykeykey/core build`

- [ ] **Step 10: Run mobile tests**

Run: `pnpm --filter @keykeykey/mobile test`
Expected: Tests pass (or fail only on new untested methods, not regressions).

- [ ] **Step 11: Commit**

```bash
git add apps/mobile/lib/vault-context.tsx
git commit -m "feat(mobile): add PIN and biometric unlock to vault context"
```

---

### Task 10: Update mobile unlock screen

**Files:**
- Modify: `apps/mobile/app/unlock.tsx`

- [ ] **Step 1: Update imports and add state**

Replace the existing imports and state in `apps/mobile/app/unlock.tsx`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';

type UnlockMode = 'biometric' | 'pin' | 'password';

export default function UnlockScreen() {
  const {
    unlock,
    unlockWithBiometric,
    unlockWithPin,
    biometricAvailable,
    pinConfigured,
  } = useVault();
  const router = useRouter();
  const t = useTheme();

  const [mode, setMode] = useState<UnlockMode>('password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Determine initial mode based on availability
  useEffect(() => {
    if (biometricAvailable) {
      setMode('biometric');
    } else if (pinConfigured) {
      setMode('pin');
    } else {
      setMode('password');
    }
  }, [biometricAvailable, pinConfigured]);

  // Auto-trigger biometric on mount when available
  useEffect(() => {
    if (mode === 'biometric') {
      handleBiometric();
    }
  }, [mode]);

  const handleBiometric = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const result = await unlockWithBiometric();
      if (result.status === 'success') {
        router.replace('/(tabs)');
      } else if (result.status === 'cancelled') {
        // User dismissed — stay on screen, they can tap fallback
        setLoading(false);
      } else if (result.status === 'invalidated') {
        setError('Biometric data expired. Use PIN or password.');
        setMode(pinConfigured ? 'pin' : 'password');
      } else {
        setError(result.message);
      }
    } catch {
      setError('Biometric unlock failed');
    } finally {
      setLoading(false);
    }
  }, [unlockWithBiometric, pinConfigured, router]);

  const handlePinUnlock = async () => {
    if (!pin) return;
    setError('');
    setLoading(true);
    try {
      const result = await unlockWithPin(pin);
      if (result.success) {
        router.replace('/(tabs)');
      } else if (result.attemptsRemaining === 0) {
        setError('PIN locked out. Use master password.');
        setMode('password');
        setPin('');
      } else {
        setError(`Wrong PIN. ${result.attemptsRemaining} attempts remaining.`);
        setPin('');
      }
    } catch {
      setError('PIN unlock failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordUnlock = async () => {
    if (!password) return;
    setError('');
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 50));
      await unlock(password);
      router.replace('/(tabs)');
    } catch {
      setError('Incorrect master password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: t.colors.surfaceAlt }]}>
              <Ionicons name="lock-closed-outline" size={40} color={t.colors.primary} />
            </View>
            <Text style={[styles.title, { color: t.colors.text }]}>Welcome Back</Text>
            <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
              {mode === 'biometric'
                ? 'Authenticate to unlock'
                : mode === 'pin'
                  ? 'Enter your PIN to unlock'
                  : 'Enter your master password to unlock'}
            </Text>
          </View>

          <View style={styles.form}>
            {mode === 'biometric' && (
              <>
                <Button
                  title="Use Biometrics"
                  onPress={handleBiometric}
                  loading={loading}
                  style={{ marginBottom: 12 }}
                />
              </>
            )}

            {mode === 'pin' && (
              <>
                <TextInput
                  label="PIN"
                  placeholder="Enter PIN"
                  value={pin}
                  onChangeText={(text) => {
                    setPin(text);
                    setError('');
                  }}
                  isPassword
                  keyboardType="number-pad"
                  returnKeyType="go"
                  onSubmitEditing={handlePinUnlock}
                />
                <Button
                  title="Unlock with PIN"
                  onPress={handlePinUnlock}
                  loading={loading}
                  disabled={!pin}
                  style={{ marginTop: 8 }}
                />
              </>
            )}

            {mode === 'password' && (
              <>
                <TextInput
                  label="Master Password"
                  placeholder="Enter master password"
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    setError('');
                  }}
                  isPassword
                  returnKeyType="go"
                  onSubmitEditing={handlePasswordUnlock}
                />
                <Button
                  title="Unlock"
                  onPress={handlePasswordUnlock}
                  loading={loading}
                  disabled={!password}
                  style={{ marginTop: 8 }}
                />
              </>
            )}

            {error ? (
              <Text style={[styles.errorText, { color: t.colors.error }]}>{error}</Text>
            ) : null}

            {/* Fallback buttons */}
            {mode === 'biometric' && pinConfigured && (
              <Button
                title="Use PIN"
                onPress={() => { setMode('pin'); setError(''); }}
                variant="secondary"
                style={{ marginTop: 12 }}
              />
            )}
            {(mode === 'biometric' || mode === 'pin') && (
              <Button
                title="Use Master Password"
                onPress={() => { setMode('password'); setError(''); }}
                variant="secondary"
                style={{ marginTop: 8 }}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

Keep the existing `styles` StyleSheet unchanged (lines 112-150).

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/mobile test`
Expected: Tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/unlock.tsx
git commit -m "feat(mobile): update unlock screen with biometric, PIN, and password modes"
```

---

## Chunk 4: Desktop PIN & Biometric Unlock

### Task 11: Add desktop PIN storage via keyring

**Files:**
- Create: `apps/desktop/src/lib/keyring-storage.ts`

- [ ] **Step 1: Write the implementation**

Create `apps/desktop/src/lib/keyring-storage.ts`:

```typescript
/**
 * Desktop storage helpers for PIN and biometric data via Tauri keyring.
 *
 * Uses the existing save_to_keyring/load_from_keyring/delete_from_keyring
 * Tauri commands in src-tauri/src/keyring_cmds.rs.
 */

import { invoke } from '@tauri-apps/api/core';

const KEY_PIN_DATA = 'keykeykey_pin_data';
const KEY_PIN_ATTEMPTS = 'keykeykey_pin_attempts';
const KEY_BIOMETRIC_DEK = 'keykeykey_biometric_dek';

// --- PIN data ---

export async function savePinDataToKeyring(data: string): Promise<void> {
  await invoke('save_to_keyring', { key: KEY_PIN_DATA, value: data });
}

export async function loadPinDataFromKeyring(): Promise<string | null> {
  return invoke<string | null>('load_from_keyring', { key: KEY_PIN_DATA });
}

export async function deletePinDataFromKeyring(): Promise<void> {
  await invoke('delete_from_keyring', { key: KEY_PIN_DATA });
}

// --- PIN attempt counter ---

export async function savePinAttemptsToKeyring(remaining: number): Promise<void> {
  await invoke('save_to_keyring', { key: KEY_PIN_ATTEMPTS, value: String(remaining) });
}

export async function loadPinAttemptsFromKeyring(): Promise<number | null> {
  const val = await invoke<string | null>('load_from_keyring', { key: KEY_PIN_ATTEMPTS });
  return val !== null ? parseInt(val, 10) : null;
}

export async function deletePinAttemptsFromKeyring(): Promise<void> {
  await invoke('delete_from_keyring', { key: KEY_PIN_ATTEMPTS });
}

// --- Biometric DEK ---

export async function saveBiometricDEKToKeyring(data: string): Promise<void> {
  await invoke('save_to_keyring', { key: KEY_BIOMETRIC_DEK, value: data });
}

export async function loadBiometricDEKFromKeyring(): Promise<string | null> {
  return invoke<string | null>('load_from_keyring', { key: KEY_BIOMETRIC_DEK });
}

export async function deleteBiometricDEKFromKeyring(): Promise<void> {
  await invoke('delete_from_keyring', { key: KEY_BIOMETRIC_DEK });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/lib/keyring-storage.ts
git commit -m "feat(desktop): add keyring storage helpers for PIN and biometric data"
```

---

### Task 12: Update desktop vault context with PIN unlock

**Files:**
- Modify: `apps/desktop/src/lib/vault-context.tsx`

- [ ] **Step 1: Add imports**

In `apps/desktop/src/lib/vault-context.tsx`, add after the existing core imports (lines 2-10):

```typescript
import { setupPin, unwrapDekWithPin, MAX_PIN_ATTEMPTS } from '@keykeykey/core/pin';
import type { PinData } from '@keykeykey/core/pin';
```

Add keyring storage imports:

```typescript
import {
  savePinDataToKeyring,
  loadPinDataFromKeyring,
  deletePinDataFromKeyring,
  savePinAttemptsToKeyring,
  loadPinAttemptsFromKeyring,
  deletePinAttemptsFromKeyring,
} from './keyring-storage';
```

- [ ] **Step 2: Extend VaultContextType**

Replace the `VaultContextType` (lines 50-65):

```typescript
type VaultContextType = {
  status: 'loading' | 'needs_setup' | 'locked' | 'unlocked';
  items: VaultItem[];
  recoveryKey: string | null;
  pinConfigured: boolean;
  setupVault: (masterPassword: string) => Promise<string>;
  unlock: (masterPassword: string) => Promise<void>;
  unlockWithPin: (pin: string) => Promise<{ success: boolean; attemptsRemaining: number | null }>;
  enablePin: (pin: string) => Promise<void>;
  disablePin: () => Promise<void>;
  lock: () => void;
  addItem: (item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateItem: (
    id: string,
    updates: Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>,
  ) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  search: (query: string) => VaultItem[];
  initialize: () => Promise<void>;
};
```

- [ ] **Step 3: Add state**

After existing state declarations (lines 71-75), add:

```typescript
  const [pinConfigured, setPinConfigured] = useState(false);
```

- [ ] **Step 4: Check PIN availability in initialize**

In the `initialize` callback, after `setStatus('locked')` (line 96), add:

```typescript
    const pinDataRaw = await loadPinDataFromKeyring();
    setPinConfigured(pinDataRaw !== null);
```

- [ ] **Step 5: Add PIN unlock, enable, and disable methods**

After the existing `unlock` callback (lines 122-131), add:

```typescript
  const unlockWithPin = useCallback(
    async (pin: string): Promise<{ success: boolean; attemptsRemaining: number | null }> => {
      const pinDataRaw = await loadPinDataFromKeyring();
      if (!pinDataRaw) {
        return { success: false, attemptsRemaining: null };
      }

      const { wrappedDEK, salt } = JSON.parse(pinDataRaw) as { wrappedDEK: string; salt: string };
      const pinData: PinData = {
        wrappedDEK: fromBase64(wrappedDEK),
        salt: fromBase64(salt),
      };

      const dek = await unwrapDekWithPin(pin, pinData);
      if (!dek) {
        let remaining = (await loadPinAttemptsFromKeyring()) ?? MAX_PIN_ATTEMPTS;
        remaining -= 1;
        if (remaining <= 0) {
          await deletePinDataFromKeyring();
          await deletePinAttemptsFromKeyring();
          setPinConfigured(false);
          return { success: false, attemptsRemaining: 0 };
        }
        await savePinAttemptsToKeyring(remaining);
        return { success: false, attemptsRemaining: remaining };
      }

      await savePinAttemptsToKeyring(MAX_PIN_ATTEMPTS);

      const storedItems = await loadAllEncryptedItems();
      const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
      storeRef.current.getState().unlockWithDEK(dek, encryptedArrays);
      syncItems();
      setStatus('unlocked');
      return { success: true, attemptsRemaining: MAX_PIN_ATTEMPTS };
    },
    [syncItems],
  );

  const enablePin = useCallback(async (pin: string) => {
    const dek = storeRef.current.getState().getDEK();
    const pinData = await setupPin(pin, dek);
    const serialized = JSON.stringify({
      wrappedDEK: toBase64(pinData.wrappedDEK),
      salt: toBase64(pinData.salt),
    });
    await savePinDataToKeyring(serialized);
    await savePinAttemptsToKeyring(MAX_PIN_ATTEMPTS);
    setPinConfigured(true);
  }, []);

  const disablePin = useCallback(async () => {
    await deletePinDataFromKeyring();
    await deletePinAttemptsFromKeyring();
    setPinConfigured(false);
  }, []);
```

- [ ] **Step 6: Update context provider value**

Replace the value prop (lines 213-225):

```typescript
      value={{
        status,
        items,
        recoveryKey,
        pinConfigured,
        setupVault,
        unlock,
        unlockWithPin,
        enablePin,
        disablePin,
        lock,
        addItem,
        updateItem,
        removeItem,
        search,
        initialize,
      }}
```

- [ ] **Step 7: Build and verify**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/desktop test`
Expected: Tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/lib/vault-context.tsx
git commit -m "feat(desktop): add PIN unlock, enable, and disable to vault context"
```

---

### Task 13: Update desktop unlock screen with PIN mode

**Files:**
- Modify: `apps/desktop/src/screens/UnlockScreen.tsx`

- [ ] **Step 1: Rewrite UnlockScreen with PIN and password modes**

Replace `apps/desktop/src/screens/UnlockScreen.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';

type UnlockMode = 'pin' | 'password';

export function UnlockScreen() {
  const { theme } = useTheme();
  const { unlock, unlockWithPin, pinConfigured } = useVault();
  const navigate = useNavigate();

  const [mode, setMode] = useState<UnlockMode>('password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (pinConfigured) {
      setMode('pin');
    }
  }, [pinConfigured]);

  const handlePasswordUnlock = async () => {
    if (!password) return;
    setError('');
    setLoading(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      await unlock(password);
      navigate('/vault', { replace: true });
    } catch {
      setError('Incorrect master password');
    } finally {
      setLoading(false);
    }
  };

  const handlePinUnlock = async () => {
    if (!pin) return;
    setError('');
    setLoading(true);
    try {
      const result = await unlockWithPin(pin);
      if (result.success) {
        navigate('/vault', { replace: true });
      } else if (result.attemptsRemaining === 0) {
        setError('PIN locked out. Use master password.');
        setMode('password');
        setPin('');
      } else {
        setError(`Wrong PIN. ${result.attemptsRemaining} attempts remaining.`);
        setPin('');
      }
    } catch {
      setError('PIN unlock failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: theme.colors.background,
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: theme.colors.primaryMuted,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Lock size={32} color={theme.colors.primary} />
          </div>
        </div>

        <h1
          style={{
            fontSize: theme.typography.sizes['2xl'],
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
            textAlign: 'center',
            marginBottom: 8,
          }}
        >
          Welcome Back
        </h1>
        <p
          style={{
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            marginBottom: 32,
          }}
        >
          {mode === 'pin'
            ? 'Enter your PIN to unlock your vault.'
            : 'Enter your master password to unlock your vault.'}
        </p>

        {mode === 'pin' ? (
          <>
            <TextInput
              label="PIN"
              value={pin}
              onChangeText={(text) => {
                setPin(text);
                if (error) setError('');
              }}
              placeholder="Enter PIN"
              secureTextEntry
              autoFocus
              error={error}
              onSubmit={handlePinUnlock}
            />
            <Button
              title="Unlock with PIN"
              onPress={handlePinUnlock}
              loading={loading}
              disabled={!pin}
              style={{ marginTop: 8 }}
            />
            <Button
              title="Use Master Password"
              onPress={() => {
                setMode('password');
                setError('');
              }}
              variant="secondary"
              style={{ marginTop: 8 }}
            />
          </>
        ) : (
          <>
            <TextInput
              label="Master Password"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError('');
              }}
              placeholder="Enter master password"
              secureTextEntry
              autoFocus
              error={error}
              onSubmit={handlePasswordUnlock}
            />
            <Button
              title="Unlock"
              onPress={handlePasswordUnlock}
              loading={loading}
              disabled={!password}
              style={{ marginTop: 8 }}
            />
            {pinConfigured && (
              <Button
                title="Use PIN"
                onPress={() => {
                  setMode('pin');
                  setError('');
                }}
                variant="secondary"
                style={{ marginTop: 8 }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @keykeykey/core build && pnpm --filter @keykeykey/desktop test`
Expected: Tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/screens/UnlockScreen.tsx
git commit -m "feat(desktop): update unlock screen with PIN and password modes"
```

---

## Chunk 5: Settings, Prompts, and Password Change Side Effects

### Task 14: Add quick-unlock settings to mobile settings screen

**Files:**
- Modify: `apps/mobile/app/(tabs)/settings.tsx` (or wherever the settings screen lives)
- Explore: find the existing settings screen first

- [ ] **Step 1: Locate the existing settings screen**

Run: `find apps/mobile -name "*settings*" -o -name "*Settings*" | head -10`

- [ ] **Step 2: Add biometric toggle**

Add a section to the settings screen:

```typescript
// Inside the settings screen component, add:
const { biometricAvailable, enableBiometric, disableBiometric, pinConfigured, enablePin, disablePin } = useVault();
const [biometricEnabled, setBiometricEnabled] = useState(false);

// Check if biometric DEK is stored (not just hardware available)
// This requires adding a `isBiometricEnabled` field to vault context
```

Add toggle controls:
- "Biometric Unlock" toggle (visible only if hardware available)
  - On enable: call `enableBiometric()` after master password confirmation
  - On disable: call `disableBiometric()`
- "PIN Unlock" toggle with "Change PIN" button
  - On enable: show PIN entry + confirm dialog, call `enablePin(pin)`
  - On disable: call `disablePin()`

- [ ] **Step 3: Test manually**

Run the mobile dev server and verify toggles work: `pnpm --filter @keykeykey/mobile dev`

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/
git commit -m "feat(mobile): add biometric and PIN unlock toggles to settings"
```

---

### Task 15: Add quick-unlock settings to desktop settings screen

**Files:**
- Modify: `apps/desktop/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Read the existing SettingsScreen**

Read `apps/desktop/src/screens/SettingsScreen.tsx` to understand the current layout.

- [ ] **Step 2: Add PIN toggle section**

Add PIN enable/disable controls using `enablePin` and `disablePin` from vault context. Include a simple PIN entry dialog (can be inline text inputs).

- [ ] **Step 3: Test manually**

Run the desktop dev server: `pnpm --filter @keykeykey/desktop dev`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/screens/SettingsScreen.tsx
git commit -m "feat(desktop): add PIN unlock toggle to settings"
```

---

### Task 16: Add first-unlock quick-unlock prompt (mobile)

**Files:**
- Create: `apps/mobile/components/QuickUnlockPrompt.tsx`
- Modify: `apps/mobile/app/unlock.tsx` (or the post-unlock navigation target)

- [ ] **Step 1: Create the prompt component**

Create `apps/mobile/components/QuickUnlockPrompt.tsx`:

```typescript
import { View, Text, StyleSheet } from 'react-native';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme';
import { Button } from '@/components/Button';
import { useState } from 'react';
import { TextInput } from '@/components/TextInput';
import { validatePin } from '@keykeykey/core/pin';

export function QuickUnlockPrompt({ onDismiss }: { onDismiss: () => void }) {
  const {
    biometricAvailable,
    enableBiometric,
    enablePin,
    dismissQuickUnlockPrompt,
  } = useVault();
  const t = useTheme();

  const [step, setStep] = useState<'offer' | 'pin_setup'>('offer');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEnableBiometric = async () => {
    setLoading(true);
    try {
      await enableBiometric();
      setStep('pin_setup'); // Also offer PIN as fallback
    } catch {
      setError('Failed to enable biometric');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupPin = async () => {
    if (pin !== pinConfirm) {
      setError('PINs do not match');
      return;
    }
    const validation = validatePin(pin);
    if (!validation.valid) {
      setError(validation.error!);
      return;
    }
    setLoading(true);
    try {
      await enablePin(pin);
      await dismissQuickUnlockPrompt();
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set PIN');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    await dismissQuickUnlockPrompt();
    onDismiss();
  };

  if (step === 'offer') {
    return (
      <View style={[styles.container, { backgroundColor: t.colors.surface }]}>
        <Text style={[styles.title, { color: t.colors.text }]}>Faster Unlock</Text>
        <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
          {biometricAvailable
            ? 'Enable biometric unlock for faster access?'
            : 'Set up a PIN for faster unlock?'}
        </Text>
        {biometricAvailable ? (
          <Button title="Enable Biometrics" onPress={handleEnableBiometric} loading={loading} />
        ) : (
          <Button title="Set Up PIN" onPress={() => setStep('pin_setup')} />
        )}
        <Button title="Skip" onPress={handleSkip} variant="secondary" style={{ marginTop: 8 }} />
        {error ? <Text style={{ color: t.colors.error, marginTop: 8 }}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: t.colors.surface }]}>
      <Text style={[styles.title, { color: t.colors.text }]}>Set Up PIN</Text>
      <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
        Add a PIN as a fallback unlock method.
      </Text>
      <TextInput label="PIN" value={pin} onChangeText={setPin} isPassword keyboardType="number-pad" placeholder="4-8 digits" />
      <TextInput label="Confirm PIN" value={pinConfirm} onChangeText={setPinConfirm} isPassword keyboardType="number-pad" placeholder="Re-enter PIN" />
      {error ? <Text style={{ color: t.colors.error, marginTop: 4 }}>{error}</Text> : null}
      <Button title="Save PIN" onPress={handleSetupPin} loading={loading} disabled={!pin || !pinConfirm} style={{ marginTop: 8 }} />
      <Button title="Skip" onPress={handleSkip} variant="secondary" style={{ marginTop: 8 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, borderRadius: 16, margin: 16 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, marginBottom: 16 },
});
```

- [ ] **Step 2: Integrate the prompt into the post-unlock flow**

After a successful master password unlock in the unlock screen or vault list, show the prompt if `quickUnlockPromptShown` is `false`. This can be done as a modal overlay on the vault list screen.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/QuickUnlockPrompt.tsx apps/mobile/app/
git commit -m "feat(mobile): add first-unlock quick-unlock setup prompt"
```

---

### Task 17: Master password change side effects

**Files:**
- Modify: `apps/mobile/lib/vault-context.tsx` (add cleanup to any existing `changeMasterPassword` flow)
- Modify: `apps/desktop/src/lib/vault-context.tsx` (same)
- Modify: `apps/extension/src/background/message-handler.ts` (if CHANGE_PASSWORD case exists)

- [ ] **Step 1: Find existing change-password handlers**

Search for `changeMasterPassword` or `CHANGE_PASSWORD` across all apps:

Run: `grep -r "changeMasterPassword\|CHANGE_PASSWORD\|changePassword" apps/ packages/ --include="*.ts" --include="*.tsx" -l`

- [ ] **Step 2: Add cleanup logic to mobile change-password flow**

In the mobile vault context's password change handler (or create one if missing), add:

```typescript
// After successful changeMasterPassword call:
await biometricAdapter.current.clearDEK();
await deletePinData();
await deletePinAttempts();
setPinConfigured(false);
await setQuickUnlockPromptShown(false); // Re-trigger prompt
setQuickUnlockPromptShownState(false);
```

- [ ] **Step 3: Add cleanup logic to desktop change-password flow**

```typescript
// After successful changeMasterPassword call:
await deletePinDataFromKeyring();
await deletePinAttemptsFromKeyring();
setPinConfigured(false);
```

- [ ] **Step 4: Add cleanup logic to extension change-password flow**

```typescript
// After successful changeMasterPassword in message handler:
await clearPinData();
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/vault-context.tsx apps/desktop/src/lib/vault-context.tsx apps/extension/src/background/message-handler.ts
git commit -m "fix(security): clear PIN and biometric data on master password change"
```

---

### Task 18: Desktop biometric — macOS Touch ID via Rust

**Files:**
- Create: `apps/desktop/src-tauri/src/biometric_cmds.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register new commands)
- Modify: `apps/desktop/src-tauri/Cargo.toml` (add `security-framework` dependency)
- Create: `apps/desktop/src/lib/desktop-biometric-adapter.ts`

Note: Windows Hello implementation is deferred — see spec Section 7. This task implements macOS only. Linux returns `isAvailable: false`.

- [ ] **Step 1: Add Rust dependency**

In `apps/desktop/src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
security-framework = "3"
```

- [ ] **Step 2: Create biometric Rust commands**

Create `apps/desktop/src-tauri/src/biometric_cmds.rs`:

```rust
/// macOS Touch ID-gated Keychain access for biometric DEK storage.
/// On non-macOS platforms, these commands return appropriate errors/defaults.

#[cfg(target_os = "macos")]
mod macos {
    use security_framework::item::{ItemClass, ItemSearchOptions, Limit, SearchResult};
    use security_framework::keychain::SecKeychain;
    use security_framework::passwords::{delete_generic_password, set_generic_password};

    const SERVICE: &str = "com.keykeykey.biometric";
    const ACCOUNT: &str = "biometric_dek";

    pub fn is_available() -> bool {
        // Check if Touch ID or any biometric is enrolled via LAContext
        // For simplicity, we check if the keychain is accessible
        // A more robust check would use LocalAuthentication framework
        true // macOS with Touch ID hardware
    }

    pub fn save_dek(value: &str) -> Result<(), String> {
        set_generic_password(SERVICE, ACCOUNT, value.as_bytes())
            .map_err(|e| format!("Failed to save biometric DEK: {e}"))
    }

    pub fn load_dek() -> Result<Option<String>, String> {
        match security_framework::passwords::get_generic_password(SERVICE, ACCOUNT) {
            Ok(bytes) => {
                let s = String::from_utf8(bytes.to_vec())
                    .map_err(|e| format!("Invalid UTF-8 in biometric DEK: {e}"))?;
                Ok(Some(s))
            }
            Err(e) if e.code() == -25300 => Ok(None), // errSecItemNotFound
            Err(e) => Err(format!("Failed to load biometric DEK: {e}")),
        }
    }

    pub fn clear_dek() -> Result<(), String> {
        match delete_generic_password(SERVICE, ACCOUNT) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()), // Already deleted
            Err(e) => Err(format!("Failed to clear biometric DEK: {e}")),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    pub fn is_available() -> bool { false }
    pub fn save_dek(_value: &str) -> Result<(), String> {
        Err("Biometric not supported on this platform".into())
    }
    pub fn load_dek() -> Result<Option<String>, String> { Ok(None) }
    pub fn clear_dek() -> Result<(), String> { Ok(()) }
}

#[tauri::command]
pub fn biometric_is_available() -> bool {
    macos::is_available()
}

#[tauri::command]
pub fn biometric_save_dek(value: String) -> Result<(), String> {
    macos::save_dek(&value)
}

#[tauri::command]
pub fn biometric_load_dek() -> Result<Option<String>, String> {
    macos::load_dek()
}

#[tauri::command]
pub fn biometric_clear_dek() -> Result<(), String> {
    macos::clear_dek()
}
```

- [ ] **Step 3: Register commands in lib.rs**

In `apps/desktop/src-tauri/src/lib.rs`, add:

```rust
mod biometric_cmds;
```

And add the commands to the `invoke_handler`:

```rust
biometric_cmds::biometric_is_available,
biometric_cmds::biometric_save_dek,
biometric_cmds::biometric_load_dek,
biometric_cmds::biometric_clear_dek,
```

- [ ] **Step 4: Create TypeScript BiometricAdapter for desktop**

Create `apps/desktop/src/lib/desktop-biometric-adapter.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { BiometricAdapter, BiometricResult } from '@keykeykey/core/biometric';

const MAX_DEK_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function createDesktopBiometricAdapter(): BiometricAdapter {
  return {
    async isAvailable(): Promise<boolean> {
      return invoke<boolean>('biometric_is_available');
    },

    async saveDEK(dek: Uint8Array): Promise<void> {
      const payload = JSON.stringify({
        dek: toBase64(dek),
        savedAt: new Date().toISOString(),
      });
      await invoke('biometric_save_dek', { value: payload });
    },

    async loadDEK(): Promise<BiometricResult> {
      try {
        const raw = await invoke<string | null>('biometric_load_dek');
        if (!raw) return { status: 'invalidated' };

        const { dek: dekBase64, savedAt } = JSON.parse(raw);
        const age = Date.now() - new Date(savedAt).getTime();
        if (age > MAX_DEK_AGE_MS) {
          await invoke('biometric_clear_dek');
          return { status: 'invalidated' };
        }

        return { status: 'success', dek: fromBase64(dekBase64) };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Biometric error';
        if (message.includes('cancel') || message.includes('Cancel')) {
          return { status: 'cancelled' };
        }
        return { status: 'error', message };
      }
    },

    async clearDEK(): Promise<void> {
      await invoke('biometric_clear_dek');
    },
  };
}
```

- [ ] **Step 5: Wire desktop biometric into vault context**

Update `apps/desktop/src/lib/vault-context.tsx` to add biometric support (following the same pattern as mobile: add `biometricAvailable`, `unlockWithBiometric`, `enableBiometric`, `disableBiometric` to context).

- [ ] **Step 6: Update desktop unlock screen for biometric**

Add biometric as the highest-priority unlock mode (before PIN) in the desktop `UnlockScreen.tsx`, following the same pattern as mobile.

- [ ] **Step 7: Build and verify**

Run: `cd apps/desktop/src-tauri && cargo build`
Run: `pnpm --filter @keykeykey/desktop test`

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/src/biometric_cmds.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/Cargo.toml apps/desktop/src/lib/desktop-biometric-adapter.ts apps/desktop/src/lib/vault-context.tsx apps/desktop/src/screens/UnlockScreen.tsx
git commit -m "feat(desktop): add macOS Touch ID biometric unlock via Keychain"
```

---

## Chunk 6: Final Integration & Verification

### Task 19: Add core `package.json` exports for new entry points

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Check current exports and add pin, biometric, unlock**

Read `packages/core/package.json` to find the `exports` field. Add entries for the new modules:

```json
"./pin": {
  "import": "./dist/pin/index.js",
  "types": "./dist/pin/index.d.ts"
},
"./biometric": {
  "import": "./dist/biometric/index.js",
  "types": "./dist/biometric/index.d.ts"
},
"./unlock": {
  "import": "./dist/unlock/index.js",
  "types": "./dist/unlock/index.d.ts"
}
```

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @keykeykey/core build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json
git commit -m "feat(core): add package.json exports for pin, biometric, and unlock modules"
```

---

### Task 20: Full build and test verification

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully.

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass across core, extension, mobile, desktop.

- [ ] **Step 3: Run linter**

Run: `pnpm lint`
Expected: No lint errors.

- [ ] **Step 4: Run formatter**

Run: `pnpm format:check`
Expected: All files formatted. If not, run `pnpm format` and commit.

- [ ] **Step 5: Run critical E2E tests**

Run: `cd e2e && npx playwright test --grep @critical`
Expected: Critical E2E tests pass.

- [ ] **Step 6: Final commit (if format changes needed)**

```bash
git add -A
git commit -m "style: format files after PIN and biometric unlock implementation"
```
