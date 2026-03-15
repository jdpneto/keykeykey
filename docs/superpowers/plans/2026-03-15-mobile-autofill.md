# Mobile Autofill — iOS & Android Credential Providers

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register KeyKeyKey as a system-level credential provider on iOS and Android so users can fill, search, associate, or create credentials from the OS autofill prompt.

**Architecture:** Core schema adds `appIdentifiers` to credentials and a combined `matchCredentials()` function. iOS uses a native SwiftUI extension with libargon2/libsodium sharing data via App Group. Android uses an AutofillService in the same app process reusing React Native UI. Mobile storage is refactored to a shared container (iOS) for cross-process access.

**Tech Stack:** Zod, Vitest, Expo config plugins, SwiftUI, ASCredentialProviderViewController (iOS), AutofillService (Android), libargon2, libsodium, SQLite WAL mode, expo-router deep-linking

**Spec:** `docs/superpowers/specs/2026-03-15-mobile-autofill-design.md`

---

## Chunk 1: Core Schema & Domain Matching

### Task 1: Migrate schemas from `.strict()` to `.passthrough()`

**Files:**
- Modify: `packages/core/src/models/credential.ts:18` (`.strict()` → `.passthrough()`)
- Modify: `packages/core/src/models/card.ts:20` (`.strict()` → `.passthrough()`)
- Modify: `packages/core/src/models/secure-note.ts:14` (`.strict()` → `.passthrough()`)
- Modify: `packages/core/src/models/vault-item.ts:40` (`.strict()` → `.passthrough()`)
- Modify: `packages/core/src/models/models.test.ts`

- [ ] **Step 1: Write tests for passthrough behavior**

Add a test case to `packages/core/src/models/models.test.ts` verifying that schemas accept unknown properties without rejection:

```typescript
describe('schema forward compatibility', () => {
  it('should accept credentials with unknown properties (passthrough)', () => {
    const credential = {
      ...validBase,
      type: 'credential' as const,
      url: 'https://example.com',
      username: 'user@example.com',
      password: 'super-secret-123',
      futureField: 'should not be rejected',
    };
    const result = CredentialSchema.safeParse(credential);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).futureField).toBe('should not be rejected');
    }
  });

  it('should accept cards with unknown properties (passthrough)', () => {
    const card = {
      ...validBase,
      type: 'card' as const,
      cardholderName: 'John Doe',
      number: '4111111111111111',
      expirationMonth: 12,
      expirationYear: 2030,
      cvv: '123',
      unknownProp: 42,
    };
    const result = CardSchema.safeParse(card);
    expect(result.success).toBe(true);
  });

  it('should accept secure notes with unknown properties (passthrough)', () => {
    const note = {
      ...validBase,
      type: 'secure-note' as const,
      content: 'secret text',
      extraData: true,
    };
    const result = SecureNoteSchema.safeParse(note);
    expect(result.success).toBe(true);
  });

  it('should accept encrypted vault items with unknown properties (passthrough)', () => {
    const encrypted = {
      id: validBase.id,
      type: 'credential' as const,
      encryptedData: new Uint8Array([1, 2, 3]),
      createdAt: validBase.createdAt,
      updatedAt: validBase.updatedAt,
      newMetaField: 'future',
    };
    const result = EncryptedVaultItemSchema.safeParse(encrypted);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- --run src/models/models.test.ts`
Expected: FAIL — `.strict()` rejects unknown properties

- [ ] **Step 3: Change `.strict()` to `.passthrough()` on all four schemas**

In `packages/core/src/models/credential.ts` line 18: change `.strict()` to `.passthrough()`
In `packages/core/src/models/card.ts` line 20: change `.strict()` to `.passthrough()`
In `packages/core/src/models/secure-note.ts` line 14: change `.strict()` to `.passthrough()`
In `packages/core/src/models/vault-item.ts` line 40: change `.strict()` to `.passthrough()`

- [ ] **Step 3b: Update existing strict-mode rejection test**

The existing test `'should reject unknown fields (strict mode)'` in `models.test.ts` (around line 88-99) will now fail because `.passthrough()` accepts unknown fields. **Remove or update this test** — replace its assertion to verify that unknown fields are preserved (passthrough) rather than rejected:

```typescript
it('should preserve unknown fields (passthrough mode)', () => {
  const credential = {
    ...validBase,
    type: 'credential' as const,
    username: 'user@example.com',
    password: 'pass',
    unknownField: 'preserved',
  };
  const result = CredentialSchema.safeParse(credential);
  expect(result.success).toBe(true);
  if (result.success) {
    expect((result.data as Record<string, unknown>).unknownField).toBe('preserved');
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- --run src/models/models.test.ts`
Expected: PASS — updated passthrough tests pass, old strict-mode test replaced

- [ ] **Step 5: Run full core test suite to check for regressions**

Run: `pnpm --filter @keykeykey/core test -- --run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/models/credential.ts packages/core/src/models/card.ts packages/core/src/models/secure-note.ts packages/core/src/models/vault-item.ts packages/core/src/models/models.test.ts
git commit -m "refactor(core): migrate schemas from strict to passthrough for forward compatibility"
```

---

### Task 2: Add `appIdentifiers` field to CredentialSchema

**Files:**
- Modify: `packages/core/src/models/credential.ts:8-18`
- Modify: `packages/core/src/models/models.test.ts`

- [ ] **Step 1: Write tests for `appIdentifiers` field**

Add to `packages/core/src/models/models.test.ts`:

```typescript
describe('CredentialSchema appIdentifiers', () => {
  const baseCredential = {
    ...validBase,
    type: 'credential' as const,
    username: 'user@example.com',
    password: 'pass123',
  };

  it('should accept credential without appIdentifiers (optional)', () => {
    const result = CredentialSchema.safeParse(baseCredential);
    expect(result.success).toBe(true);
  });

  it('should accept credential with valid appIdentifiers', () => {
    const result = CredentialSchema.safeParse({
      ...baseCredential,
      appIdentifiers: ['com.slack.android', 'com.tinyspeck.chatlyio'],
    });
    expect(result.success).toBe(true);
  });

  it('should accept credential with empty appIdentifiers array', () => {
    const result = CredentialSchema.safeParse({
      ...baseCredential,
      appIdentifiers: [],
    });
    expect(result.success).toBe(true);
  });

  it('should normalize appIdentifiers to lowercase', () => {
    const result = CredentialSchema.safeParse({
      ...baseCredential,
      appIdentifiers: ['COM.Slack.ANDROID'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.appIdentifiers).toEqual(['com.slack.android']);
    }
  });

  it('should reject invalid appIdentifiers format (no dots)', () => {
    const result = CredentialSchema.safeParse({
      ...baseCredential,
      appIdentifiers: ['invalid'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject appIdentifiers starting with number', () => {
    const result = CredentialSchema.safeParse({
      ...baseCredential,
      appIdentifiers: ['1com.invalid.app'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject appIdentifiers with special characters', () => {
    const result = CredentialSchema.safeParse({
      ...baseCredential,
      appIdentifiers: ['com.my-app.test'],
    });
    expect(result.success).toBe(false);
  });

  it('should accept appIdentifiers with underscores', () => {
    const result = CredentialSchema.safeParse({
      ...baseCredential,
      appIdentifiers: ['com.my_app.test'],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- --run src/models/models.test.ts`
Expected: FAIL — `appIdentifiers` field not in schema yet

- [ ] **Step 3: Add `appIdentifiers` to CredentialSchema**

In `packages/core/src/models/credential.ts`, add the field after `totp`:

```typescript
import { z } from 'zod';
import { baseVaultItemFields } from './base.js';

const appIdentifierString = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/));

export const CredentialSchema = z
  .object({
    ...baseVaultItemFields,
    type: z.literal('credential'),
    url: z.string().url().optional(),
    username: z.string().min(1),
    password: z.string().min(1),
    notes: z.string().optional(),
    totp: z.string().optional(),
    appIdentifiers: z.array(appIdentifierString).optional(),
  })
  .passthrough();

export type Credential = z.infer<typeof CredentialSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- --run src/models/models.test.ts`
Expected: PASS

- [ ] **Step 5: Run full core test suite**

Run: `pnpm --filter @keykeykey/core test -- --run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/models/credential.ts packages/core/src/models/models.test.ts
git commit -m "feat(core): add appIdentifiers field to CredentialSchema for mobile autofill"
```

---

### Task 3: Add `matchCredentialsByAppIdentifier` function

**Files:**
- Modify: `packages/core/src/domain/domain-utils.ts`
- Modify: `packages/core/src/domain/domain-utils.test.ts`
- Modify: `packages/core/src/domain/index.ts`

- [ ] **Step 1: Write tests for `matchCredentialsByAppIdentifier`**

Add to `packages/core/src/domain/domain-utils.test.ts`:

```typescript
describe('matchCredentialsByAppIdentifier', () => {
  const items: VaultItem[] = [
    {
      id: '1',
      type: 'credential',
      name: 'Slack',
      username: 'user',
      password: 'pass',
      url: 'https://slack.com',
      appIdentifiers: ['com.slack.android', 'com.tinyspeck.chatlyio'],
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '2',
      type: 'credential',
      name: 'GitHub',
      username: 'user',
      password: 'pass',
      url: 'https://github.com',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '3',
      type: 'credential',
      name: 'GitHub Mobile',
      username: 'user2',
      password: 'pass2',
      url: 'https://github.com',
      appIdentifiers: ['com.github.android'],
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '4',
      type: 'secure-note',
      name: 'Note',
      content: 'secret',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
  ];

  it('should match credential by exact app identifier', () => {
    const matches = matchCredentialsByAppIdentifier('com.slack.android', items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('1');
  });

  it('should match case-insensitively', () => {
    const matches = matchCredentialsByAppIdentifier('COM.SLACK.ANDROID', items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('1');
  });

  it('should return empty array when no match', () => {
    const matches = matchCredentialsByAppIdentifier('com.unknown.app', items);
    expect(matches).toHaveLength(0);
  });

  it('should skip items without appIdentifiers', () => {
    const matches = matchCredentialsByAppIdentifier('com.github.android', items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('3');
  });

  it('should skip non-credential items', () => {
    const matches = matchCredentialsByAppIdentifier('com.notes.app', items);
    expect(matches).toHaveLength(0);
  });

  it('should return multiple matches if multiple credentials have the same app ID', () => {
    const dupeItems = [
      ...items,
      {
        id: '5',
        type: 'credential',
        name: 'Slack Work',
        username: 'work@co.com',
        password: 'pass',
        appIdentifiers: ['com.slack.android'],
        tags: [],
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as VaultItem,
    ];
    const matches = matchCredentialsByAppIdentifier('com.slack.android', dupeItems);
    expect(matches).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- --run src/domain/domain-utils.test.ts`
Expected: FAIL — `matchCredentialsByAppIdentifier` not defined

- [ ] **Step 3: Implement `matchCredentialsByAppIdentifier`**

Add to `packages/core/src/domain/domain-utils.ts` after `matchCredentialsByDomain`:

```typescript
import type { Credential } from '../models/credential.js';

/**
 * Find credentials whose appIdentifiers array contains the given app ID.
 * Case-insensitive comparison (both sides lowercased).
 * Only matches `credential` type items that have appIdentifiers.
 */
export function matchCredentialsByAppIdentifier(
  appId: string,
  items: VaultItem[],
): VaultItem[] {
  const lowerAppId = appId.toLowerCase();
  return items.filter((item) => {
    if (item.type !== 'credential') return false;
    const credential = item as Credential;
    if (!credential.appIdentifiers || credential.appIdentifiers.length === 0) return false;
    return credential.appIdentifiers.some((id) => id.toLowerCase() === lowerAppId);
  });
}
```

Note: After the `type === 'credential'` guard, TypeScript narrows `item` to `Credential` which includes `appIdentifiers`. Use `item as Credential` for clarity since the discriminated union guarantees the type. The same pattern should be used in Task 7 (edit screen) and Task 12 (vault store search) — always use proper `Credential` type narrowing, never cast to `Record<string, unknown>`.

- [ ] **Step 4: Export the new function**

Add to `packages/core/src/domain/index.ts`:

```typescript
export {
  extractDomainBrand,
  matchCredentialsByAppIdentifier,
  matchCredentialsByDomain,
  normalizeUrl,
} from './domain-utils.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- --run src/domain/domain-utils.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/domain/domain-utils.ts packages/core/src/domain/domain-utils.test.ts packages/core/src/domain/index.ts
git commit -m "feat(core): add matchCredentialsByAppIdentifier for mobile autofill"
```

---

### Task 4: Add combined `matchCredentials` function

**Files:**
- Modify: `packages/core/src/domain/domain-utils.ts`
- Modify: `packages/core/src/domain/domain-utils.test.ts`
- Modify: `packages/core/src/domain/index.ts`

- [ ] **Step 1: Write tests for `matchCredentials`**

Add to `packages/core/src/domain/domain-utils.test.ts`:

```typescript
describe('matchCredentials', () => {
  const items: VaultItem[] = [
    {
      id: '1',
      type: 'credential',
      name: 'Slack',
      username: 'user',
      password: 'pass',
      url: 'https://slack.com',
      appIdentifiers: ['com.slack.android'],
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '2',
      type: 'credential',
      name: 'Slack Web',
      username: 'user2',
      password: 'pass2',
      url: 'https://app.slack.com',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '3',
      type: 'credential',
      name: 'GitHub',
      username: 'user3',
      password: 'pass3',
      url: 'https://github.com',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
  ];

  it('should match by app identifier first', () => {
    const matches = matchCredentials({ appIdentifier: 'com.slack.android' }, items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('1');
  });

  it('should match by hostname when no app identifier provided', () => {
    const matches = matchCredentials({ hostname: 'github.com' }, items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('3');
  });

  it('should combine app identifier and hostname matches, deduplicated', () => {
    const matches = matchCredentials(
      { appIdentifier: 'com.slack.android', hostname: 'slack.com' },
      items,
    );
    // Item 1 matches both appId AND domain — should appear once
    // Item 2 matches domain only
    expect(matches).toHaveLength(2);
    const ids = matches.map((m) => m.id);
    expect(ids).toContain('1');
    expect(ids).toContain('2');
  });

  it('should return empty array when no context provided', () => {
    const matches = matchCredentials({}, items);
    expect(matches).toHaveLength(0);
  });

  it('should return empty array when nothing matches', () => {
    const matches = matchCredentials(
      { appIdentifier: 'com.unknown.app', hostname: 'unknown.com' },
      items,
    );
    expect(matches).toHaveLength(0);
  });

  it('should deduplicate by item ID', () => {
    const sameItem: VaultItem[] = [
      {
        id: '1',
        type: 'credential',
        name: 'Slack',
        username: 'user',
        password: 'pass',
        url: 'https://slack.com',
        appIdentifiers: ['com.slack.android'],
        tags: [],
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as VaultItem,
    ];
    const matches = matchCredentials(
      { appIdentifier: 'com.slack.android', hostname: 'slack.com' },
      sameItem,
    );
    expect(matches).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- --run src/domain/domain-utils.test.ts`
Expected: FAIL — `matchCredentials` not defined

- [ ] **Step 3: Implement `matchCredentials`**

Add to `packages/core/src/domain/domain-utils.ts`:

```typescript
/**
 * Combined credential matching: tries app identifier first, then domain.
 * Results are deduplicated by item ID.
 */
export function matchCredentials(
  context: { hostname?: string; appIdentifier?: string },
  items: VaultItem[],
): VaultItem[] {
  const seen = new Set<string>();
  const results: VaultItem[] = [];

  if (context.appIdentifier) {
    for (const item of matchCredentialsByAppIdentifier(context.appIdentifier, items)) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        results.push(item);
      }
    }
  }

  if (context.hostname) {
    for (const item of matchCredentialsByDomain(context.hostname, items)) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        results.push(item);
      }
    }
  }

  return results;
}
```

- [ ] **Step 4: Export the new function**

Update `packages/core/src/domain/index.ts`:

```typescript
export {
  extractDomainBrand,
  matchCredentials,
  matchCredentialsByAppIdentifier,
  matchCredentialsByDomain,
  normalizeUrl,
} from './domain-utils.js';
```

Also update `packages/core/src/index.ts` to re-export the new functions. Find the line that exports from `./domain/index.js` and add `matchCredentials` and `matchCredentialsByAppIdentifier` to the list.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- --run src/domain/domain-utils.test.ts`
Expected: PASS

- [ ] **Step 6: Run full core test suite**

Run: `pnpm --filter @keykeykey/core test -- --run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/domain/domain-utils.ts packages/core/src/domain/domain-utils.test.ts packages/core/src/domain/index.ts
git commit -m "feat(core): add combined matchCredentials function for autofill"
```

---

## Chunk 2: Mobile Storage Refactor & Deep-Linking

### Task 5: Refactor storage to export functions and prepare for iOS App Group

The current storage layer uses `expo-secure-store` and `expo-sqlite` which are app-private. For iOS, the credential provider extension needs access to the same data via App Group. First, we export the necessary functions from `storage.ts` and then create an iOS-specific storage adapter.

**Files:**
- Modify: `apps/mobile/lib/storage.ts` (export `getDB` and add App Group awareness)
- Create: `apps/mobile/lib/shared-storage.ts` (iOS App Group storage adapter interface)
- Create: `apps/mobile/lib/shared-storage.test.ts`

- [ ] **Step 1: Export `getDB` from storage.ts**

In `apps/mobile/lib/storage.ts`, the `getDB()` function (line 101) is currently module-private (`async function getDB()`). Change it to an exported function:

```typescript
export async function getDB(): Promise<SQLiteDatabase> {
```

This makes the database accessible for the shared storage layer.

- [ ] **Step 2: Write tests for the shared storage adapter**

Create `apps/mobile/lib/shared-storage.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: vi.fn().mockResolvedValue({
    execAsync: vi.fn(),
    runAsync: vi.fn(),
    getFirstAsync: vi.fn(),
    getAllAsync: vi.fn(),
  }),
}));

describe('shared-storage', () => {
  it('should export all required storage functions', async () => {
    const mod = await import('./shared-storage.js');
    expect(typeof mod.saveVaultHeader).toBe('function');
    expect(typeof mod.loadVaultHeader).toBe('function');
    expect(typeof mod.saveEncryptedItem).toBe('function');
    expect(typeof mod.loadAllEncryptedItems).toBe('function');
    expect(typeof mod.deleteEncryptedItem).toBe('function');
    expect(typeof mod.saveBiometricDEK).toBe('function');
    expect(typeof mod.loadBiometricDEK).toBe('function');
    expect(typeof mod.savePinData).toBe('function');
    expect(typeof mod.loadPinData).toBe('function');
  });

  it('should delegate to storage.ts functions', async () => {
    const storage = await import('./storage.js');
    const shared = await import('./shared-storage.js');
    // Verify shared functions are the same references as storage functions
    expect(shared.saveVaultHeader).toBe(storage.saveVaultHeader);
    expect(shared.loadVaultHeader).toBe(storage.loadVaultHeader);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/mobile test -- --run lib/shared-storage.test.ts`
Expected: FAIL — `shared-storage.ts` doesn't exist

- [ ] **Step 4: Create the shared storage module**

Create `apps/mobile/lib/shared-storage.ts`:

```typescript
/**
 * Shared storage abstraction for cross-process vault access.
 *
 * On iOS, the credential provider extension runs in a separate process
 * and needs access to the same vault data. This module re-exports the
 * storage functions that both the main app and extension use.
 *
 * Phase 1 (current): Re-exports from storage.ts (app-private storage)
 * Phase 2 (iOS App Group): Replace with shared container implementations:
 *   - Vault header → shared Keychain access group
 *   - Encrypted items → App Group shared SQLite with WAL mode
 *   - Biometric DEK → shared Keychain with biometric access control
 *   - PIN data → App Group shared UserDefaults
 *
 * The iOS extension (Swift) will access these same locations natively
 * via KeychainHelper.swift and direct SQLite access.
 */

export {
  saveVaultHeader,
  loadVaultHeader,
  deleteVaultHeader,
  saveBiometricDEK,
  loadBiometricDEK,
  deleteBiometricDEK,
  savePinData,
  loadPinData,
  deletePinData,
  savePinAttempts,
  loadPinAttempts,
  deletePinAttempts,
  getDB,
  saveEncryptedItem,
  loadAllEncryptedItems,
  deleteEncryptedItem,
  deleteAllEncryptedItems,
} from './storage.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/mobile test -- --run lib/shared-storage.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/storage.ts apps/mobile/lib/shared-storage.ts apps/mobile/lib/shared-storage.test.ts
git commit -m "feat(mobile): export getDB and add shared storage abstraction for credential provider"
```

---

### Task 5b: Implement iOS App Group shared storage (native migration)

This task migrates the storage layer to use iOS App Group shared containers so the credential provider extension can access vault data. This is the actual iOS storage refactor required by the spec.

**Files:**
- Create: `apps/mobile/plugins/credential-provider/native-storage.js` (Expo config plugin for App Group setup)
- Modify: `apps/mobile/lib/storage.ts` (use App Group paths on iOS)

**Important:** This task involves native iOS configuration that cannot be fully unit-tested. Verification is done via the manual test protocol (Task 13).

- [ ] **Step 1: Add App Group container path resolution to storage.ts**

In `apps/mobile/lib/storage.ts`, add a helper to resolve the shared container path on iOS:

```typescript
import { Platform, NativeModules } from 'react-native';

/**
 * Get the database path for the shared SQLite database.
 * On iOS, this uses the App Group shared container path.
 * On Android, this uses the app-private directory (same process).
 *
 * The iOS path is resolved via a native module that calls
 * FileManager.containerURL(forSecurityApplicationGroupIdentifier:).
 * This avoids fragile relative path traversal.
 */
function getSharedDBPath(): string {
  if (Platform.OS === 'ios') {
    // Read the App Group container path from the config plugin's Info.plist entry.
    // The config plugin writes this as "AppGroupContainerPath" at prebuild time.
    // Alternatively, create a tiny native module:
    //   FileManager.default.containerURL(
    //     forSecurityApplicationGroupIdentifier: "group.com.keykeykey.shared"
    //   )!.appendingPathComponent("keykeykey.db").path
    //
    // For now, use the standard iOS App Group container location:
    const appGroupId = 'group.com.keykeykey.shared';
    // expo-sqlite supports absolute paths — the config plugin resolves
    // the container path and writes it to a shared location at prebuild.
    // TODO: Replace with native module call for robustness.
    // Interim approach: use NativeModules.AppGroupPath.getPath() if available,
    // otherwise fall back to the known simulator/device path pattern.
    return `keykeykey-shared.db`; // placeholder — see note below
  }
  return 'keykeykey.db'; // Android: app-private, default location
}
```

**Important implementation note:** The `getSharedDBPath()` for iOS requires a small native module (or Expo config plugin modification) that calls `FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:)` to get the actual App Group container path. This is because the path varies by device/simulator and iOS version. Create a minimal Expo module or use `expo-modules-core` to expose this single function:

```swift
// In the config plugin's native code:
@objc func getAppGroupPath() -> String? {
    return FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: "group.com.keykeykey.shared"
    )?.appendingPathComponent("keykeykey.db").path
}
```

- [ ] **Step 2: Update `getDB()` to use shared path and enable WAL mode**

Modify the `getDB()` function in `storage.ts` to use the shared path and enable WAL mode for concurrent access:

```typescript
export async function getDB(): Promise<SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync(getSharedDBPath());
  // Enable WAL mode for concurrent access from main app and extension
  await db.execAsync('PRAGMA journal_mode=WAL;');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS vault_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}
```

- [ ] **Step 3: Update vault header storage to use shared Keychain**

The vault header currently uses `expo-secure-store` which stores in the app-private Keychain. To share with the extension, add the `keychainAccessGroup` option:

```typescript
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessGroup: 'com.keykeykey.shared',
  // Note: In production, the Team ID prefix is added automatically by iOS
};

export async function saveVaultHeader(serialized: string): Promise<void> {
  await SecureStore.setItemAsync(VAULT_HEADER_KEY, serialized, KEYCHAIN_OPTIONS);
}

export async function loadVaultHeader(): Promise<string | null> {
  return SecureStore.getItemAsync(VAULT_HEADER_KEY, KEYCHAIN_OPTIONS);
}
```

Apply the same `KEYCHAIN_OPTIONS` to `saveBiometricDEK`, `loadBiometricDEK`, `deleteBiometricDEK`, and PIN data functions.

- [ ] **Step 4: Test with Expo prebuild**

Run: `cd apps/mobile && npx expo prebuild --clean --platform ios`
Verify no build errors. The App Group entitlement is added by the config plugin (Task 8).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/storage.ts
git commit -m "feat(mobile): migrate storage to iOS App Group shared container with WAL mode"
```

---

### Task 6: Add deep-link handling for `keykeykey://item/add`

The add screen needs to accept deep-link parameters to pre-populate fields when launched from the credential provider.

**Files:**
- Modify: `apps/mobile/app/item/add.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Add deep-link parameter parsing to add screen**

In `apps/mobile/app/item/add.tsx`, add URL parameter parsing. The screen already uses `useRouter()` from expo-router. Add `useLocalSearchParams` to read deep-link params:

At the top of the component (after existing `useVault()` call at line 24):

```typescript
const { appId, domain } = useLocalSearchParams<{ appId?: string; domain?: string }>();
```

Add an import for `useLocalSearchParams` from `expo-router` and `extractDomainBrand` from `@keykeykey/core/domain`.

Add initialization logic after state declarations to pre-populate from deep-link:

```typescript
useEffect(() => {
  if (appId || domain) {
    setType('credential');
    if (domain) {
      setUrl(domain.startsWith('http') ? domain : `https://${domain}`);
      if (!name) {
        setName(extractDomainBrand(domain));
      }
    }
    if (appId) {
      setAppIdentifiers([appId]);
    }
  }
}, []);
```

Add state for `appIdentifiers`:

```typescript
const [appIdentifiers, setAppIdentifiers] = useState<string[]>([]);
```

- [ ] **Step 2: Add `appIdentifiers` to the credential save logic**

In the `handleSave()` function, include `appIdentifiers` when saving a credential. Find the credential save block (around line 57-82) and add `appIdentifiers` to the item object:

```typescript
// In the credential case of handleSave:
appIdentifiers: appIdentifiers.length > 0 ? appIdentifiers : undefined,
```

- [ ] **Step 3: Add `appIdentifiers` display in the form UI**

Add a read-only display of app identifiers as chips in the credential form section, before the notes field. Only show when `appIdentifiers` is non-empty:

```typescript
{appIdentifiers.length > 0 && (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
    <Text style={{ color: t.colors.textSecondary, fontSize: 12, width: '100%' }}>
      App Identifiers
    </Text>
    {appIdentifiers.map((id) => (
      <View
        key={id}
        style={{
          backgroundColor: t.colors.surfaceHover,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 12,
        }}
      >
        <Text style={{ color: t.colors.text, fontSize: 12 }}>{id}</Text>
      </View>
    ))}
  </View>
)}
```

- [ ] **Step 3b: Consume Android autofill handoff in add screen**

Also check for pending credentials from the Android `onSaveRequest` flow. At the top of the component, after the deep-link params:

```typescript
import { AutofillHandoff } from '@/lib/autofill-handoff';

// In the component body, after useLocalSearchParams:
useEffect(() => {
  const pending = AutofillHandoff.consume();
  if (pending) {
    setType('credential');
    setUsername(pending.username);
    setPassword(pending.password);
    if (pending.domain) {
      setUrl(pending.domain.startsWith('http') ? pending.domain : `https://${pending.domain}`);
      setName(extractDomainBrand(pending.domain));
    }
    if (pending.packageName) {
      setAppIdentifiers([pending.packageName]);
    }
  }
}, []);
```

- [ ] **Step 4: Test deep-link handling manually**

Run: `pnpm --filter @keykeykey/mobile start`
In another terminal: `npx uri-scheme open "keykeykey://item/add?appId=com.slack.android&domain=slack.com" --ios`
Expected: Add screen opens with type=credential, name="slack", url="https://slack.com", chip showing "com.slack.android"

Note: The `keykeykey://` URL scheme is already configured in `app.json` (`"scheme": "keykeykey"`). Expo Router handles deep-link routing automatically based on the file-based route structure — `keykeykey://item/add` routes to `app/item/add.tsx`. No changes to `app/_layout.tsx` are needed.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/item/add.tsx
git commit -m "feat(mobile): add deep-link support for credential creation from autofill"
```

---

### Task 7: Add `appIdentifiers` to edit screen

**Files:**
- Modify: `apps/mobile/app/item/edit.tsx`

- [ ] **Step 1: Add `appIdentifiers` state and initialization**

In `apps/mobile/app/item/edit.tsx`, add state for appIdentifiers and load from existing item:

```typescript
const [appIdentifiers, setAppIdentifiers] = useState<string[]>([]);
```

Initialize from the item directly in the `useState` call (matching the existing pattern in the edit screen where state is initialized from `item` props, not in a separate effect):

```typescript
const [appIdentifiers, setAppIdentifiers] = useState<string[]>(
  item?.type === 'credential' ? ((item as Credential).appIdentifiers ?? []) : []
);
```

Import `Credential` from `@keykeykey/core/models` at the top of the file.

- [ ] **Step 2: Add `appIdentifiers` to the save logic**

In `handleSave()` (around lines 65-107), include `appIdentifiers` in the credential update:

```typescript
// In the credential case:
appIdentifiers: appIdentifiers.length > 0 ? appIdentifiers : undefined,
```

- [ ] **Step 3: Add editable `appIdentifiers` UI**

Add an editable section for app identifiers in the credential form. Include a text input to add new IDs and remove buttons on existing chips:

```typescript
{type === 'credential' && (
  <View style={{ marginBottom: 12 }}>
    <Text style={{ color: t.colors.textSecondary, fontSize: 12, marginBottom: 4 }}>
      App Identifiers
    </Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
      {appIdentifiers.map((id) => (
        <View
          key={id}
          style={{
            backgroundColor: t.colors.surfaceHover,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Text style={{ color: t.colors.text, fontSize: 12 }}>{id}</Text>
          <Pressable
            onPress={() => setAppIdentifiers((prev) => prev.filter((i) => i !== id))}
          >
            <Text style={{ color: t.colors.textSecondary, fontSize: 12 }}>✕</Text>
          </Pressable>
        </View>
      ))}
    </View>
    <TextInput
      placeholder="Add app identifier (e.g., com.example.app)"
      onSubmitEditing={(e) => {
        const value = e.nativeEvent.text.trim().toLowerCase();
        if (value && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(value)) {
          setAppIdentifiers((prev) => [...new Set([...prev, value])]);
        }
      }}
      style={{
        borderWidth: 1,
        borderColor: t.colors.border,
        borderRadius: 8,
        padding: 8,
        color: t.colors.text,
        fontSize: 14,
      }}
    />
  </View>
)}
```

- [ ] **Step 4: Test edit screen manually**

Run the app, create a credential with appIdentifiers via deep-link, then navigate to edit and verify the identifiers are displayed and editable.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/item/edit.tsx
git commit -m "feat(mobile): add appIdentifiers editing to credential edit screen"
```

---

## Chunk 3: iOS Credential Provider Extension

### Task 8: Create Expo config plugin for iOS credential provider

This is the native infrastructure. The config plugin generates the iOS extension target, entitlements, and build settings.

**Files:**
- Create: `apps/mobile/plugins/credential-provider/index.js`
- Create: `apps/mobile/plugins/credential-provider/swift/CredentialProviderViewController.swift`
- Create: `apps/mobile/plugins/credential-provider/swift/Info.plist`
- Create: `apps/mobile/plugins/credential-provider/swift/CredentialProvider.entitlements`
- Create: `apps/mobile/plugins/credential-provider/swift/KeyKeyKey-Bridging-Header.h`
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Create the config plugin directory structure**

```bash
mkdir -p apps/mobile/plugins/credential-provider/swift
```

- [ ] **Step 2: Create the Expo config plugin entry point**

Create `apps/mobile/plugins/credential-provider/index.js`:

```javascript
const {
  withXcodeProject,
  withEntitlementsPlist,
  withInfoPlist,
  IOSConfig,
} = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

const EXTENSION_NAME = 'CredentialProvider';
const BUNDLE_ID_SUFFIX = '.credential-provider';
const APP_GROUP = 'group.com.keykeykey.shared';
const KEYCHAIN_GROUP = '$(AppIdentifierPrefix)com.keykeykey.shared';

function withCredentialProvider(config) {
  // Step 1: Add App Group to main app entitlements
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.security.application-groups'] = [APP_GROUP];
    mod.modResults['keychain-access-groups'] = [
      '$(AppIdentifierPrefix)$(CFBundleIdentifier)',
      KEYCHAIN_GROUP,
    ];
    return mod;
  });

  // Step 1b: Write the resolved Keychain access group to Info.plist
  // so Swift code can read it at runtime ($(AppIdentifierPrefix) only
  // expands in plist/entitlements, not in Swift source)
  config = withInfoPlist(config, (mod) => {
    mod.modResults['KeychainAccessGroup'] = '$(AppIdentifierPrefix)com.keykeykey.shared';
    return mod;
  });

  // Step 2: Add Associated Domains to main app
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.developer.associated-domains'] = [
      'webcredentials:keykeykey.com',
    ];
    return mod;
  });

  // Step 3: Add extension target to Xcode project
  config = withXcodeProject(config, (mod) => {
    const project = mod.modRequest.projectRoot;
    const extensionDir = path.join(project, 'ios', EXTENSION_NAME);

    // Create extension directory and copy Swift files
    if (!fs.existsSync(extensionDir)) {
      fs.mkdirSync(extensionDir, { recursive: true });
    }

    const swiftSrcDir = path.join(__dirname, 'swift');
    for (const file of fs.readdirSync(swiftSrcDir)) {
      fs.copyFileSync(
        path.join(swiftSrcDir, file),
        path.join(extensionDir, file),
      );
    }

    // Add extension target to Xcode project
    // This is a simplified version — production implementation uses
    // @bacons/apple-targets or manual pbxproj manipulation
    const xcodeProject = mod.modResults;

    // Add the extension target group
    const extGroup = xcodeProject.addPbxGroup(
      [
        'CredentialProviderViewController.swift',
        'Info.plist',
        'CredentialProvider.entitlements',
      ],
      EXTENSION_NAME,
      EXTENSION_NAME,
    );

    // Note: Full Xcode target creation requires additional pbxproj
    // manipulation for:
    // - Creating the native target
    // - Adding build configurations (Debug/Release)
    // - Setting bundle identifier
    // - Linking frameworks (AuthenticationServices, Security, libargon2, libsodium)
    // - Setting deployment target
    // - Configuring code signing
    //
    // Consider using @bacons/apple-targets Expo plugin for robust
    // target generation, or implement full pbxproj manipulation here.

    return mod;
  });

  return config;
}

module.exports = withCredentialProvider;
```

- [ ] **Step 3: Create the extension entitlements**

Create `apps/mobile/plugins/credential-provider/swift/CredentialProvider.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>group.com.keykeykey.shared</string>
    </array>
    <key>keychain-access-groups</key>
    <array>
        <string>$(AppIdentifierPrefix)com.keykeykey.shared</string>
    </array>
</dict>
</plist>
```

- [ ] **Step 4: Create the extension Info.plist**

Create `apps/mobile/plugins/credential-provider/swift/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>KeyKeyKey</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleShortVersionString</key>
    <string>0.0.1</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.authentication-services-credential-provider-ui</string>
        <key>NSExtensionPrincipalClass</key>
        <string>$(PRODUCT_MODULE_NAME).CredentialProviderViewController</string>
    </dict>
</dict>
</plist>
```

- [ ] **Step 5: Create the credential provider view controller (skeleton)**

Create `apps/mobile/plugins/credential-provider/swift/CredentialProviderViewController.swift`:

```swift
import AuthenticationServices
import UIKit
import Security
import CommonCrypto

class CredentialProviderViewController: ASCredentialProviderViewController {

    // MARK: - Lifecycle

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        // Called when the user selects KeyKeyKey from the autofill prompt.
        // serviceIdentifiers contains the requesting app's domain or bundle ID.
        //
        // Flow:
        // 1. Check auth state (biometric DEK in Keychain? PIN data?)
        // 2. Present auth UI
        // 3. After auth, search vault for matching credentials
        // 4. Show match list, search, or create-new UI
        //
        // TODO: Implement in Task 9
    }

    override func provideCredentialWithoutUserInteraction(
        for credentialIdentity: ASPasswordCredentialIdentity
    ) {
        // Called when iOS wants to auto-fill without showing UI.
        // Only possible if biometric DEK is available and valid.
        //
        // For v1, we always require user interaction:
        self.extensionContext.cancelRequest(
            withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.userInteractionRequired.rawValue
            )
        )
    }

    override func prepareInterfaceToProvideCredential(
        for credentialIdentity: ASPasswordCredentialIdentity
    ) {
        // Called when the user selects a specific credential from the QuickType bar.
        // TODO: Implement in Task 9 — auth then fill
    }

    // MARK: - Helpers

    private func cancelAndDismiss() {
        self.extensionContext.cancelRequest(
            withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.userCanceled.rawValue
            )
        )
    }

    private func completeWithCredential(username: String, password: String) {
        let credential = ASPasswordCredential(user: username, password: password)
        self.extensionContext.completeRequest(withSelectedCredential: credential)
    }
}
```

- [ ] **Step 6: Register the plugin in app.json**

Add to `apps/mobile/app.json` plugins array:

```json
"./plugins/credential-provider"
```

- [ ] **Step 7: Verify the config plugin runs without errors**

Run: `cd apps/mobile && npx expo prebuild --clean --platform ios 2>&1 | head -50`
Expected: No errors. Check that `ios/CredentialProvider/` directory is created with the Swift files.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/plugins/credential-provider/ apps/mobile/app.json
git commit -m "feat(mobile): add iOS credential provider extension config plugin skeleton"
```

---

### Task 9: Implement iOS credential provider vault access and UI

This task builds the Swift vault access layer and SwiftUI credential selection UI for the iOS extension.

**Files:**
- Create: `apps/mobile/plugins/credential-provider/swift/VaultAccess.swift`
- Create: `apps/mobile/plugins/credential-provider/swift/KeychainHelper.swift`
- Create: `apps/mobile/plugins/credential-provider/swift/CredentialListView.swift`
- Create: `apps/mobile/plugins/credential-provider/swift/UnlockView.swift`
- Modify: `apps/mobile/plugins/credential-provider/swift/CredentialProviderViewController.swift`

- [ ] **Step 1: Create the Keychain helper**

Create `apps/mobile/plugins/credential-provider/swift/KeychainHelper.swift`:

```swift
import Foundation
import Security
import LocalAuthentication

/// Reads and writes to the shared Keychain access group
/// used by both the main app and credential provider extension.
struct KeychainHelper {
    // The access group requires the Team ID prefix at runtime.
    // $(AppIdentifierPrefix) only expands at build time in plist/entitlements files,
    // NOT in Swift source code. We read it from Info.plist where the config plugin
    // writes the resolved value.
    static let accessGroup: String = {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "KeychainAccessGroup") as? String else {
            // Fallback: use the first access group from entitlements
            // In production, the config plugin MUST set KeychainAccessGroup in Info.plist
            fatalError("KeychainAccessGroup not configured in Info.plist")
        }
        return group
    }()

    /// Read a value from the shared Keychain.
    static func read(key: String, requireBiometric: Bool = false) -> Data? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        if requireBiometric {
            let context = LAContext()
            context.localizedReason = "Unlock KeyKeyKey"
            query[kSecUseAuthenticationContext as String] = context
        }

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    /// Write a value to the shared Keychain.
    static func write(key: String, data: Data, requireBiometric: Bool = false) -> Bool {
        // Delete existing item first
        delete(key: key)

        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        if requireBiometric {
            let access = SecAccessControlCreateWithFlags(
                nil,
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                .biometryCurrentSet,
                nil
            )
            query[kSecAttrAccessControl as String] = access
            query.removeValue(forKey: kSecAttrAccessible as String)
        }

        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    /// Delete a value from the shared Keychain.
    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // Keychain keys (must match the React Native storage layer)
    static let vaultHeaderKey = "keykeykey_vault_header"
    static let biometricDEKKey = "keykeykey_biometric_dek"
    static let pinDataKey = "keykeykey_pin_data"
}
```

- [ ] **Step 2: Create the vault access layer**

Create `apps/mobile/plugins/credential-provider/swift/VaultAccess.swift`:

```swift
import Foundation
import Security

/// Lightweight vault access for the credential provider extension.
/// Reads encrypted items from shared SQLite, decrypts with DEK.
///
/// Dependencies:
/// - libargon2 for master password KDF
/// - libsodium for XChaCha20-Poly1305 decryption
///
/// Note: This is a skeleton. Full implementation requires:
/// - Linking libargon2 and libsodium to the extension target
/// - Implementing the SQLite shared database reader
/// - Implementing the vault header parser (matching core's format)
struct VaultAccess {

    struct MatchedCredential {
        let id: String
        let name: String
        let username: String
        let password: String
        let url: String?
        let appIdentifiers: [String]
    }

    enum AuthMethod {
        case biometric
        case pin
        case masterPassword
    }

    /// Determine which authentication method is available.
    static func availableAuthMethod() -> AuthMethod {
        // Check for biometric DEK in shared Keychain
        if KeychainHelper.read(key: KeychainHelper.biometricDEKKey) != nil {
            return .biometric
        }
        // Check for PIN data in shared Keychain
        if KeychainHelper.read(key: KeychainHelper.pinDataKey) != nil {
            return .pin
        }
        return .masterPassword
    }

    /// Authenticate with biometric and return the DEK.
    static func unlockWithBiometric() -> Data? {
        // Read biometric DEK — this triggers Face ID/Touch ID
        guard let dekData = KeychainHelper.read(
            key: KeychainHelper.biometricDEKKey,
            requireBiometric: true
        ) else {
            return nil
        }

        // Parse the stored JSON: { "dek": "<base64>", "savedAt": "<iso>" }
        guard let json = try? JSONSerialization.jsonObject(with: dekData) as? [String: String],
              let dekBase64 = json["dek"],
              let dek = Data(base64Encoded: dekBase64) else {
            return nil
        }

        // Check expiry (14 days)
        if let savedAt = json["savedAt"],
           let savedDate = ISO8601DateFormatter().date(from: savedAt),
           Date().timeIntervalSince(savedDate) > 14 * 24 * 60 * 60 {
            return nil // Expired
        }

        return dek
    }

    /// Search the vault for credentials matching an app identifier or domain.
    /// Returns matched credentials from the shared SQLite database.
    ///
    /// TODO: Implement SQLite access and XChaCha20-Poly1305 decryption
    /// when libsodium is linked to the extension target.
    static func findCredentials(
        appIdentifier: String?,
        domain: String?,
        dek: Data
    ) -> [MatchedCredential] {
        // Skeleton — will be implemented when native crypto is linked:
        // 1. Open shared SQLite DB from App Group container
        // 2. Read all encrypted items
        // 3. Decrypt each with DEK using XChaCha20-Poly1305 (libsodium)
        // 4. Parse JSON, filter by appIdentifier/domain
        // 5. Return matching credentials
        return []
    }

    /// Associate an app identifier with an existing credential.
    ///
    /// TODO: Implement when SQLite write access is available
    static func associateAppIdentifier(
        credentialId: String,
        appIdentifier: String,
        dek: Data
    ) -> Bool {
        // 1. Read the encrypted credential from SQLite
        // 2. Decrypt with DEK
        // 3. Add appIdentifier to appIdentifiers array
        // 4. Re-encrypt with DEK
        // 5. Write back to SQLite
        return false
    }
}
```

- [ ] **Step 3: Create the SwiftUI credential list view**

Create `apps/mobile/plugins/credential-provider/swift/CredentialListView.swift`:

```swift
import SwiftUI
import AuthenticationServices

/// Displays matching credentials for the user to select,
/// or shows search/create options when no match is found.
struct CredentialListView: View {
    let credentials: [VaultAccess.MatchedCredential]
    let serviceIdentifiers: [ASCredentialServiceIdentifier]
    let onSelect: (VaultAccess.MatchedCredential) -> Void
    let onSearch: () -> Void
    let onCreate: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationView {
            Group {
                if credentials.isEmpty {
                    noMatchView
                } else {
                    matchListView
                }
            }
            .navigationTitle("KeyKeyKey")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
            }
        }
    }

    private var matchListView: some View {
        List {
            Section(header: Text("Matching Credentials")) {
                ForEach(credentials, id: \.id) { credential in
                    Button(action: { onSelect(credential) }) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(credential.name)
                                .font(.headline)
                                .foregroundColor(.primary)
                            Text(credential.username)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }

            Section {
                Button(action: onSearch) {
                    Label("Search vault", systemImage: "magnifyingglass")
                }
                Button(action: onCreate) {
                    Label("Create new credential", systemImage: "plus")
                }
            }
        }
    }

    private var noMatchView: some View {
        VStack(spacing: 20) {
            Image(systemName: "key.slash")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("No matching credentials found")
                .font(.headline)

            Text("Search your vault or create a new credential")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            VStack(spacing: 12) {
                Button(action: onSearch) {
                    Label("Search vault", systemImage: "magnifyingglass")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button(action: onCreate) {
                    Label("Create new credential", systemImage: "plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .padding(.horizontal, 40)
        }
        .padding()
    }
}
```

- [ ] **Step 4: Create the unlock view**

Create `apps/mobile/plugins/credential-provider/swift/UnlockView.swift`:

```swift
import SwiftUI

/// Authentication UI for the credential provider extension.
/// Supports biometric, PIN, and master password unlock.
struct UnlockView: View {
    let authMethod: VaultAccess.AuthMethod
    let onBiometricUnlock: () -> Void
    let onPinUnlock: (String) -> Void
    let onPasswordUnlock: (String) -> Void
    let onCancel: () -> Void

    @State private var pin = ""
    @State private var password = ""
    @State private var error = ""
    @State private var isLoading = false

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 48))
                    .foregroundColor(.accentColor)

                Text("KeyKeyKey")
                    .font(.title2.bold())

                switch authMethod {
                case .biometric:
                    biometricView
                case .pin:
                    pinView
                case .masterPassword:
                    passwordView
                }

                if !error.isEmpty {
                    Text(error)
                        .font(.footnote)
                        .foregroundColor(.red)
                }
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
            }
        }
    }

    private var biometricView: some View {
        VStack(spacing: 16) {
            Text("Authenticate to autofill")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Button(action: onBiometricUnlock) {
                Label("Unlock with Face ID", systemImage: "faceid")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 40)
        }
    }

    private var pinView: some View {
        VStack(spacing: 16) {
            Text("Enter your PIN")
                .font(.subheadline)
                .foregroundColor(.secondary)
            SecureField("PIN", text: $pin)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .frame(maxWidth: 200)
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.center)
            Button("Unlock") {
                onPinUnlock(pin)
            }
            .buttonStyle(.borderedProminent)
            .disabled(pin.count < 4)
        }
    }

    private var passwordView: some View {
        VStack(spacing: 16) {
            Text("Enter your master password")
                .font(.subheadline)
                .foregroundColor(.secondary)
            SecureField("Master Password", text: $password)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 300)
            Button("Unlock") {
                isLoading = true
                onPasswordUnlock(password)
            }
            .buttonStyle(.borderedProminent)
            .disabled(password.isEmpty || isLoading)

            if isLoading {
                ProgressView("Deriving encryption key...")
                    .font(.footnote)
            }
        }
    }
}
```

- [ ] **Step 5: Wire up the view controller**

Update `apps/mobile/plugins/credential-provider/swift/CredentialProviderViewController.swift` to use the SwiftUI views:

```swift
import AuthenticationServices
import UIKit
import SwiftUI
import Security

class CredentialProviderViewController: ASCredentialProviderViewController {

    private var dek: Data?
    private var currentServiceIdentifiers: [ASCredentialServiceIdentifier] = []

    // MARK: - Lifecycle

    override func prepareCredentialList(
        for serviceIdentifiers: [ASCredentialServiceIdentifier]
    ) {
        self.currentServiceIdentifiers = serviceIdentifiers
        let authMethod = VaultAccess.availableAuthMethod()
        showUnlockUI(authMethod: authMethod)
    }

    override func provideCredentialWithoutUserInteraction(
        for credentialIdentity: ASPasswordCredentialIdentity
    ) {
        // Always require user interaction for v1
        self.extensionContext.cancelRequest(
            withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.userInteractionRequired.rawValue
            )
        )
    }

    override func prepareInterfaceToProvideCredential(
        for credentialIdentity: ASPasswordCredentialIdentity
    ) {
        let authMethod = VaultAccess.availableAuthMethod()
        showUnlockUI(authMethod: authMethod)
    }

    // MARK: - UI Flow

    private func showUnlockUI(authMethod: VaultAccess.AuthMethod) {
        let unlockView = UnlockView(
            authMethod: authMethod,
            onBiometricUnlock: { [weak self] in
                self?.handleBiometricUnlock()
            },
            onPinUnlock: { [weak self] pin in
                self?.handlePinUnlock(pin: pin)
            },
            onPasswordUnlock: { [weak self] password in
                self?.handlePasswordUnlock(password: password)
            },
            onCancel: { [weak self] in
                self?.cancelAndDismiss()
            }
        )
        let hostingController = UIHostingController(rootView: unlockView)
        addChild(hostingController)
        view.addSubview(hostingController.view)
        hostingController.view.frame = view.bounds
        hostingController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        hostingController.didMove(toParent: self)
    }

    private func handleBiometricUnlock() {
        guard let dek = VaultAccess.unlockWithBiometric() else {
            // Biometric failed — fall back to PIN or password
            let fallback: VaultAccess.AuthMethod =
                KeychainHelper.read(key: KeychainHelper.pinDataKey) != nil
                    ? .pin : .masterPassword
            clearChildViewControllers()
            showUnlockUI(authMethod: fallback)
            return
        }
        self.dek = dek
        showCredentialList()
    }

    private func handlePinUnlock(pin: String) {
        // TODO: Implement PIN unwrap when crypto is linked
        // 1. Read PIN-wrapped DEK from shared Keychain
        // 2. Derive unwrap key from PIN + salt via PBKDF2
        // 3. Unwrap DEK
        // For now, fall back to master password
        clearChildViewControllers()
        showUnlockUI(authMethod: .masterPassword)
    }

    private func handlePasswordUnlock(password: String) {
        // TODO: Implement when libargon2 is linked
        // 1. Read vault header from shared Keychain
        // 2. Derive KEK from master password via Argon2id (libargon2)
        // 3. Unwrap DEK from vault header
        // 4. Store DEK and show credential list
    }

    private func showCredentialList() {
        guard let dek = self.dek else { return }

        // Extract app identifier or domain from service identifiers
        var appIdentifier: String?
        var domain: String?
        for si in currentServiceIdentifiers {
            switch si.type {
            case .domain:
                domain = si.identifier
            case .URL:
                if let url = URL(string: si.identifier) {
                    domain = url.host
                }
            @unknown default:
                break
            }
        }

        let credentials = VaultAccess.findCredentials(
            appIdentifier: appIdentifier,
            domain: domain,
            dek: dek
        )

        clearChildViewControllers()

        let listView = CredentialListView(
            credentials: credentials,
            serviceIdentifiers: currentServiceIdentifiers,
            onSelect: { [weak self] credential in
                self?.completeWithCredential(
                    username: credential.username,
                    password: credential.password
                )
            },
            onSearch: { [weak self] in
                // TODO: Show search UI
            },
            onCreate: { [weak self] in
                // iOS credential provider extensions cannot deep-link to the
                // containing app. Write a pending flag to shared UserDefaults
                // and prompt the user to open the app.
                let domain = self?.currentServiceIdentifiers.first?.identifier
                self?.requestCreateCredential(domain: domain, appIdentifier: nil)
            },
            onCancel: { [weak self] in
                self?.cancelAndDismiss()
            }
        )

        let hostingController = UIHostingController(rootView: listView)
        addChild(hostingController)
        view.addSubview(hostingController.view)
        hostingController.view.frame = view.bounds
        hostingController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        hostingController.didMove(toParent: self)
    }

    /// "Create new" flow: iOS credential provider extensions cannot open URLs
    /// or deep-link to the containing app directly (extensionContext.open is
    /// not available on ASCredentialProviderExtensionContext).
    ///
    /// Instead, write a flag to the shared App Group UserDefaults with the
    /// requesting domain/app ID. When the main app next launches, it checks
    /// for this flag and opens the add screen pre-populated.
    private func requestCreateCredential(domain: String?, appIdentifier: String?) {
        let defaults = UserDefaults(suiteName: "group.com.keykeykey.shared")
        var pendingCreate: [String: String] = [:]
        if let domain = domain { pendingCreate["domain"] = domain }
        if let appIdentifier = appIdentifier { pendingCreate["appIdentifier"] = appIdentifier }
        defaults?.set(pendingCreate, forKey: "pending_create_credential")
        defaults?.synchronize()

        // Show a message to the user and dismiss
        let alert = UIAlertController(
            title: "Open KeyKeyKey",
            message: "Please open KeyKeyKey to create a new credential for this app.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
            self?.cancelAndDismiss()
        })
        present(alert, animated: true)
    }

    // MARK: - Helpers

    private func cancelAndDismiss() {
        zeroDEK()
        self.extensionContext.cancelRequest(
            withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.userCanceled.rawValue
            )
        )
    }

    private func completeWithCredential(username: String, password: String) {
        let credential = ASPasswordCredential(user: username, password: password)
        zeroDEK()
        self.extensionContext.completeRequest(withSelectedCredential: credential)
    }

    private func zeroDEK() {
        if var dek = self.dek {
            dek.resetBytes(in: 0..<dek.count)
            self.dek = nil
        }
    }

    private func clearChildViewControllers() {
        for child in children {
            child.willMove(toParent: nil)
            child.view.removeFromSuperview()
            child.removeFromParent()
        }
    }
}
```

- [ ] **Step 6: Verify the extension builds**

Run: `cd apps/mobile && npx expo prebuild --clean --platform ios && xcodebuild -workspace ios/keykeykey.xcworkspace -scheme CredentialProvider -sdk iphonesimulator build 2>&1 | tail -20`
Expected: Build succeeds (may have warnings for unimplemented TODOs)

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/plugins/credential-provider/swift/
git commit -m "feat(mobile): implement iOS credential provider vault access and SwiftUI UI"
```

---

## Chunk 4: Android Autofill Service

### Task 10: Create Expo config plugin for Android AutofillService

**Files:**
- Create: `apps/mobile/plugins/autofill-service/index.js`
- Create: `apps/mobile/plugins/autofill-service/android/AutofillServiceImpl.kt`
- Create: `apps/mobile/plugins/autofill-service/android/autofill_service.xml`
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Create the plugin directory**

```bash
mkdir -p apps/mobile/plugins/autofill-service/android
```

- [ ] **Step 2: Create the Expo config plugin**

Create `apps/mobile/plugins/autofill-service/index.js`:

```javascript
const {
  withAndroidManifest,
  AndroidConfig,
} = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

function withAutofillService(config) {
  config = withAndroidManifest(config, (mod) => {
    const mainApplication =
      mod.modResults.manifest.application?.[0];
    if (!mainApplication) return mod;

    // Add AutofillService declaration
    if (!mainApplication.service) {
      mainApplication.service = [];
    }

    const serviceExists = mainApplication.service.some(
      (s) => s.$?.['android:name'] === '.AutofillServiceImpl'
    );

    if (!serviceExists) {
      mainApplication.service.push({
        $: {
          'android:name': '.AutofillServiceImpl',
          'android:permission': 'android.permission.BIND_AUTOFILL_SERVICE',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.service.autofill.AutofillService',
                },
              },
            ],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.autofill',
              'android:resource': '@xml/autofill_service',
            },
          },
        ],
      });
    }

    return mod;
  });

  // Copy Kotlin and XML files during prebuild
  config = withAndroidManifest(config, (mod) => {
    const projectRoot = mod.modRequest.projectRoot;
    const androidSrcDir = path.join(
      projectRoot,
      'android/app/src/main/java/com/keykeykey/app'
    );
    const androidResDir = path.join(
      projectRoot,
      'android/app/src/main/res/xml'
    );

    // Copy Kotlin file
    if (!fs.existsSync(androidSrcDir)) {
      fs.mkdirSync(androidSrcDir, { recursive: true });
    }
    fs.copyFileSync(
      path.join(__dirname, 'android/AutofillServiceImpl.kt'),
      path.join(androidSrcDir, 'AutofillServiceImpl.kt')
    );

    // Copy XML metadata
    if (!fs.existsSync(androidResDir)) {
      fs.mkdirSync(androidResDir, { recursive: true });
    }
    fs.copyFileSync(
      path.join(__dirname, 'android/autofill_service.xml'),
      path.join(androidResDir, 'autofill_service.xml')
    );

    return mod;
  });

  return config;
}

module.exports = withAutofillService;
```

- [ ] **Step 3: Create the autofill service metadata XML**

Create `apps/mobile/plugins/autofill-service/android/autofill_service.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<autofill-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:settingsActivity="com.keykeykey.app.MainActivity" />
```

- [ ] **Step 4: Create the AutofillService Kotlin implementation (skeleton)**

Create `apps/mobile/plugins/autofill-service/android/AutofillServiceImpl.kt`:

```kotlin
package com.keykeykey.app

import android.app.assist.AssistStructure
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.Dataset
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews

/**
 * Android Autofill Service for KeyKeyKey.
 *
 * Runs in the same app process as the React Native app,
 * so it can access the vault store directly.
 *
 * Flow:
 * 1. onFillRequest: System calls when user focuses an autofill-eligible field
 * 2. Parse the AssistStructure to find username/password fields
 * 3. Look up matching credentials by package name or web domain
 * 4. Return FillResponse with Dataset entries
 *
 * onSaveRequest: System calls after successful form submission
 * with new credentials to save.
 */
class AutofillServiceImpl : AutofillService() {

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) {
            callback.onSuccess(null)
            return
        }

        // Extract autofill fields from the assist structure
        val fields = parseStructure(structure)
        if (fields.usernameId == null && fields.passwordId == null) {
            callback.onSuccess(null)
            return
        }

        val packageName = structure.activityComponent?.packageName
        val webDomain = fields.webDomain

        // TODO: Look up credentials via vault store
        // For now, return null (no suggestions)
        // When implemented:
        // 1. Check if vault is unlocked
        // 2. If locked, show authentication intent
        // 3. Search by packageName (appIdentifiers) then webDomain
        // 4. Build FillResponse with Dataset entries

        callback.onSuccess(null)
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) {
            callback.onSuccess()
            return
        }

        val fields = parseStructure(structure)
        val packageName = structure.activityComponent?.packageName

        // TODO: Extract username/password values from filled fields
        // and pass to React Native add screen via in-memory singleton
        // (never via Intent extras or URLs)

        callback.onSuccess()
    }

    // MARK: - Structure Parsing

    private data class AutofillFields(
        val usernameId: AutofillId? = null,
        val passwordId: AutofillId? = null,
        val webDomain: String? = null,
    )

    private fun parseStructure(structure: AssistStructure): AutofillFields {
        var usernameId: AutofillId? = null
        var passwordId: AutofillId? = null
        var webDomain: String? = null

        for (i in 0 until structure.windowNodeCount) {
            val windowNode = structure.getWindowNodeAt(i)
            val rootNode = windowNode.rootViewNode
            traverseNode(rootNode) { node ->
                // Extract web domain
                if (node.webDomain != null && webDomain == null) {
                    webDomain = node.webDomain
                }

                // Match by autofill hints
                val hints = node.autofillHints
                if (hints != null) {
                    for (hint in hints) {
                        when (hint) {
                            "username", "emailAddress" -> {
                                if (usernameId == null) usernameId = node.autofillId
                            }
                            "password" -> {
                                if (passwordId == null) passwordId = node.autofillId
                            }
                        }
                    }
                }

                // Fallback: match by input type
                if (node.autofillId != null) {
                    val inputType = node.inputType
                    if (inputType and android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD != 0 ||
                        inputType and android.text.InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD != 0
                    ) {
                        if (passwordId == null) passwordId = node.autofillId
                    }
                    if (inputType and android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS != 0 ||
                        inputType and android.text.InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS != 0
                    ) {
                        if (usernameId == null) usernameId = node.autofillId
                    }
                }
            }
        }

        return AutofillFields(usernameId, passwordId, webDomain)
    }

    private fun traverseNode(
        node: AssistStructure.ViewNode,
        action: (AssistStructure.ViewNode) -> Unit
    ) {
        action(node)
        for (i in 0 until node.childCount) {
            traverseNode(node.getChildAt(i), action)
        }
    }
}
```

- [ ] **Step 5: Register the plugin in app.json**

Add to `apps/mobile/app.json` plugins array:

```json
"./plugins/autofill-service"
```

- [ ] **Step 6: Verify the config plugin runs**

Run: `cd apps/mobile && npx expo prebuild --clean --platform android 2>&1 | tail -20`
Expected: No errors. Check that `android/app/src/main/java/com/keykeykey/app/AutofillServiceImpl.kt` exists and `AndroidManifest.xml` includes the service declaration.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/plugins/autofill-service/ apps/mobile/app.json
git commit -m "feat(mobile): add Android AutofillService config plugin skeleton"
```

---

### Task 11: Create in-memory credential handoff for Android save flow

The Android `onSaveRequest` needs to pass credentials to the add screen without using URL parameters. This is a simple in-memory singleton.

**Files:**
- Create: `apps/mobile/lib/autofill-handoff.ts`
- Create: `apps/mobile/lib/autofill-handoff.test.ts`

- [ ] **Step 1: Write tests**

Create `apps/mobile/lib/autofill-handoff.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { AutofillHandoff } from './autofill-handoff.js';

describe('AutofillHandoff', () => {
  beforeEach(() => {
    AutofillHandoff.clear();
  });

  it('should store and retrieve pending credentials', () => {
    AutofillHandoff.setPending({
      username: 'user@example.com',
      password: 'secret123',
      packageName: 'com.slack.android',
      domain: 'slack.com',
    });
    const pending = AutofillHandoff.consume();
    expect(pending).toEqual({
      username: 'user@example.com',
      password: 'secret123',
      packageName: 'com.slack.android',
      domain: 'slack.com',
    });
  });

  it('should clear after consume (one-time read)', () => {
    AutofillHandoff.setPending({
      username: 'user',
      password: 'pass',
      packageName: 'com.test.app',
    });
    AutofillHandoff.consume();
    expect(AutofillHandoff.consume()).toBeNull();
  });

  it('should return null when nothing is pending', () => {
    expect(AutofillHandoff.consume()).toBeNull();
  });

  it('should allow clearing without consuming', () => {
    AutofillHandoff.setPending({
      username: 'user',
      password: 'pass',
      packageName: 'com.test.app',
    });
    AutofillHandoff.clear();
    expect(AutofillHandoff.consume()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/mobile test -- --run lib/autofill-handoff.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement the handoff singleton**

Create `apps/mobile/lib/autofill-handoff.ts`:

```typescript
export interface PendingCredential {
  username: string;
  password: string;
  packageName: string;
  domain?: string;
}

/**
 * In-memory singleton for passing credentials from Android AutofillService
 * to the add screen. Never passes credentials via URL or Intent extras.
 * Data is consumed (cleared) on first read.
 */
export class AutofillHandoff {
  private static pending: PendingCredential | null = null;

  static setPending(credential: PendingCredential): void {
    AutofillHandoff.pending = credential;
  }

  static consume(): PendingCredential | null {
    const result = AutofillHandoff.pending;
    AutofillHandoff.pending = null;
    return result;
  }

  static clear(): void {
    AutofillHandoff.pending = null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/mobile test -- --run lib/autofill-handoff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/autofill-handoff.ts apps/mobile/lib/autofill-handoff.test.ts
git commit -m "feat(mobile): add in-memory credential handoff for Android autofill save flow"
```

---

## Chunk 5: Integration & Manual Testing

### Task 12: Update vault context to handle `appIdentifiers` in CRUD operations

**Files:**
- Modify: `apps/mobile/lib/vault-context.tsx`

- [ ] **Step 1: Verify that `addItem` and `updateItem` already support `appIdentifiers`**

The vault context's `addItem` and `updateItem` methods pass through to the core vault store, which uses the Zod schema for validation. Since we added `appIdentifiers` to the schema (Task 2), these methods should already accept the field without modification.

Write a manual verification: add a credential with `appIdentifiers` via the add screen (Task 6) and verify it persists and appears correctly in the vault list.

- [ ] **Step 2: Add `appIdentifiers` to the search function**

The core vault store search (in `packages/core/src/store/vault-store.ts`) searches by name, URL, username, and tags. App identifiers should also be searchable so users can find credentials by app name.

This is a core change. Add to `packages/core/src/store/vault-store.ts` in the search filter, after the tags check:

```typescript
// After the tags check in the search filter:
// After Task 2 adds appIdentifiers to CredentialSchema, the discriminated
// union narrows `item` to Credential after the type guard, so
// `item.appIdentifiers` is directly available — same as `item.url` and `item.username`.
if (item.type === 'credential') {
  if (item.appIdentifiers?.some((id) => id.toLowerCase().includes(lower))) return true;
}
```

- [ ] **Step 3: Add a test for searching by appIdentifier**

Add to the search tests in `packages/core/src/store/vault-store.test.ts`. First, create a helper credential with appIdentifiers:

```typescript
it('should search by appIdentifier', async () => {
  const store = createVaultStore();
  // Setup: create vault and unlock
  const { raw: recoveryRaw } = generateRecoveryKey();
  const result = await createVaultHeader(MASTER_PASSWORD, recoveryRaw, TEST_PARAMS);
  store.getState().loadHeader(result.header);

  const item = {
    type: 'credential' as const,
    name: 'Slack',
    username: 'user@company.com',
    password: 'secret',
    url: 'https://slack.com',
    appIdentifiers: ['com.slack.android'],
    tags: [],
    favorite: false,
  };

  const encItem = encryptVaultItem(item, result.dek);
  await store.getState().unlock(MASTER_PASSWORD, [encItem]);

  const results = store.getState().search('slack.android');
  expect(results).toHaveLength(1);
  expect(results[0]!.name).toBe('Slack');
});
```

Note: Adapt `encryptVaultItem` usage to match the existing test helper pattern in the file — check how other search tests set up their data.

- [ ] **Step 4: Run core tests**

Run: `pnpm --filter @keykeykey/core test -- --run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/vault-store.ts packages/core/src/store/vault-store.test.ts
git commit -m "feat(core): include appIdentifiers in vault search"
```

---

### Task 13: Manual test protocol documentation

**Files:**
- Create: `apps/mobile/docs/autofill-testing.md`

- [ ] **Step 1: Write the manual test protocol**

Create `apps/mobile/docs/autofill-testing.md`:

```markdown
# Mobile Autofill Manual Test Protocol

## Prerequisites
- Physical iOS device or iOS Simulator (iOS 16+)
- Android emulator (API 26+) or physical device
- KeyKeyKey app installed with a vault containing test credentials

## iOS Testing

### Setup
1. Install the app on device/simulator
2. Go to Settings → Passwords → AutoFill Passwords
3. Enable "AutoFill Passwords"
4. Toggle on "KeyKeyKey"

### Test Cases

#### TC-1: Fill existing credential
1. Open Safari and navigate to a login page (e.g., github.com)
2. Tap the username field
3. Verify KeyKeyKey appears in the autofill prompt
4. Tap KeyKeyKey
5. Authenticate (Face ID/PIN/password depending on config)
6. Verify matching credentials are listed
7. Tap a credential
8. Verify username and password are filled

#### TC-2: No match — Create new
1. Open Safari and navigate to a site with no saved credentials
2. Tap the username field → select KeyKeyKey
3. Authenticate
4. Verify "No matching credentials" screen appears
5. Tap "Create new credential"
6. Verify main app opens to add screen with domain pre-populated
7. Save the credential
8. Return to Safari and retry — should now match

#### TC-3: No match — Search existing
1. Open Safari and navigate to a site
2. Select KeyKeyKey → authenticate
3. Tap "Search vault"
4. Search for an existing credential
5. Select it
6. Verify the app identifier/domain is associated
7. Verify the credential fills
8. Next visit should match automatically

#### TC-4: Auth fallback chain
1. With biometric enabled: verify Face ID/Touch ID prompt
2. Cancel biometric: verify PIN pad appears
3. Enter wrong PIN 5 times: verify master password screen appears
4. Enter correct master password: verify unlock and credential list

## Android Testing

### Setup
1. Install the app on device/emulator
2. Go to Settings → System → Languages & Input → Autofill service
3. Select "KeyKeyKey"

### Test Cases

#### TC-5: Fill via autofill prompt
1. Open Chrome and navigate to a login page
2. Tap the username field
3. Verify KeyKeyKey autofill suggestion appears
4. Tap it → authenticate → select credential → verify fill

#### TC-6: Save on form submission
1. Open Chrome and navigate to a login page
2. Enter new credentials manually and submit
3. Verify "Save to KeyKeyKey?" prompt appears
4. Accept → verify add screen opens with pre-populated data
5. Save and verify credential appears in vault

#### TC-7: Native app autofill
1. Open a third-party app (e.g., Slack)
2. Tap login field
3. Verify KeyKeyKey appears as autofill option
4. Complete the fill flow
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/docs/autofill-testing.md
git commit -m "docs(mobile): add autofill manual test protocol"
```
