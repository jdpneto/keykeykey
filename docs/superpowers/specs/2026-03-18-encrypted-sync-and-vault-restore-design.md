# Encrypted Sync & Vault Restore from Cloud

Wire encrypted manifest sync and cross-device vault restore into the existing sync infrastructure. All remote data becomes opaque to the storage provider. New devices can restore a vault with only the master password and sync credentials.

## Decisions

| Decision               | Choice                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Manifest encryption    | Encrypt with Manifest Encryption Key (MEK) derived from master password via Argon2id                      |
| MEK derivation         | `MEK = Argon2id(masterPassword, randomSyncSalt, params)` — random salt stored in unencrypted preamble     |
| Vault header on remote | Stored inside the encrypted manifest blob alongside the sync manifest                                     |
| Vault ID mismatch      | Try to decrypt remote with local MEK. If succeeds → offer restore/replace. If fails → offer replace only. |
| Remote file layout     | Replace `manifest.json` with `vault.enc` (encrypted blob). Items unchanged.                               |
| Adapter changes        | Replace `readManifest`/`writeManifest` with `readVaultBlob`/`writeVaultBlob` (opaque `Uint8Array`)        |

## 1. Manifest Encryption Key (MEK)

### Derivation

```typescript
async function deriveMEK(
  masterPassword: string,
  syncSalt: Uint8Array, // 16-byte random salt from vault.enc preamble
  params: Argon2Params,
): Promise<Uint8Array> {
  return deriveKEK(masterPassword, syncSalt, params);
}

function generateSyncSalt(): Uint8Array {
  return randomBytes(16); // CSPRNG, same as vault header salt generation
}
```

The MEK is derived from the master password using Argon2id with a **random 16-byte salt** stored in the unencrypted preamble of `vault.enc`. This means:

- **The first device to sync generates the salt** and writes it to the preamble.
- **Other devices read the salt from the preamble** before deriving the MEK.
- Each vault's sync blob has a unique salt, preventing multi-target precomputation attacks.

### Argon2 Parameters

The MEK uses the same Argon2 preset as the vault header on the device that performs the encryption. The params are stored in the unencrypted preamble alongside the salt so the decrypting device knows which params to use.

### Security Properties

- **Random per-vault salt** prevents multi-target attacks. An attacker who obtains `vault.enc` blobs from multiple users must brute-force each independently.
- **Different salt than vault header** — work done brute-forcing the MEK cannot be reused against the local vault header's `masterSalt` (different salt → different KEK).
- **Argon2id memory-hardness** — at desktop preset (64 MiB, 3 iterations), GPU-based attacks are throttled to low throughput.
- **Equivalent to vault header threat model** — the vault header is already stored on local disk with the same protection level (Argon2id + wrapped key). Storing an equivalently protected blob on a remote server (behind WebDAV auth) is no worse.

## 2. Vault Blob Format

The remote stores a single encrypted file `vault.enc` that replaces the current plaintext `manifest.json`.

### Plaintext Structure (before encryption)

```typescript
const VaultBlobSchema = z.object({
  version: z.literal(1),
  argon2Params: z.object({
    t: z.number(),
    m: z.number(),
    p: z.number(),
    dkLen: z.number(),
  }),
  vaultHeader: z.string(), // Base64-encoded serialized VaultHeader
  manifest: SyncManifestSchema, // Validated sync manifest
});

type VaultBlob = z.infer<typeof VaultBlobSchema>;
```

### Wire Format

```
[16 bytes] syncSalt             (random, unique per vault)
[4 bytes]  argon2Params.t       (uint32 LE)
[4 bytes]  argon2Params.m       (uint32 LE)
[4 bytes]  argon2Params.p       (uint32 LE)
[4 bytes]  argon2Params.dkLen   (uint32 LE)
[remainder] XChaCha20-Poly1305 ciphertext (24B nonce + encrypted VaultBlob JSON + 16B tag)
```

The preamble is 32 bytes (16 salt + 16 params), stored **unencrypted**. This is necessary so any device can derive the MEK before decrypting. The salt and params are not secret — they serve the same role as the `masterSalt` and `argon2Params` in the local vault header.

### Encryption / Decryption

```typescript
const PREAMBLE_SIZE = 32; // 16 salt + 16 params

function encryptVaultBlob(
  manifest: SyncManifest,
  vaultHeader: Uint8Array, // serialized vault header bytes
  mek: Uint8Array,
  syncSalt: Uint8Array, // 16-byte salt used for MEK derivation
  argon2Params: Argon2Params,
): Uint8Array {
  const blob: VaultBlob = {
    version: 1,
    argon2Params,
    vaultHeader: toBase64(vaultHeader),
    manifest,
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(blob));
  const ciphertext = encrypt(plaintext, mek); // XChaCha20-Poly1305

  // Prepend preamble: salt + argon2 params
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

function decryptVaultBlob(data: Uint8Array, mek: Uint8Array): VaultBlob {
  const ciphertext = data.subarray(PREAMBLE_SIZE);
  const plaintext = decrypt(ciphertext, mek); // throws on wrong key
  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  return VaultBlobSchema.parse(parsed); // Zod validation
}

function readPreambleFromBlob(data: Uint8Array): {
  syncSalt: Uint8Array;
  argon2Params: Argon2Params;
} {
  if (data.length < PREAMBLE_SIZE) throw new Error('Vault blob too short');
  const syncSalt = data.slice(0, 16);
  const view = new DataView(data.buffer, data.byteOffset + 16, 16);
  const argon2Params = {
    t: view.getUint32(0, true),
    m: view.getUint32(4, true),
    p: view.getUint32(8, true),
    dkLen: view.getUint32(12, true),
  };
  return { syncSalt, argon2Params };
}
```

### Argon2 Param Bounds Checking

When reading params from the preamble, validate before use:

- `t >= 1 && t <= 10`
- `m >= 8192 && m <= 262_144` (8 MiB min, 256 MiB max — prevents OOM from attacker-controlled params)
- `p >= 1 && p <= 16`
- `dkLen === 32`

```typescript
function validateArgon2Params(params: Argon2Params): void {
  if (params.t < 1 || params.t > 10) throw new Error('Argon2 time cost out of bounds');
  if (params.m < 8192 || params.m > 262_144) throw new Error('Argon2 memory cost out of bounds');
  if (params.p < 1 || params.p > 16) throw new Error('Argon2 parallelism out of bounds');
  if (params.dkLen !== 32) throw new Error('Argon2 key length must be 32');
}
```

## 3. ISyncAdapter Changes

### New Interface

```typescript
export interface ISyncAdapter {
  // Replaces readManifest/writeManifest:
  readVaultBlob(): Promise<Uint8Array | null>;
  writeVaultBlob(data: Uint8Array): Promise<void>;

  // Migration from plaintext manifest (optional):
  readLegacyManifest?(): Promise<SyncManifest | null>;
  deleteLegacyManifest?(): Promise<void>;

  // Unchanged:
  readItem(id: string): Promise<Uint8Array | null>;
  writeItem(id: string, data: Uint8Array): Promise<void>;
  deleteItem(id: string): Promise<void>;
  listItems(): Promise<string[]>;
}
```

### Adapter Implementations

| Adapter      | Old file        | New file     | Content type               |
| ------------ | --------------- | ------------ | -------------------------- |
| WebDAV       | `manifest.json` | `vault.enc`  | `application/octet-stream` |
| Google Drive | `manifest.json` | `vault.enc`  | `application/octet-stream` |
| iCloud       | `manifest.json` | `vault.enc`  | binary read/write          |
| Memory       | JSON object     | `Uint8Array` | in-memory                  |

### Backward Compatibility / Legacy Migration

On first sync after upgrade:

1. `readVaultBlob()` returns null (no `vault.enc` exists yet)
2. Try `readLegacyManifest?.()` — reads old `manifest.json`
3. If legacy manifest found:
   a. Encrypt it into `vault.enc` via `writeVaultBlob()`
   b. **Verify** the write succeeded by reading back `vault.enc`
   c. Only then delete `manifest.json` via `deleteLegacyManifest?.()`
4. If neither exists: fresh sync (empty remote)

Write-then-verify-then-delete ordering ensures no data loss if migration is interrupted.

## 4. SyncEngine Changes

### MEK as Constructor Parameter

The `SyncEngine` now requires the MEK, sync salt, and vault header for encryption/decryption:

```typescript
export interface SyncEngineOptions {
  adapter: ISyncAdapter;
  store: SyncableStore;
  mek: Uint8Array; // Manifest encryption key
  syncSalt: Uint8Array; // 16-byte salt used for MEK derivation
  vaultHeaderBytes: Uint8Array; // Serialized local vault header
  argon2Params: Argon2Params; // Params used for MEK derivation
  onConflictResolved?: (id: string) => void;
  onVaultMismatch?: (info: VaultMismatchInfo) => void; // Replaces onVaultReplaced
  tombstoneMaxAgeDays?: number;
}
```

### Vault Mismatch Handling

Replace `onVaultReplaced` with richer `onVaultMismatch`:

```typescript
export interface VaultMismatchInfo {
  localVaultId: string;
  remoteVaultId: string;
  canRestore: boolean; // true if MEK decrypted the remote blob (same password)
  remoteItemCount: number; // Number of items on remote
  remoteVaultHeader: Uint8Array | null; // Serialized remote header (if canRestore)
}
```

### Updated Sync Flow

**Step 1: Read remote vault blob**

```
1. Call adapter.readVaultBlob()
2. If null → check adapter.readLegacyManifest?.() for migration
3. If legacy manifest found → migrate (write vault.enc, verify, delete manifest.json)
4. If neither → treat as empty remote (first sync)
5. If vault.enc exists → read preamble (salt + params) → derive MEK → decrypt
   - If decryption succeeds → Zod-validate VaultBlob → extract manifest + vault header
   - If decryption fails → remote was encrypted with a different password
     → fire onVaultMismatch({ canRestore: false, ... })
     → return empty result
```

**Step 2-6: Unchanged** (merge, pull, push logic stays the same)

**Step 7: Write vault blob**

```
1. Encrypt merged manifest + local vault header with MEK + syncSalt
2. Call adapter.writeVaultBlob(encryptedBlob)
```

### Vault ID Mismatch (Same Password)

When MEK decrypts the remote blob but `vaultId` differs:

```
1. Fire onVaultMismatch({
     canRestore: true,
     remoteVaultId,
     remoteItemCount: Object.keys(remoteManifest.items).length,
     remoteVaultHeader: fromBase64(remoteBlob.vaultHeader),
   })
2. Return empty result (don't auto-merge — wait for user decision)
```

The UI then presents options (see Section 6).

### Sync Salt Lifecycle

- **First sync (no remote data):** Generate a new random `syncSalt` via `generateSyncSalt()`. Store it in the `SyncEngine` instance and use it for all subsequent `writeVaultBlob` calls.
- **Existing remote data:** Read the `syncSalt` from the preamble of the downloaded `vault.enc`. Reuse this salt for all writes (keeps MEK stable across syncs).
- **Password change:** Generate a new `syncSalt`, re-derive MEK, re-encrypt `vault.enc`. Old blobs (if captured) remain attackable with the old password + old salt.
- **Replace remote:** Generate a new `syncSalt` for the replacement blob.

## 5. Vault Restore Flow

### New Core Function

```typescript
// packages/core/src/sync/restore.ts

export interface RestoreFromCloudResult {
  header: VaultHeader;
  encryptedItems: Uint8Array[];
  itemCount: number;
  syncSalt: Uint8Array; // Needed to initialize SyncEngine after restore
  argon2Params: Argon2Params;
}

/**
 * Download and decrypt a vault from the remote.
 * Requires the master password to derive the MEK and unlock the vault.
 * Zeroes the MEK on any failure path.
 */
export async function restoreFromCloud(
  adapter: ISyncAdapter,
  masterPassword: string,
): Promise<RestoreFromCloudResult> {
  // 1. Download vault blob
  const raw = await adapter.readVaultBlob();
  if (!raw) throw new Error('No vault data found on remote');

  // 2. Read preamble (salt + params)
  const { syncSalt, argon2Params } = readPreambleFromBlob(raw);
  validateArgon2Params(argon2Params);

  // 3. Derive MEK
  const mek = await deriveMEK(masterPassword, syncSalt, argon2Params);

  // 4. Decrypt vault blob (zero MEK on failure)
  let blob: VaultBlob;
  try {
    blob = decryptVaultBlob(raw, mek);
  } catch {
    mek.fill(0);
    throw new Error('Incorrect master password or incompatible vault');
  }

  // 5. Deserialize vault header
  const headerBytes = fromBase64(blob.vaultHeader);
  const header = deserializeVaultHeader(headerBytes);

  // 6. Download all encrypted items
  const itemIds = Object.keys(blob.manifest.items);
  const encryptedItems: Uint8Array[] = [];
  try {
    for (const id of itemIds) {
      const itemData = await adapter.readItem(id);
      if (itemData) encryptedItems.push(itemData);
    }
  } catch (e) {
    mek.fill(0);
    throw e;
  }

  mek.fill(0); // MEK no longer needed — caller re-derives during unlock
  return { header, encryptedItems, itemCount: itemIds.length, syncSalt, argon2Params };
}
```

### Platform Integration (Desktop Example)

New method in `VaultContextType`:

```typescript
restoreFromCloud: (syncConfig: SyncConfig, masterPassword: string) =>
  Promise<{ success: boolean; error?: string; itemCount?: number }>;
```

Implementation:

```typescript
const restoreFromCloudAction = useCallback(
  async (config: SyncConfig, masterPassword: string) => {
    // 1. Create adapter from config
    const adapter = createAdapterFromConfig(config, platformCallbacks);
    if (!adapter) throw new Error('Invalid sync config');

    // 2. Download and decrypt remote vault
    const { header, encryptedItems, itemCount, syncSalt, argon2Params } = await restoreFromCloud(
      adapter,
      masterPassword,
    );

    // 3. Save vault header locally
    const serialized = serializeVaultHeader(header);
    await saveVaultHeader(toBase64(serialized));
    await setVaultSetupComplete(true);

    // 4. Create store, load header, unlock with password
    const store = createVaultStore();
    store.getState().loadHeader(header);
    await store.getState().unlock(masterPassword, encryptedItems);
    storeRef.current = store;

    // 5. Persist encrypted items to local storage
    for (const item of store.getState().items) {
      const encrypted = store.getState().encryptItem(item);
      await saveEncryptedItem(
        item.id,
        item.type,
        toBase64(encrypted),
        item.createdAt,
        item.updatedAt,
      );
    }

    // 6. Save sync config
    const dek = store.getState().getDEK();
    await saveSyncConfigToFile(config, dek);
    setSyncConfig(config);

    // 7. Derive MEK for sync engine (parallel with step 4 unlock in future optimization)
    const mek = await deriveMEK(masterPassword, syncSalt, argon2Params);
    mekRef.current = mek;

    // 8. Initialize sync engine
    const engine = new SyncEngine({
      adapter,
      store: syncableStore,
      mek,
      syncSalt,
      vaultHeaderBytes: serialized,
      argon2Params,
    });
    syncEngineRef.current = engine;
    syncDisconnectRef.current = connectSyncEngine(storeRef.current, engine);

    // 9. Update UI state
    setItems([...store.getState().items]);
    setStatus('unlocked');

    return { success: true, itemCount };
  },
  [syncableStore, platformCallbacks],
);
```

## 6. UI Changes

### Setup Screen — Restore from Cloud

Enable the currently disabled "Restore from Cloud" button. Flow:

1. User clicks "Restore from Cloud"
2. **Step 1: Sync credentials** — Provider picker (WebDAV/Google Drive/iCloud) + credential fields
3. **Step 2: Connecting** — Show spinner "Checking remote vault..."
4. **Step 3: Master password** — "Found vault with N items. Enter your master password to restore."
5. **Step 4: Restoring** — Show progress "Downloading and decrypting vault..." (Argon2id derivation happens here)
6. **Step 5: Done** — Navigate to vault list

Error states:

- "No vault data found on remote" → show message, let user retry or go back
- "Incorrect master password" → show error, let user retry
- Network error → show error, let user retry

### Sync Settings — Vault ID Mismatch Dialog

When `onVaultMismatch` fires with `canRestore: true`:

> **Remote vault detected**
> The remote server has a vault with N items from a different device.
>
> [Restore Remote Vault] — Download and use the remote vault (replaces local data)
> [Replace Remote] — Overwrite the remote with your current vault
> [Cancel] — Disconnect sync

When `onVaultMismatch` fires with `canRestore: false`:

> **Incompatible remote vault**
> The remote server has vault data encrypted with a different password.
>
> [Replace Remote] — Overwrite the remote with your current vault
> [Cancel] — Disconnect sync

### "Replace Remote" Action

When the user chooses to replace:

1. Generate a new `syncSalt` for the replacement
2. Clear all remote items via `adapter.deleteItem()` for each remote item
3. Write a new `vault.enc` with the local vault's data + new salt
4. Push all local items
5. Continue syncing normally

## 7. MEK Caching

The MEK must be available for every sync operation (read/write the vault blob).

**Chosen approach:** Derive the MEK once during unlock (or restore) and hold it in a ref alongside the DEK. Also cache the `syncSalt`.

```typescript
// In vault-context.tsx
const mekRef = useRef<Uint8Array | null>(null);
const syncSaltRef = useRef<Uint8Array | null>(null);

// During master password unlock:
// Read syncSalt from existing vault.enc preamble (or generate new if first sync)
const mek = await deriveMEK(masterPassword, syncSalt, header.argon2Params);
mekRef.current = mek;
syncSaltRef.current = syncSalt;

// During lock:
if (mekRef.current) {
  mekRef.current.fill(0);
  mekRef.current = null;
}
syncSaltRef.current = null;
```

This adds one Argon2id derivation to the unlock path. To mitigate the performance cost:

- Derive MEK **in parallel** with the DEK derivation during unlock (both use the same master password, different salts). `Promise.all([unlockVault(header, password), deriveMEK(password, syncSalt, params)])`.

**PIN/Biometric unlock path:**

- Store MEK + syncSalt in secure enclave alongside the DEK when biometric is enabled
- On biometric unlock, retrieve DEK + MEK + syncSalt
- On PIN unlock, the MEK is not available — sync reads work (items are DEK-encrypted), but manifest writes are deferred until next master password unlock
- Deferred writes: queue locally, flush on next master password unlock. Max queue: unbounded (all local changes accumulate). User is NOT notified — sync just catches up on next full unlock. Vault lock with pending writes: writes persist in local store and sync on next unlock.

## 8. HTTP Proxy URL Restriction

The Tauri HTTP proxy (`http_proxy.rs`) currently accepts any URL. This is an SSRF vector.

**Fix:** Validate the target URL in the Rust command before making the request.

```rust
#[tauri::command]
pub async fn http_proxy(
    state: State<'_, SyncState>,
    req: HttpProxyRequest,
) -> Result<HttpProxyResponse, String> {
    // Validate URL against configured sync server
    let allowed_prefix = state.allowed_url_prefix.lock().unwrap();
    if let Some(prefix) = allowed_prefix.as_ref() {
        if !req.url.starts_with(prefix) {
            return Err(format!("URL not allowed: must start with {}", prefix));
        }
    }
    // ... rest of proxy logic
}
```

The `allowed_url_prefix` is set when the user configures sync (from the WebDAV URL). When no sync is configured, the proxy rejects all requests.

Additionally, block RFC 1918 / link-local / cloud metadata addresses regardless of the allowlist:

- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- `169.254.0.0/16` (link-local)
- `169.254.169.254` (cloud metadata)
- Exception: `127.0.0.1` / `localhost` allowed for local development

## 9. Testing

### Core Tests

- **MEK derivation:** Same password + same salt → same MEK; different password → different MEK; different salt → different MEK
- **Vault blob encrypt/decrypt:** Round-trip with random salt; tampered blob throws; wrong MEK throws; Zod validation rejects malformed JSON
- **Argon2 param bounds:** Reject t=0, t=11, m=0, m > 262144, p=0, p > 16, dkLen != 32
- **Vault blob format:** 32-byte preamble correctly encodes/decodes salt + params; ciphertext follows preamble
- **Preamble too short:** Throws on data < 32 bytes
- **Legacy migration:** Old `manifest.json` migrated to `vault.enc`; old file deleted only after write verified
- **Restore from cloud:** Download remote blob → decrypt → validate schema → deserialize header → download items → verify header/items match
- **MEK zeroed on failure:** Verify MEK is zeroed when decrypt fails, when item download fails
- **Vault mismatch:** Same password different vault ID → canRestore: true; different password → canRestore: false; different salt → cannot decrypt → canRestore: false
- **Replace remote:** Clears remote items, generates new salt, writes new vault.enc
- **Sync salt lifecycle:** First sync generates salt; subsequent syncs reuse salt from preamble; password change generates new salt

### Adapter Tests

- **WebDAV:** `readVaultBlob` GETs `vault.enc`; `writeVaultBlob` PUTs binary; legacy migration reads `manifest.json`
- **Google Drive:** Same semantics with Drive API
- **iCloud:** Same semantics with filesystem
- **Memory:** In-memory Uint8Array storage

### Integration Tests

- Full restore flow: setup vault on device A → sync → restore on device B with master password
- Vault mismatch: device A syncs → device B has different vault → connect → mismatch dialog
- Replace remote: device B replaces → device A syncs → gets new vault (onVaultMismatch)

### HTTP Proxy Tests

- Allowed URL prefix: requests to configured server succeed
- Blocked URL: requests to other hosts rejected
- RFC 1918 addresses blocked
- Cloud metadata endpoint blocked
- localhost allowed for development

## 10. Security Considerations

- **Random per-vault salt** prevents multi-target precomputation attacks across KeyKeyKey users. Each vault's sync blob requires independent brute-force work.
- **MEK brute-force resistance:** Argon2id with strong params (desktop: 64 MiB, 3 iterations). Equivalent to vault header threat model.
- **Vault header exposure:** The vault header is inside the encrypted blob. An attacker must first brute-force the MEK (Argon2id) to access the header, then brute-force the vault header's own KEK to get the DEK. The MEK and vault header use different salts, so these are independent attacks.
- **Forward secrecy:** Changing the master password generates a new `syncSalt`, re-derives MEK, re-encrypts `vault.enc`. Old blobs (if captured) remain attackable with the old password + old salt.
- **Manifest metadata:** Fully encrypted. Item count, timestamps, vault ID, tombstones — all opaque to the storage provider.
- **Item encryption unchanged:** Items are still encrypted with the DEK (XChaCha20-Poly1305). The MEK only protects the manifest and vault header.
- **MEK cleanup:** MEK is zeroed on lock, on restore failure, and on any error path where it won't be cached.
- **Input validation:** Decrypted VaultBlob is Zod-validated. Argon2 params from preamble are bounds-checked. Prevents resource exhaustion from attacker-controlled params.
- **SSRF mitigation:** HTTP proxy restricted to configured sync server URL. RFC 1918 and cloud metadata addresses blocked.

## 11. Out of Scope

- **Merge two vaults with different passwords** — would require decrypting both with respective passwords
- **Partial restore** — all-or-nothing restore (individual item selection adds UI complexity)
- **Multi-vault support** — one vault per sync destination
- **Secure enclave MEK storage for biometric** — deferred to biometric unlock improvements (functional gap: biometric-only users can't write manifests until next password unlock)
