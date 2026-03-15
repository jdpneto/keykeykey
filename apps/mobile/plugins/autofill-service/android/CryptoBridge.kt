package com.keykeykey.app

import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import com.goterl.lazysodium.interfaces.AEAD
import com.goterl.lazysodium.interfaces.PwHash

/**
 * Argon2id parameters matching @keykeykey/core Argon2Params.
 */
data class Argon2Params(
    val t: Int,
    val m: Int,
    val p: Int,
    val dkLen: Int,
)

/**
 * Cryptographic constants matching @keykeykey/core/crypto/constants.
 */
object CryptoConstants {
    /** 256-bit symmetric key length (DEK and KEK). */
    const val KEY_SIZE = 32
    /** 192-bit nonce for XChaCha20-Poly1305. */
    const val NONCE_SIZE = 24
    /** 128-bit Poly1305 authentication tag. */
    const val TAG_SIZE = 16
}

/**
 * Native crypto bridge using lazysodium for XChaCha20-Poly1305 and Argon2id.
 *
 * Mirrors the envelope encryption model from @keykeykey/core:
 * - decrypt: XChaCha20-Poly1305 with managed nonce (nonce prepended to ciphertext)
 * - deriveKEK: Argon2id key derivation
 * - unwrapDEK: decrypt wrapped DEK and validate length
 */
object CryptoBridge {

    private val lazySodium = LazySodiumAndroid(SodiumAndroid())

    /**
     * Decrypt ciphertext produced by @noble/ciphers managedNonce XChaCha20-Poly1305.
     *
     * Input format: [24B nonce][ciphertext][16B tag]
     * libsodium expects: nonce separate, ciphertext with tag appended.
     *
     * @param ciphertext The full ciphertext with prepended nonce
     * @param key 32-byte symmetric key
     * @return Decrypted plaintext
     * @throws IllegalArgumentException if key size is wrong or ciphertext too short
     * @throws SecurityException if decryption/authentication fails
     */
    fun decrypt(ciphertext: ByteArray, key: ByteArray): ByteArray {
        require(key.size == CryptoConstants.KEY_SIZE) {
            "Key must be ${CryptoConstants.KEY_SIZE} bytes, got ${key.size}"
        }
        require(ciphertext.size > CryptoConstants.NONCE_SIZE + CryptoConstants.TAG_SIZE) {
            "Ciphertext too short: ${ciphertext.size} bytes"
        }

        val nonce = ciphertext.copyOfRange(0, CryptoConstants.NONCE_SIZE)
        val encryptedWithTag = ciphertext.copyOfRange(CryptoConstants.NONCE_SIZE, ciphertext.size)

        val plaintext = ByteArray(encryptedWithTag.size - CryptoConstants.TAG_SIZE)
        val plaintextLen = longArrayOf(0)

        val success = lazySodium.cryptoAeadXChaCha20Poly1305IetfDecrypt(
            plaintext,
            plaintextLen,
            null, // nsec (unused)
            encryptedWithTag,
            encryptedWithTag.size.toLong(),
            null, // ad
            0L, // adLen
            nonce,
            key,
        )

        if (!success) {
            throw SecurityException("Decryption failed: authentication tag mismatch")
        }

        return plaintext.copyOf(plaintextLen[0].toInt())
    }

    /**
     * Derive a KEK from a password and salt using Argon2id.
     *
     * @param password The master password
     * @param salt 16-byte salt
     * @param params Argon2id tuning parameters
     * @return Derived key of params.dkLen bytes
     * @throws IllegalArgumentException if p != 1 (libsodium limitation)
     */
    fun deriveKEK(password: String, salt: ByteArray, params: Argon2Params): ByteArray {
        require(params.p == 1) {
            "libsodium Argon2id only supports p=1, got p=${params.p}"
        }

        val passwordBytes = password.toByteArray(Charsets.UTF_8)
        val output = ByteArray(params.dkLen)

        try {
            val result = lazySodium.cryptoPwHash(
                output,
                output.size.toLong(),
                passwordBytes,
                passwordBytes.size,
                salt,
                params.t.toLong(),
                params.m.toLong() * 1024, // m is in KiB, libsodium wants bytes
                PwHash.Alg.PWHASH_ALG_ARGON2ID13.value.toInt(),
            )

            if (!result) {
                throw SecurityException("Argon2id key derivation failed")
            }

            return output
        } finally {
            passwordBytes.fill(0)
        }
    }

    /**
     * Unwrap (decrypt) a wrapped DEK using a KEK and validate the result is 32 bytes.
     *
     * @param wrappedDEK The encrypted DEK (nonce + ciphertext + tag)
     * @param kek 32-byte Key Encryption Key
     * @return The 32-byte DEK
     * @throws SecurityException if decryption fails or DEK is not 32 bytes
     */
    fun unwrapDEK(wrappedDEK: ByteArray, kek: ByteArray): ByteArray {
        val dek = decrypt(wrappedDEK, kek)
        if (dek.size != CryptoConstants.KEY_SIZE) {
            dek.fill(0)
            throw SecurityException(
                "Unwrapped DEK is ${dek.size} bytes, expected ${CryptoConstants.KEY_SIZE}"
            )
        }
        return dek
    }
}
