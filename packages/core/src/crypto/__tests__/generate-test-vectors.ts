/**
 * One-time generator script for cross-platform crypto test vectors.
 *
 * Uses the TypeScript crypto functions to encrypt/wrap/derive with fixed inputs
 * and writes the output values back to test-vectors.json.
 *
 * Run: cd packages/core && npx tsx src/crypto/__tests__/generate-test-vectors.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';

import { encrypt } from '../encryption.js';
import { wrapDEK } from '../dek.js';
import { deriveKEK } from '../kdf.js';
import { serializeVaultHeader } from '../vault-header.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const vectorsPath = join(__dirname, 'test-vectors.json');

async function main() {
  const vectors = JSON.parse(readFileSync(vectorsPath, 'utf-8'));

  // 1. XChaCha20-Poly1305: encrypt plaintext with key
  if (!vectors.xchacha20poly1305.ciphertext) {
    const key = hexToBytes(vectors.xchacha20poly1305.key);
    const plaintext = hexToBytes(vectors.xchacha20poly1305.plaintext);
    const ciphertext = encrypt(plaintext, key);
    vectors.xchacha20poly1305.ciphertext = bytesToHex(ciphertext);
    console.log('Generated xchacha20poly1305.ciphertext');
  } else {
    console.log('Skipped xchacha20poly1305.ciphertext (already exists)');
  }

  // 2. DEK wrap: wrap DEK with KEK
  if (!vectors.dekUnwrap.wrappedDEK) {
    const kek = hexToBytes(vectors.dekUnwrap.kek);
    const dek = hexToBytes(vectors.dekUnwrap.dek);
    const wrappedDEK = wrapDEK(dek, kek);
    vectors.dekUnwrap.wrappedDEK = bytesToHex(wrappedDEK);
    console.log('Generated dekUnwrap.wrappedDEK');
  } else {
    console.log('Skipped dekUnwrap.wrappedDEK (already exists)');
  }

  // 3. Argon2id PIN: derive KEK from PIN + salt
  if (!vectors.argon2idPin.derivedKey) {
    const salt = hexToBytes(vectors.argon2idPin.salt);
    const derivedKey = await deriveKEK(vectors.argon2idPin.pin, salt, vectors.argon2idPin.params);
    vectors.argon2idPin.derivedKey = bytesToHex(derivedKey);
    console.log('Generated argon2idPin.derivedKey');
  } else {
    console.log('Skipped argon2idPin.derivedKey (already exists)');
  }

  // 4. Full credential: encrypt credential JSON with DEK
  if (!vectors.fullCredential.encryptedDataBase64) {
    const dek = hexToBytes(vectors.fullCredential.dek);
    const plaintext = new TextEncoder().encode(vectors.fullCredential.credentialJson);
    const ciphertext = encrypt(plaintext, dek);
    // Store as base64 (matches how vault items are stored in practice)
    const base64 = Buffer.from(ciphertext).toString('base64');
    vectors.fullCredential.encryptedDataBase64 = base64;
    console.log('Generated fullCredential.encryptedDataBase64');
  } else {
    console.log('Skipped fullCredential.encryptedDataBase64 (already exists)');
  }

  // 5. Vault header: serialize a header with fixed fields
  if (!vectors.vaultHeader.serializedHex) {
    const header = {
      version: vectors.vaultHeader.version,
      masterSalt: hexToBytes(vectors.vaultHeader.masterSalt),
      recoverySalt: hexToBytes(vectors.vaultHeader.recoverySalt),
      argon2Params: vectors.vaultHeader.argon2Params,
      masterWrappedDEK: hexToBytes(vectors.vaultHeader.masterWrappedDEK),
      recoveryWrappedDEK: hexToBytes(vectors.vaultHeader.recoveryWrappedDEK),
    };
    const serialized = serializeVaultHeader(header);
    vectors.vaultHeader.serializedHex = bytesToHex(serialized);
    console.log('Generated vaultHeader.serializedHex');
  } else {
    console.log('Skipped vaultHeader.serializedHex (already exists)');
  }

  writeFileSync(vectorsPath, JSON.stringify(vectors, null, 2) + '\n', 'utf-8');
  console.log('\nTest vectors written to', vectorsPath);
}

main().catch((err) => {
  console.error('Failed to generate test vectors:', err);
  process.exit(1);
});
