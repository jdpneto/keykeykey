# Encrypted Sync & Vault Restore Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt the sync manifest with a password-derived key (MEK), store the vault header inside the encrypted blob, and enable cross-device vault restore from cloud.

**Architecture:** A new `vault-blob.ts` module handles MEK derivation, vault blob encryption/decryption, and preamble parsing. The `ISyncAdapter` interface replaces `readManifest`/`writeManifest` with `readVaultBlob`/`writeVaultBlob` (opaque bytes). `SyncEngine` takes the MEK as a constructor param and encrypts/decrypts the blob on every sync. A new `restoreFromCloud` function downloads the blob, decrypts with master password, and returns the vault header + items. Each platform wires this into the setup screen's "Restore from Cloud" button.

**Tech Stack:** TypeScript, Zod, XChaCha20-Poly1305 (`@noble/ciphers`), Argon2id (pluggable adapter), Vitest, Zustand

**Spec:** `docs/superpowers/specs/2026-03-18-encrypted-sync-and-vault-restore-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `packages/core/src/sync/vault-blob.ts` | `VaultBlobSchema`, `encryptVaultBlob()`, `decryptVaultBlob()`, `readPreambleFromBlob()`, `validateArgon2Params()`, `deriveMEK()`, `generateSyncSalt()`, `PREAMBLE_SIZE` |
| `packages/core/src/sync/vault-blob.test.ts` | Tests for vault blob encryption, decryption, preamble, param validation, MEK derivation |
| `packages/core/src/sync/restore.ts` | `restoreFromCloud()` function |
| `packages/core/src/sync/restore.test.ts` | Tests for restore flow |
| `apps/desktop/src/screens/RestoreScreen.tsx` | Restore from Cloud UI (multi-step wizard) |

### Modified files

| File | Changes |
|------|---------|
| `packages/core/src/sync/types.ts` | Replace `readManifest`/`writeManifest` with `readVaultBlob`/`writeVaultBlob` + optional legacy methods on `ISyncAdapter` |
| `packages/core/src/sync/sync-engine.ts` | Add `mek`, `syncSalt`, `vaultHeaderBytes`, `argon2Params` to `SyncEngineOptions`; replace `onVaultReplaced` with `onVaultMismatch`; encrypt/decrypt vault blob in `_runSync` |
| `packages/core/src/sync/webdav-adapter.ts` | Replace `readManifest`/`writeManifest` with `readVaultBlob`/`writeVaultBlob` + legacy migration |
| `packages/core/src/sync/webdav-adapter.test.ts` | Update tests for new adapter interface |
| `packages/core/src/sync/google-drive-adapter.ts` | Same adapter changes |
| `packages/core/src/sync/google-drive-adapter.test.ts` | Update tests |
| `packages/core/src/sync/icloud-adapter.ts` | Same adapter changes |
| `packages/core/src/sync/icloud-adapter.test.ts` | Update tests |
| `packages/core/src/sync/memory-adapter.ts` | Same adapter changes (Uint8Array storage) |
| `packages/core/src/sync/sync-config.ts` | Update `createSyncEngineFromConfig` to accept MEK/salt/header params |
| `packages/core/src/sync/connect.test.ts` | Update to use new SyncEngineOptions |
| `packages/core/src/sync/sync.test.ts` | Update to use encrypted vault blobs |
| `packages/core/src/sync/index.ts` | Export new vault-blob and restore functions |
| `apps/desktop/src/lib/vault-context.tsx` | Add `mekRef`/`syncSaltRef`, derive MEK on unlock, pass to SyncEngine, add `restoreFromCloud` action |
| `apps/desktop/src/lib/sync.ts` | Export `deriveMEK` for vault-context, update `createSyncEngineFromConfig` usage |
| `apps/desktop/src/screens/SetupScreen.tsx` | Enable "Restore from Cloud" button, navigate to RestoreScreen |
| `apps/desktop/src/screens/SyncSettingsScreen.tsx` | Handle `onVaultMismatch` dialog (restore/replace/cancel) |
| `apps/desktop/src/App.tsx` | Add RestoreScreen route |
| `apps/desktop/src-tauri/src/http_proxy.rs` | Add URL allowlist validation |

---

## Chunk 1: Vault Blob Encryption Module

### Task 1: VaultBlob types, MEK derivation, encrypt/decrypt, preamble parsing

**Files:**

- Create: `packages/core/src/sync/vault-blob.ts`
- Create: `packages/core/src/sync/vault-blob.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/sync/vault-blob.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  encryptVaultBlob,
  decryptVaultBlob,
  readPreambleFromBlob,
  validateArgon2Params,
  deriveMEK,
  generateSyncSalt,
  PREAMBLE_SIZE,
} from './vault-blob.js';
import type { SyncManifest } from './types.js';
import type { Argon2Params } from '../crypto/constants.js';
import { randomBytes } from '@noble/hashes/utils';

const TEST_PARAMS: Argon2Params = { t: 1, m: 8192, p: 1, dkLen: 32 };

const TEST_MANIFEST: SyncManifest = {
  version: 2,
  lastModified: '2026-03-18T00:00:00Z',
  items: { 'item-1': { updatedAt: '2026-03-18T00:00:00Z', hash: 'abc123' } },
  tombstones: {},
  vaultId: 'vault-123',
};

const TEST_HEADER_BYTES = randomBytes(64); // Simulated serialized vault header

describe('PREAMBLE_SIZE', () => {
  it('should be 32 bytes (16 salt + 16 params)', () => {
    expect(PREAMBLE_SIZE).toBe(32);
  });
});

describe('generateSyncSalt', () => {
  it('should return 16 bytes', () => {
    const salt = generateSyncSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(16);
  });

  it('should produce different salts each call', () => {
    const a = generateSyncSalt();
    const b = generateSyncSalt();
    expect(a).not.toEqual(b);
  });
});

describe('deriveMEK', () => {
  it('should return 32-byte key', async () => {
    const salt = generateSyncSalt();
    const mek = await deriveMEK('password', salt, TEST_PARAMS);
    expect(mek).toBeInstanceOf(Uint8Array);
    expect(mek.length).toBe(32);
  });

  it('should produce same key for same password + salt', async () => {
    const salt = generateSyncSalt();
    const a = await deriveMEK('password', salt, TEST_PARAMS);
    const b = await deriveMEK('password', salt, TEST_PARAMS);
    expect(a).toEqual(b);
  });

  it('should produce different key for different password', async () => {
    const salt = generateSyncSalt();
    const a = await deriveMEK('password1', salt, TEST_PARAMS);
    const b = await deriveMEK('password2', salt, TEST_PARAMS);
    expect(a).not.toEqual(b);
  });

  it('should produce different key for different salt', async () => {
    const saltA = generateSyncSalt();
    const saltB = generateSyncSalt();
    const a = await deriveMEK('password', saltA, TEST_PARAMS);
    const b = await deriveMEK('password', saltB, TEST_PARAMS);
    expect(a).not.toEqual(b);
  });
});

describe('validateArgon2Params', () => {
  it('should accept valid params', () => {
    expect(() => validateArgon2Params(TEST_PARAMS)).not.toThrow();
  });

  it('should reject t = 0', () => {
    expect(() => validateArgon2Params({ ...TEST_PARAMS, t: 0 })).toThrow();
  });

  it('should reject t > 10', () => {
    expect(() => validateArgon2Params({ ...TEST_PARAMS, t: 11 })).toThrow();
  });

  it('should reject m < 8192', () => {
    expect(() => validateArgon2Params({ ...TEST_PARAMS, m: 100 })).toThrow();
  });

  it('should reject m > 262144', () => {
    expect(() => validateArgon2Params({ ...TEST_PARAMS, m: 300_000 })).toThrow();
  });

  it('should reject p = 0', () => {
    expect(() => validateArgon2Params({ ...TEST_PARAMS, p: 0 })).toThrow();
  });

  it('should reject p > 16', () => {
    expect(() => validateArgon2Params({ ...TEST_PARAMS, p: 17 })).toThrow();
  });

  it('should reject dkLen != 32', () => {
    expect(() => validateArgon2Params({ ...TEST_PARAMS, dkLen: 64 })).toThrow();
  });
});

describe('encryptVaultBlob / decryptVaultBlob', () => {
  it('should round-trip encrypt and decrypt', async () => {
    const salt = generateSyncSalt();
    const mek = await deriveMEK('test-password', salt, TEST_PARAMS);
    const encrypted = encryptVaultBlob(TEST_MANIFEST, TEST_HEADER_BYTES, mek, salt, TEST_PARAMS);
    const decrypted = decryptVaultBlob(encrypted, mek);
    expect(decrypted.version).toBe(1);
    expect(decrypted.manifest).toEqual(TEST_MANIFEST);
    expect(decrypted.argon2Params).toEqual(TEST_PARAMS);
  });

  it('should produce different ciphertext for same input (random nonce)', async () => {
    const salt = generateSyncSalt();
    const mek = await deriveMEK('test-password', salt, TEST_PARAMS);
    const a = encryptVaultBlob(TEST_MANIFEST, TEST_HEADER_BYTES, mek, salt, TEST_PARAMS);
    const b = encryptVaultBlob(TEST_MANIFEST, TEST_HEADER_BYTES, mek, salt, TEST_PARAMS);
    expect(a).not.toEqual(b);
  });

  it('should throw on wrong MEK', async () => {
    const salt = generateSyncSalt();
    const mek1 = await deriveMEK('password1', salt, TEST_PARAMS);
    const mek2 = await deriveMEK('password2', salt, TEST_PARAMS);
    const encrypted = encryptVaultBlob(TEST_MANIFEST, TEST_HEADER_BYTES, mek1, salt, TEST_PARAMS);
    expect(() => decryptVaultBlob(encrypted, mek2)).toThrow();
  });

  it('should throw on tampered ciphertext', async () => {
    const salt = generateSyncSalt();
    const mek = await deriveMEK('test-password', salt, TEST_PARAMS);
    const encrypted = encryptVaultBlob(TEST_MANIFEST, TEST_HEADER_BYTES, mek, salt, TEST_PARAMS);
    encrypted[PREAMBLE_SIZE + 10] ^= 0xff;
    expect(() => decryptVaultBlob(encrypted, mek)).toThrow();
  });

  it('should Zod-validate the decrypted blob', async () => {
    const salt = generateSyncSalt();
    const mek = await deriveMEK('test-password', salt, TEST_PARAMS);
    // Manually encrypt invalid JSON structure
    const { encrypt } = await import('../crypto/encryption.js');
    const badJson = new TextEncoder().encode('{"version": "wrong"}');
    const ciphertext = encrypt(badJson, mek);
    const blob = new Uint8Array(PREAMBLE_SIZE + ciphertext.length);
    blob.set(salt, 0);
    const view = new DataView(blob.buffer);
    view.setUint32(16, TEST_PARAMS.t, true);
    view.setUint32(20, TEST_PARAMS.m, true);
    view.setUint32(24, TEST_PARAMS.p, true);
    view.setUint32(28, TEST_PARAMS.dkLen, true);
    blob.set(ciphertext, PREAMBLE_SIZE);
    expect(() => decryptVaultBlob(blob, mek)).toThrow();
  });
});

describe('readPreambleFromBlob', () => {
  it('should extract salt and params from preamble', async () => {
    const salt = generateSyncSalt();
    const mek = await deriveMEK('test-password', salt, TEST_PARAMS);
    const encrypted = encryptVaultBlob(TEST_MANIFEST, TEST_HEADER_BYTES, mek, salt, TEST_PARAMS);
    const preamble = readPreambleFromBlob(encrypted);
    expect(preamble.syncSalt).toEqual(salt);
    expect(preamble.argon2Params).toEqual(TEST_PARAMS);
  });

  it('should throw on data shorter than 32 bytes', () => {
    expect(() => readPreambleFromBlob(new Uint8Array(10))).toThrow('too short');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- --run src/sync/vault-blob.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement vault-blob.ts**

Create `packages/core/src/sync/vault-blob.ts`:

```typescript
import { z } from 'zod';
import { encrypt, decrypt } from '../crypto/encryption.js';
import { deriveKEK } from '../crypto/kdf.js';
import { randomBytes } from '@noble/hashes/utils';
import { SALT_SIZE } from '../crypto/constants.js';
import type { Argon2Params } from '../crypto/constants.js';
import type { SyncManifest } from './types.js';

export const PREAMBLE_SIZE = 32; // 16 salt + 16 params

const Argon2ParamsSchema = z.object({
  t: z.number(),
  m: z.number(),
  p: z.number(),
  dkLen: z.number(),
});

// Reuse the SyncManifest shape — import or define inline
const SyncManifestSchema = z.object({
  version: z.number(),
  lastModified: z.string(),
  items: z.record(z.object({ updatedAt: z.string(), hash: z.string() })),
  tombstones: z.record(z.object({ deletedAt: z.string() })).optional(),
  vaultId: z.string().optional(),
});

export const VaultBlobSchema = z.object({
  version: z.literal(1),
  argon2Params: Argon2ParamsSchema,
  vaultHeader: z.string(), // Base64-encoded serialized VaultHeader
  manifest: SyncManifestSchema,
});

export type VaultBlob = z.infer<typeof VaultBlobSchema>;

function toBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return globalThis.btoa(binary);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer;
  if (B) return B.from(bytes).toString('base64');
  throw new Error('No base64 encoder available');
}

export function generateSyncSalt(): Uint8Array {
  return randomBytes(SALT_SIZE);
}

export async function deriveMEK(
  masterPassword: string,
  syncSalt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  return deriveKEK(masterPassword, syncSalt, params);
}

export function validateArgon2Params(params: Argon2Params): void {
  if (params.t < 1 || params.t > 10)
    throw new Error('Argon2 time cost out of bounds (1-10)');
  if (params.m < 8192 || params.m > 262_144)
    throw new Error('Argon2 memory cost out of bounds (8192-262144 KiB)');
  if (params.p < 1 || params.p > 16)
    throw new Error('Argon2 parallelism out of bounds (1-16)');
  if (params.dkLen !== 32)
    throw new Error('Argon2 key length must be 32');
}

export function encryptVaultBlob(
  manifest: SyncManifest,
  vaultHeader: Uint8Array,
  mek: Uint8Array,
  syncSalt: Uint8Array,
  argon2Params: Argon2Params,
): Uint8Array {
  const blob: VaultBlob = {
    version: 1,
    argon2Params,
    vaultHeader: toBase64(vaultHeader),
    manifest,
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(blob));
  const ciphertext = encrypt(plaintext, mek);

  const result = new Uint8Array(PREAMBLE_SIZE + ciphertext.length);
  result.set(syncSalt, 0);
  const view = new DataView(result.buffer);
  view.setUint32(16, argon2Params.t, true);
  view.setUint32(20, argon2Params.m, true);
  view.setUint32(24, argon2Params.p, true);
  view.setUint32(28, argon2Params.dkLen, true);
  result.set(ciphertext, PREAMBLE_SIZE);
  return result;
}

export function decryptVaultBlob(data: Uint8Array, mek: Uint8Array): VaultBlob {
  const ciphertext = data.subarray(PREAMBLE_SIZE);
  const plaintext = decrypt(ciphertext, mek);
  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  return VaultBlobSchema.parse(parsed);
}

export function readPreambleFromBlob(data: Uint8Array): {
  syncSalt: Uint8Array;
  argon2Params: Argon2Params;
} {
  if (data.length < PREAMBLE_SIZE) throw new Error('Vault blob too short');
  const syncSalt = data.slice(0, 16);
  const view = new DataView(data.buffer, data.byteOffset + 16, 16);
  return {
    syncSalt,
    argon2Params: {
      t: view.getUint32(0, true),
      m: view.getUint32(4, true),
      p: view.getUint32(8, true),
      dkLen: view.getUint32(12, true),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- --run src/sync/vault-blob.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Update sync index.ts exports**

Add to `packages/core/src/sync/index.ts`:

```typescript
export {
  encryptVaultBlob,
  decryptVaultBlob,
  readPreambleFromBlob,
  validateArgon2Params,
  deriveMEK,
  generateSyncSalt,
  PREAMBLE_SIZE,
  VaultBlobSchema,
} from './vault-blob.js';
export type { VaultBlob } from './vault-blob.js';
```

- [ ] **Step 6: Run all core tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync/vault-blob.ts packages/core/src/sync/vault-blob.test.ts packages/core/src/sync/index.ts
git commit -m "feat(sync): add vault blob encryption with MEK derivation, preamble parsing, and Zod validation"
```

---

## Chunk 2: ISyncAdapter Interface Migration

### Task 2: Replace readManifest/writeManifest with readVaultBlob/writeVaultBlob

**Files:**

- Modify: `packages/core/src/sync/types.ts:44-62`
- Modify: `packages/core/src/sync/webdav-adapter.ts:50-63`
- Modify: `packages/core/src/sync/webdav-adapter.test.ts`
- Modify: `packages/core/src/sync/google-drive-adapter.ts:53-71`
- Modify: `packages/core/src/sync/google-drive-adapter.test.ts`
- Modify: `packages/core/src/sync/icloud-adapter.ts:56-72`
- Modify: `packages/core/src/sync/icloud-adapter.test.ts`
- Modify: `packages/core/src/sync/memory-adapter.ts:14-20`

- [ ] **Step 1: Update ISyncAdapter interface in types.ts**

Replace `readManifest`/`writeManifest` with:

```typescript
export interface ISyncAdapter {
  /** Read the encrypted vault blob (vault.enc). Returns null if not found. */
  readVaultBlob(): Promise<Uint8Array | null>;
  /** Write the encrypted vault blob (vault.enc). */
  writeVaultBlob(data: Uint8Array): Promise<void>;
  /** Read legacy plaintext manifest (migration only). */
  readLegacyManifest?(): Promise<SyncManifest | null>;
  /** Delete legacy plaintext manifest after migration. */
  deleteLegacyManifest?(): Promise<void>;
  readItem(id: string): Promise<Uint8Array | null>;
  writeItem(id: string, data: Uint8Array): Promise<void>;
  deleteItem(id: string): Promise<void>;
  listItems(): Promise<string[]>;
}
```

- [ ] **Step 2: Update WebDavAdapter**

In `packages/core/src/sync/webdav-adapter.ts`, replace `readManifest`/`writeManifest` with:

```typescript
async readVaultBlob(): Promise<Uint8Array | null> {
  const res = await this.httpGet(`${this.baseUrl}/vault.enc`);
  if (res.status === 404) return null;
  this.checkAuth(res);
  return new Uint8Array(await res.arrayBuffer());
}

async writeVaultBlob(data: Uint8Array): Promise<void> {
  await this.ensureDir(this.baseUrl);
  const res = await this.httpPut(`${this.baseUrl}/vault.enc`, data, {
    'Content-Type': 'application/octet-stream',
  });
  this.checkAuth(res);
}

async readLegacyManifest(): Promise<SyncManifest | null> {
  const res = await this.httpGet(`${this.baseUrl}/manifest.json`);
  if (res.status === 404) return null;
  this.checkAuth(res);
  return res.json() as Promise<SyncManifest>;
}

async deleteLegacyManifest(): Promise<void> {
  const res = await this.httpDelete(`${this.baseUrl}/manifest.json`);
  if (res.status === 404) return;
  this.checkAuth(res);
}
```

Update the doc comment at the top of the file to reflect the new layout:
```
 *   {baseUrl}/vault.enc           — encrypted vault blob (manifest + header)
 *   {baseUrl}/items/{id}.bin      — encrypted vault items
```

- [ ] **Step 3: Update GoogleDriveAdapter**

Same pattern: `readVaultBlob` GETs `vault.enc`, `writeVaultBlob` PUTs binary with `application/octet-stream`. Add `readLegacyManifest`/`deleteLegacyManifest` for `manifest.json`.

- [ ] **Step 4: Update ICloudAdapter**

Same pattern using `fs.readFile`/`fs.writeFile` for `vault.enc`. Add legacy methods for `manifest.json`.

- [ ] **Step 5: Update MemoryAdapter**

Change internal storage from `SyncManifest | null` to `Uint8Array | null`. Replace `readManifest`/`writeManifest` with `readVaultBlob`/`writeVaultBlob`.

- [ ] **Step 6: Update all adapter tests**

Update `webdav-adapter.test.ts`, `google-drive-adapter.test.ts`, `icloud-adapter.test.ts` to call `readVaultBlob`/`writeVaultBlob` instead of `readManifest`/`writeManifest`. Test that:
- `readVaultBlob` returns null on 404
- `readVaultBlob` returns Uint8Array on success
- `writeVaultBlob` sends binary data
- `readLegacyManifest` reads `manifest.json`
- `deleteLegacyManifest` deletes `manifest.json`

- [ ] **Step 7: Run all core tests (expect some sync-engine tests to fail)**

Run: `pnpm --filter @keykeykey/core test`
Expected: Adapter tests PASS. Some sync-engine and connect tests may fail (they still call `readManifest`). That's expected — we fix those in Chunk 3.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/sync/types.ts packages/core/src/sync/webdav-adapter.ts packages/core/src/sync/webdav-adapter.test.ts packages/core/src/sync/google-drive-adapter.ts packages/core/src/sync/google-drive-adapter.test.ts packages/core/src/sync/icloud-adapter.ts packages/core/src/sync/icloud-adapter.test.ts packages/core/src/sync/memory-adapter.ts
git commit -m "feat(sync): migrate ISyncAdapter to readVaultBlob/writeVaultBlob with legacy manifest support"
```

---

## Chunk 3: SyncEngine Encrypted Manifest

### Task 3: Update SyncEngine to encrypt/decrypt vault blobs

**Files:**

- Modify: `packages/core/src/sync/sync-engine.ts:43-52,195-387`
- Modify: `packages/core/src/sync/sync-config.ts:133-159`
- Modify: `packages/core/src/sync/sync.test.ts`
- Modify: `packages/core/src/sync/connect.test.ts`
- Modify: `packages/core/src/sync/index.ts`

- [ ] **Step 1: Update SyncEngineOptions**

In `packages/core/src/sync/sync-engine.ts`, update the options interface:

```typescript
export interface VaultMismatchInfo {
  localVaultId: string;
  remoteVaultId: string;
  canRestore: boolean;
  remoteItemCount: number;
  remoteVaultHeader: Uint8Array | null;
}

export interface SyncEngineOptions {
  adapter: ISyncAdapter;
  store: SyncableStore;
  mek: Uint8Array;
  syncSalt: Uint8Array;
  vaultHeaderBytes: Uint8Array;
  argon2Params: Argon2Params;
  onConflictResolved?: (id: string) => void;
  onVaultMismatch?: (info: VaultMismatchInfo) => void;
  tombstoneMaxAgeDays?: number;
}
```

- [ ] **Step 2: Update _runSync to use encrypted vault blobs**

Replace `readManifest`/`writeManifest` calls in `_runSync()`:

**Step 1 (read remote):** Replace `this.adapter.readManifest()` with:
```typescript
// Read remote vault blob
let remoteRaw: SyncManifest = { version: 2, lastModified: '', items: {} };
const remoteBlob = await this.adapter.readVaultBlob();
if (remoteBlob) {
  try {
    const decoded = decryptVaultBlob(remoteBlob, this.mek);
    remoteRaw = decoded.manifest;
  } catch {
    // Decryption failed — different password
    this.onVaultMismatch?.({
      localVaultId: this.store.getVaultId(),
      remoteVaultId: '',
      canRestore: false,
      remoteItemCount: 0,
      remoteVaultHeader: null,
    });
    return { ...EMPTY_ZEROS };
  }
} else if (this.adapter.readLegacyManifest) {
  // Migration path
  const legacy = await this.adapter.readLegacyManifest();
  if (legacy) {
    remoteRaw = legacy;
    // Will be migrated to encrypted format in the write step
  }
}
```

**Vault ID mismatch check:** Update to use `onVaultMismatch` instead of `onVaultReplaced`:
```typescript
if (remoteRaw.vaultId) {
  const localVaultId = this.store.getVaultId();
  if (remoteRaw.vaultId !== localVaultId) {
    // Same password (decryption succeeded) but different vault
    const remoteBlob = await this.adapter.readVaultBlob();
    let remoteHeader: Uint8Array | null = null;
    if (remoteBlob) {
      try {
        const decoded = decryptVaultBlob(remoteBlob, this.mek);
        remoteHeader = fromBase64(decoded.vaultHeader);
      } catch { /* ignore */ }
    }
    this.onVaultMismatch?.({
      localVaultId,
      remoteVaultId: remoteRaw.vaultId,
      canRestore: true,
      remoteItemCount: Object.keys(remoteRaw.items).length,
      remoteVaultHeader: remoteHeader,
    });
    return { ...EMPTY_ZEROS };
  }
}
```

**Step 7 (write):** Replace `this.adapter.writeManifest(merged)` with:
```typescript
merged.vaultId = this.store.getVaultId();
merged.lastModified = new Date().toISOString();
const encryptedBlob = encryptVaultBlob(
  merged, this.vaultHeaderBytes, this.mek, this.syncSalt, this.argon2Params,
);
await this.adapter.writeVaultBlob(encryptedBlob);

// Delete legacy manifest if migration happened
if (this.adapter.deleteLegacyManifest) {
  await this.adapter.deleteLegacyManifest().catch(() => {});
}
```

- [ ] **Step 3: Update createSyncEngineFromConfig**

In `packages/core/src/sync/sync-config.ts`, update `createSyncEngineFromConfig`:

```typescript
export function createSyncEngineFromConfig(
  config: SyncConfig,
  store: SyncableStore,
  platformCallbacks: AdapterPlatformCallbacks,
  mek: Uint8Array,
  syncSalt: Uint8Array,
  vaultHeaderBytes: Uint8Array,
  argon2Params: Argon2Params,
  onVaultMismatch?: (info: VaultMismatchInfo) => void,
): SyncEngine | null {
  const adapter = createAdapterFromConfig(config, platformCallbacks);
  if (!adapter) return null;
  return new SyncEngine({
    adapter, store, mek, syncSalt, vaultHeaderBytes, argon2Params, onVaultMismatch,
  });
}
```

- [ ] **Step 4: Update sync.test.ts and connect.test.ts**

Update all tests that create `SyncEngine` or use `MemoryAdapter` to:
- Derive a test MEK using `deriveMEK('test-pass', salt, TEST_PARAMS)`
- Provide `mek`, `syncSalt`, `vaultHeaderBytes`, `argon2Params` to SyncEngine constructor
- Use `readVaultBlob`/`writeVaultBlob` instead of `readManifest`/`writeManifest` on MemoryAdapter
- Write encrypted vault blobs to MemoryAdapter for tests that need pre-existing remote data

- [ ] **Step 5: Run all core tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/sync-engine.ts packages/core/src/sync/sync-config.ts packages/core/src/sync/sync.test.ts packages/core/src/sync/connect.test.ts packages/core/src/sync/index.ts
git commit -m "feat(sync): encrypt manifest with MEK in SyncEngine, replace onVaultReplaced with onVaultMismatch"
```

---

## Chunk 4: Restore from Cloud Core Function

### Task 4: Implement restoreFromCloud

**Files:**

- Create: `packages/core/src/sync/restore.ts`
- Create: `packages/core/src/sync/restore.test.ts`
- Modify: `packages/core/src/sync/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/sync/restore.test.ts` with tests:
- Restore succeeds: writes vault blob to memory adapter → `restoreFromCloud` returns header + items
- Restore fails on wrong password: throws "Incorrect master password"
- Restore fails on empty remote: throws "No vault data found"
- MEK is zeroed on decrypt failure
- Argon2 param bounds are validated

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- --run src/sync/restore.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement restore.ts**

Create `packages/core/src/sync/restore.ts` following the spec's Section 5 (`restoreFromCloud` function). Key points:
- Read vault blob from adapter
- Read preamble (salt + params)
- Validate params
- Derive MEK
- Decrypt (zero MEK on failure)
- Deserialize vault header
- Download all items
- Zero MEK before returning
- Return `{ header, encryptedItems, itemCount, syncSalt, argon2Params }`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- --run src/sync/restore.test.ts`
Expected: PASS

- [ ] **Step 5: Export from index.ts**

Add to `packages/core/src/sync/index.ts`:
```typescript
export { restoreFromCloud } from './restore.js';
export type { RestoreFromCloudResult } from './restore.js';
```

- [ ] **Step 6: Run all core tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync/restore.ts packages/core/src/sync/restore.test.ts packages/core/src/sync/index.ts
git commit -m "feat(sync): add restoreFromCloud function for cross-device vault download"
```

---

## Chunk 5: Desktop Vault Context MEK Integration

### Task 5: Wire MEK derivation and encrypted sync into desktop vault context

**Files:**

- Modify: `apps/desktop/src/lib/vault-context.tsx`
- Modify: `apps/desktop/src/lib/sync.ts`

- [ ] **Step 1: Add MEK refs and update imports**

In `apps/desktop/src/lib/vault-context.tsx`:
- Add `mekRef = useRef<Uint8Array | null>(null)` and `syncSaltRef = useRef<Uint8Array | null>(null)` near `syncEngineRef`
- Import `deriveMEK`, `generateSyncSalt`, `readPreambleFromBlob`, `validateArgon2Params` from `@keykeykey/core/sync`
- Import `serializeVaultHeader` for passing to SyncEngine

- [ ] **Step 2: Update unlock to derive MEK in parallel with DEK**

Update the `unlock` callback:
```typescript
const unlock = useCallback(async (masterPassword: string) => {
  const storedItems = await loadAllEncryptedItems();
  const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
  await storeRef.current.getState().unlock(masterPassword, encryptedArrays);
  syncItems();
  setStatus('unlocked');
  await initSyncAfterUnlock(masterPassword);
}, [syncItems, initSyncAfterUnlock]);
```

Pass `masterPassword` to `initSyncAfterUnlock` so it can derive the MEK.

- [ ] **Step 3: Update initSyncAfterUnlock to derive MEK and pass to SyncEngine**

```typescript
const initSyncAfterUnlock = useCallback(async (masterPassword: string) => {
  const dek = storeRef.current.getState().getDEK();
  const config = await loadSyncConfigFromFile(dek);
  setSyncConfig(config);
  setVaultReplaced(false);

  if (config.provider !== 'none') {
    // Read sync salt from existing vault.enc preamble (or generate new)
    const adapter = createAdapterFromConfig(config, {});
    if (!adapter) return;

    let syncSalt: Uint8Array;
    const remoteBlob = await adapter.readVaultBlob().catch(() => null);
    if (remoteBlob && remoteBlob.length >= PREAMBLE_SIZE) {
      const preamble = readPreambleFromBlob(remoteBlob);
      syncSalt = preamble.syncSalt;
    } else {
      syncSalt = generateSyncSalt();
    }

    const header = storeRef.current.getState().header!;
    const mek = await deriveMEK(masterPassword, syncSalt, header.argon2Params);
    mekRef.current = mek;
    syncSaltRef.current = syncSalt;

    const vaultHeaderBytes = serializeVaultHeader(header);
    const engine = createSyncEngineFromConfig(
      config, syncableStore, {}, mek, syncSalt, vaultHeaderBytes,
      header.argon2Params, handleVaultMismatch,
    );
    if (engine) {
      syncEngineRef.current = engine;
      syncDisconnectRef.current = initSyncEngine(engine, storeRef.current);
    }
  }
}, [syncableStore, handleVaultMismatch]);
```

- [ ] **Step 4: Update handleVaultReplaced → handleVaultMismatch**

Replace `handleVaultReplaced` with:
```typescript
const [vaultMismatchInfo, setVaultMismatchInfo] = useState<VaultMismatchInfo | null>(null);

const handleVaultMismatch = useCallback((info: VaultMismatchInfo) => {
  syncDisconnectRef.current?.();
  syncDisconnectRef.current = null;
  syncEngineRef.current = null;
  setVaultMismatchInfo(info);
}, []);
```

- [ ] **Step 5: Update lock to zero MEK**

In `lock()`, add:
```typescript
if (mekRef.current) { mekRef.current.fill(0); mekRef.current = null; }
syncSaltRef.current = null;
```

- [ ] **Step 6: Update saveSyncConfigAction**

Pass MEK, salt, header to `createSyncEngineFromConfig`.

- [ ] **Step 7: Run desktop tests**

Run: `pnpm --filter @keykeykey/desktop test`
Expected: PASS (may need to update vault-context tests)

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/lib/vault-context.tsx apps/desktop/src/lib/sync.ts
git commit -m "feat(desktop): wire MEK derivation and encrypted sync into vault context"
```

---

## Chunk 6: Restore from Cloud UI (Desktop)

### Task 6: Build RestoreScreen and wire into SetupScreen

**Files:**

- Create: `apps/desktop/src/screens/RestoreScreen.tsx`
- Modify: `apps/desktop/src/screens/SetupScreen.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/lib/vault-context.tsx`

- [ ] **Step 1: Add restoreFromCloud action to vault context**

Add `restoreFromCloud` to `VaultContextType` and implement `restoreFromCloudAction` following spec Section 5.

- [ ] **Step 2: Create RestoreScreen.tsx**

Multi-step wizard:
1. Provider picker + credentials (WebDAV URL, username, password)
2. Master password entry
3. Progress indicator ("Downloading and decrypting vault...")
4. Success → navigate to `/vault`

Error states: "No vault data found", "Incorrect master password", network errors.

- [ ] **Step 3: Add route in App.tsx**

```typescript
<Route path="/restore" element={<RestoreScreen />} />
```

- [ ] **Step 4: Enable "Restore from Cloud" button in SetupScreen**

Replace the disabled button with:
```typescript
<Button
  title="Restore from Cloud"
  onPress={() => navigate('/restore')}
  variant="secondary"
/>
```

Remove the "Coming soon" text.

- [ ] **Step 5: Run desktop tests**

Run: `pnpm --filter @keykeykey/desktop test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/screens/RestoreScreen.tsx apps/desktop/src/screens/SetupScreen.tsx apps/desktop/src/App.tsx apps/desktop/src/lib/vault-context.tsx
git commit -m "feat(desktop): add Restore from Cloud screen with multi-step wizard"
```

---

## Chunk 7: Vault Mismatch Dialog in Sync Settings

### Task 7: Handle onVaultMismatch in SyncSettingsScreen

**Files:**

- Modify: `apps/desktop/src/screens/SyncSettingsScreen.tsx`
- Modify: `apps/desktop/src/lib/vault-context.tsx`

- [ ] **Step 1: Expose vaultMismatchInfo in vault context**

Add `vaultMismatchInfo` to `VaultContextType` and context value.

- [ ] **Step 2: Add mismatch dialog to SyncSettingsScreen**

When `vaultMismatchInfo` is set:
- If `canRestore: true`: Show "Remote vault detected" dialog with Restore/Replace/Cancel buttons
- If `canRestore: false`: Show "Incompatible remote vault" dialog with Replace/Cancel buttons

**Restore:** Call `restoreFromCloud` with the remote vault header.
**Replace:** Generate new sync salt, clear remote items, write new vault.enc, push all local items.
**Cancel:** Disconnect sync, clear config.

- [ ] **Step 3: Run desktop tests**

Run: `pnpm --filter @keykeykey/desktop test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/screens/SyncSettingsScreen.tsx apps/desktop/src/lib/vault-context.tsx
git commit -m "feat(desktop): add vault mismatch dialog with restore/replace/cancel options"
```

---

## Chunk 8: HTTP Proxy SSRF Restriction

### Task 8: Add URL allowlist to Tauri HTTP proxy

**Files:**

- Modify: `apps/desktop/src-tauri/src/http_proxy.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/lib/sync.ts`

- [ ] **Step 1: Add SyncState with allowed URL prefix**

In `lib.rs`, add a `SyncState` struct with `allowed_url_prefix: Mutex<Option<String>>` and register it with Tauri.

- [ ] **Step 2: Add URL validation in http_proxy.rs**

Before making the request:
- Check URL starts with the allowed prefix (if set)
- Block RFC 1918 addresses: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Block link-local: `169.254.0.0/16`
- Allow `127.0.0.1` / `localhost` for development

- [ ] **Step 3: Add Tauri command to set allowed URL**

```rust
#[tauri::command]
pub fn set_sync_url_prefix(state: State<'_, SyncState>, prefix: Option<String>) -> Result<(), String> {
    *state.allowed_url_prefix.lock().unwrap() = prefix;
    Ok(())
}
```

- [ ] **Step 4: Call set_sync_url_prefix from JS when sync is configured**

In `apps/desktop/src/lib/sync.ts`, after saving sync config, invoke the Tauri command to set the allowed URL prefix.

- [ ] **Step 5: Build and test manually**

Run: `cd apps/desktop && npx tauri dev`
Verify: Fetch to WebDAV URL works. Fetch to `http://169.254.169.254` is rejected.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/http_proxy.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/lib/sync.ts
git commit -m "fix(desktop): restrict HTTP proxy to configured sync server URL (SSRF mitigation)"
```

---

## Chunk 9: Final Verification

### Task 9: Build, test, format, lint

- [ ] **Step 1: Build shared packages**

```bash
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
```

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: All packages pass.

- [ ] **Step 3: Run format**

```bash
pnpm format
pnpm format:check
```

- [ ] **Step 4: Run lint**

```bash
pnpm lint
```

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: formatting and lint fixes"
```
