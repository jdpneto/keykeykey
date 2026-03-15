import Foundation
import Sodium
import Clibsodium

// MARK: - Errors

/// Errors that can occur during cryptographic operations in the credential provider.
enum CryptoError: Error, LocalizedError {
    case decryptionFailed
    case invalidCiphertext(String)
    case invalidKeySize(Int)
    case unsupportedParallelism(String)
    case argon2Failed

    var errorDescription: String? {
        switch self {
        case .decryptionFailed:
            return "Decryption failed: authentication tag verification failed or wrong key"
        case .invalidCiphertext(let reason):
            return "Invalid ciphertext: \(reason)"
        case .invalidKeySize(let size):
            return "Invalid key size: expected \(CryptoConstants.keySize) bytes, got \(size)"
        case .unsupportedParallelism(let reason):
            return "Unsupported parallelism: \(reason)"
        case .argon2Failed:
            return "Argon2id key derivation failed"
        }
    }
}

// MARK: - Constants

/// Cryptographic constants matching the TypeScript @noble/ciphers format.
///
/// Wire format: `[24-byte nonce][ciphertext][16-byte Poly1305 tag]`
struct CryptoConstants {
    static let keySize = 32
    static let nonceSize = 24
    static let tagSize = 16
    static let saltSize = 16
    /// Total overhead added by managed-nonce XChaCha20-Poly1305: nonce + tag.
    static let overhead = nonceSize + tagSize // 40
}

// MARK: - Argon2 Parameters

/// Argon2id tuning parameters matching the TypeScript `Argon2Params` interface.
struct Argon2Params {
    /// Time cost (number of iterations / opslimit).
    let t: Int
    /// Memory cost in KiB (memlimit = m * 1024).
    let m: Int
    /// Parallelism (must be 1 for libsodium's `crypto_pwhash`).
    let p: Int
    /// Derived key length in bytes.
    let dkLen: Int
}

// MARK: - CryptoBridge

/// Thin wrapper around libsodium that matches the TypeScript `@noble/ciphers` binary format exactly.
/// Read/decrypt only -- this bridge is used by the credential provider extension to unlock vaults.
struct CryptoBridge {
    private let sodium = Sodium()

    /// Decrypt ciphertext produced by the TypeScript core's `encrypt()` function.
    ///
    /// Expected input format: `[24-byte nonce][ciphertext][16-byte Poly1305 tag]`
    ///
    /// libsodium's `xchacha20poly1305ietf.decrypt` expects `[ciphertext][tag]` as the
    /// authenticated ciphertext, so we strip the leading 24-byte nonce and pass the rest.
    ///
    /// - Parameters:
    ///   - ciphertext: The full wire-format ciphertext (nonce + ciphertext + tag).
    ///   - key: A 32-byte symmetric key.
    /// - Returns: The decrypted plaintext.
    /// - Throws: `CryptoError.invalidKeySize` if key is not 32 bytes.
    /// - Throws: `CryptoError.invalidCiphertext` if data is too short.
    /// - Throws: `CryptoError.decryptionFailed` if authentication fails.
    func decrypt(_ ciphertext: Data, key: Data) throws -> Data {
        guard key.count == CryptoConstants.keySize else {
            throw CryptoError.invalidKeySize(key.count)
        }
        guard ciphertext.count > CryptoConstants.overhead else {
            throw CryptoError.invalidCiphertext(
                "too short: expected > \(CryptoConstants.overhead) bytes, got \(ciphertext.count)"
            )
        }

        let nonce = ciphertext.subdata(in: 0 ..< CryptoConstants.nonceSize)
        // Remainder is [ciphertext][tag] — exactly what libsodium expects
        let authenticatedCiphertext = ciphertext.subdata(
            in: CryptoConstants.nonceSize ..< ciphertext.count
        )

        let nonceBytes = Array(nonce)
        let ciphertextBytes = Array(authenticatedCiphertext)
        let keyBytes = Array(key)

        guard let plaintext = sodium.aead.xchacha20poly1305ietf.decrypt(
            authenticatedCipherText: ciphertextBytes,
            secretKey: keyBytes,
            nonce: nonceBytes
        ) else {
            throw CryptoError.decryptionFailed
        }

        return Data(plaintext)
    }

    /// Unwrap (decrypt) a wrapped DEK using the KEK and validate the result is 32 bytes.
    ///
    /// - Parameters:
    ///   - wrappedDEK: The encrypted DEK (output of TypeScript `wrapDEK`).
    ///   - kek: The 32-byte Key Encryption Key derived from the master password.
    /// - Returns: The 32-byte Data Encryption Key.
    /// - Throws: `CryptoError` if decryption or validation fails.
    func unwrapDEK(_ wrappedDEK: Data, kek: Data) throws -> Data {
        let dek = try decrypt(wrappedDEK, key: kek)
        guard dek.count == CryptoConstants.keySize else {
            throw CryptoError.invalidCiphertext(
                "unwrapped DEK must be \(CryptoConstants.keySize) bytes, got \(dek.count)"
            )
        }
        return dek
    }

    /// Derive a KEK from a master password using Argon2id via libsodium's `crypto_pwhash`.
    ///
    /// - Parameters:
    ///   - password: The user's master password (UTF-8 string).
    ///   - salt: A 16-byte salt from the vault header.
    ///   - params: Argon2id tuning parameters (t, m, p, dkLen).
    /// - Returns: The derived key (KEK) of length `params.dkLen`.
    /// - Throws: `CryptoError.unsupportedParallelism` if `params.p != 1`.
    /// - Throws: `CryptoError.argon2Failed` if derivation fails.
    func deriveKEK(password: String, salt: Data, params: Argon2Params) throws -> Data {
        guard params.p == 1 else {
            throw CryptoError.unsupportedParallelism(
                "libsodium crypto_pwhash only supports p=1, got p=\(params.p)"
            )
        }

        var passwordBytes = Array(password.utf8)
        defer {
            for i in passwordBytes.indices {
                passwordBytes[i] = 0
            }
        }

        let saltBytes = Array(salt)
        var output = [UInt8](repeating: 0, count: params.dkLen)

        // crypto_pwhash maps: t -> opslimit, m * 1024 -> memlimit (KiB to bytes)
        let result = crypto_pwhash(
            &output,
            UInt64(params.dkLen),
            passwordBytes.map { Int8(bitPattern: $0) },
            UInt64(passwordBytes.count),
            saltBytes,
            UInt64(params.t),
            Int(params.m) * 1024,
            Int32(crypto_pwhash_ALG_ARGON2ID13)
        )

        guard result == 0 else {
            throw CryptoError.argon2Failed
        }

        return Data(output)
    }
}
