package com.keykeykey.app

// To run: build with Android, execute via adb or connectedAndroidTest

/**
 * Kotlin crypto compatibility test scaffold.
 *
 * These test vectors are copied from packages/core/src/crypto/__tests__/test-vectors.json
 * to verify that the Kotlin CryptoBridge implementation produces identical results
 * to the TypeScript core.
 */
object CryptoBridgeTest {

    // ── Test vectors from core ──────────────────────────────────────────

    private object Vectors {
        // XChaCha20-Poly1305
        val xchacha20Key =
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
        val xchacha20Plaintext =
            "48656c6c6f2c204b65794b65794b657921" // "Hello, KeyKeyKey!"
        val xchacha20Ciphertext =
            "4d4a19d68b055de39f10d12c82e8ca2b6016318aa77a803b7bc7c34556789b3fd5b50b140b6e9bf97d55359a0cf1d5554e87725bcda7b918e1"

        // DEK unwrap
        val dekUnwrapKek =
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
        val dekUnwrapDek =
            "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
        val dekUnwrapWrapped =
            "2e9fc437ba71e16203024864fe2cd30df69da4dcf776431152689c63c159ca8de68b3278ffea566e176ad30eae046adfb9cf52806f1377c3f54e3930b843156920d0e98aaf9d0c04"

        // Argon2id PIN derivation
        val argon2Pin = "1234"
        val argon2Salt = "00112233445566778899aabbccddeeff"
        val argon2T = 2
        val argon2M = 19456
        val argon2P = 1
        val argon2DkLen = 32
        val argon2DerivedKey =
            "c13a995629afb54a46a6463d6d828616abf2229ce42a7972afcef4235c4d310b"

        // Vault header
        val vaultHeaderHex =
            "0100010203040506070809101112131415a0a1a2a3a4a5a6a7a8a9b0b1b2b3b4b502000000004c0000010000002000000048002e9fc437ba71e16203024864fe2cd30df69da4dcf776431152689c63c159ca8de68b3278ffea566e176ad30eae046adfb9cf52806f1377c3f54e3930b843156920d0e98aaf9d0c0448002e9fc437ba71e16203024864fe2cd30df69da4dcf776431152689c63c159ca8de68b3278ffea566e176ad30eae046adfb9cf52806f1377c3f54e3930b843156920d0e98aaf9d0c04"

        // Full credential decrypt
        val fullCredentialDek =
            "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
        val fullCredentialEncryptedBase64 =
            "I0P/E+MuNwTNPWZwW7/bPJ5OujRYXsew+R17sURI285IlI5DDFRFqeGMyvbN/LSdPJdG+ha9VuvSmLskqPzNmTWvsTLCHVEGtxx8skM2Hubm+qkOZV3xNE1W9btxX/7xRW94GhAPndv4S4mtdn+rRa+NZZzdMTmVGjov5SRbVHch880ttfxR8SWCuJ/lHGdrb1/YoM6zJ2sYpagzz1vmCvyl5sqW/0zZ8lh5H1ii6/pqUgnBQWIZVPnY4DjL96ESZyTT6AHzOYvthfPQ7oZUqiwcs2fOJqsPT+jh6pXPrSZSZHDkipoeLZZ3iH09ohHBhVMshkw4M+j8zVP5wx8jdPE/PvsAyuIGlxkUvnFFJwi0TM7Tg3DtixVE32vQOoYhXQA0Yc2FuM1TFvVbXD1+fjlHxvYyTp054Svg8M+DZokzsXoThwzcxPwg395LAvuEP5SlnA=="
        val fullCredentialJson =
            """{"id":"550e8400-e29b-41d4-a716-446655440000","type":"credential","name":"GitHub","username":"user@example.com","password":"s3cret!","url":"https://github.com","appIdentifiers":["com.github.ios"],"tags":[],"favorite":false,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}"""
    }

    // ── Helper ──────────────────────────────────────────────────────────

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun assert(condition: Boolean, message: String) {
        if (!condition) throw AssertionError(message)
    }

    // ── Tests ───────────────────────────────────────────────────────────

    /**
     * Verify XChaCha20-Poly1305 decrypt produces the expected plaintext.
     */
    fun testXChaCha20Poly1305Decrypt() {
        val key = hexToBytes(Vectors.xchacha20Key)
        val ciphertext = hexToBytes(Vectors.xchacha20Ciphertext)
        val expectedPlaintext = hexToBytes(Vectors.xchacha20Plaintext)

        val plaintext = CryptoBridge.decrypt(key, ciphertext)
        assert(
            bytesToHex(plaintext) == bytesToHex(expectedPlaintext),
            "XChaCha20-Poly1305 decrypt mismatch: " +
                "expected ${bytesToHex(expectedPlaintext)}, got ${bytesToHex(plaintext)}"
        )
        println("[PASS] testXChaCha20Poly1305Decrypt")
    }

    /**
     * Verify DEK unwrap (decrypt wrapped DEK using KEK).
     */
    fun testDEKUnwrap() {
        val kek = hexToBytes(Vectors.dekUnwrapKek)
        val wrapped = hexToBytes(Vectors.dekUnwrapWrapped)
        val expectedDek = hexToBytes(Vectors.dekUnwrapDek)

        val dek = CryptoBridge.decrypt(kek, wrapped)
        assert(
            bytesToHex(dek) == bytesToHex(expectedDek),
            "DEK unwrap mismatch: expected ${bytesToHex(expectedDek)}, got ${bytesToHex(dek)}"
        )
        println("[PASS] testDEKUnwrap")
    }

    /**
     * Verify Argon2id PIN derivation produces the expected derived key.
     */
    fun testArgon2idPinDerivation() {
        val salt = hexToBytes(Vectors.argon2Salt)
        val expectedKey = hexToBytes(Vectors.argon2DerivedKey)

        val derived = CryptoBridge.deriveKeyArgon2id(
            password = Vectors.argon2Pin,
            salt = salt,
            timeCost = Vectors.argon2T,
            memoryCost = Vectors.argon2M,
            parallelism = Vectors.argon2P,
            hashLength = Vectors.argon2DkLen
        )
        assert(
            bytesToHex(derived) == bytesToHex(expectedKey),
            "Argon2id PIN derivation mismatch: " +
                "expected ${bytesToHex(expectedKey)}, got ${bytesToHex(derived)}"
        )
        println("[PASS] testArgon2idPinDerivation")
    }

    /**
     * Verify vault header parsing extracts the correct fields.
     */
    fun testVaultHeaderParse() {
        val headerBytes = hexToBytes(Vectors.vaultHeaderHex)

        val header = VaultHeaderParser.parse(headerBytes)
        assert(header.version == 1, "Version mismatch: expected 1, got ${header.version}")
        assert(
            bytesToHex(header.masterWrappedDEK) == Vectors.dekUnwrapWrapped,
            "Master wrapped DEK mismatch"
        )
        assert(
            bytesToHex(header.recoveryWrappedDEK) == Vectors.dekUnwrapWrapped,
            "Recovery wrapped DEK mismatch"
        )
        assert(header.argon2Params.t == 2, "Argon2 t mismatch")
        assert(header.argon2Params.m == 19456, "Argon2 m mismatch")
        assert(header.argon2Params.p == 1, "Argon2 p mismatch")
        assert(header.argon2Params.dkLen == 32, "Argon2 dkLen mismatch")
        println("[PASS] testVaultHeaderParse")
    }

    /**
     * Verify full credential decrypt: DEK decrypts the encrypted credential
     * and the resulting JSON matches the expected credential.
     */
    fun testFullCredentialDecrypt() {
        val dek = hexToBytes(Vectors.fullCredentialDek)
        val encryptedBytes = android.util.Base64.decode(
            Vectors.fullCredentialEncryptedBase64,
            android.util.Base64.DEFAULT
        )

        val plaintext = CryptoBridge.decrypt(dek, encryptedBytes)
        val json = String(plaintext, Charsets.UTF_8)
        assert(
            json == Vectors.fullCredentialJson,
            "Full credential decrypt mismatch:\nexpected: ${Vectors.fullCredentialJson}\ngot:      $json"
        )
        println("[PASS] testFullCredentialDecrypt")
    }

    /**
     * Run all tests sequentially.
     */
    fun runAll() {
        println("=== CryptoBridge Compatibility Tests ===")
        testXChaCha20Poly1305Decrypt()
        testDEKUnwrap()
        testArgon2idPinDerivation()
        testVaultHeaderParse()
        testFullCredentialDecrypt()
        println("=== All tests passed ===")
    }
}
