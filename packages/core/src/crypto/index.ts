// Cryptographic primitives for KeyKeyKey vault encryption.
// Uses @noble/ciphers (XChaCha20-Poly1305) and @noble/hashes (Argon2id).
//
// Encryption flow:
// 1. Derive KEK from MasterPassword via Argon2id
// 2. Generate random DEK (Data Encryption Key)
// 3. Wrap DEK with KEK (envelope encryption)
// 4. Encrypt vault items with DEK using XChaCha20-Poly1305

export {};
