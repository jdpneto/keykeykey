package com.keykeykey.app

/**
 * Kotlin TOTP compatibility test scaffold.
 *
 * These vectors are the same RFC 4226 App. D and RFC 6238 App. B (Errata
 * ID 2832) values used by the JS and Swift engines, so all three platforms
 * verify against the same source of truth.
 *
 * Mirrors `CryptoBridgeTest.kt`'s shape: not auto-run; intended for manual
 * `connectedAndroidTest` execution or import into a JUnit test target.
 */
object TotpEngineTest {

    private object Vectors {
        // RFC 4226 Appendix D — secret = ASCII "12345678901234567890"
        val hotpSecret = "12345678901234567890".toByteArray(Charsets.UTF_8)
        val hotpExpected: List<Pair<Long, String>> = listOf(
            0L to "755224",
            1L to "287082",
            2L to "359152",
            3L to "969429",
            4L to "338314",
            5L to "254676",
            6L to "287922",
            7L to "162583",
            8L to "399871",
            9L to "520489",
        )

        // RFC 6238 Appendix B — per-algorithm seed lengths (Errata ID 2832)
        val totpSha1Secret = "12345678901234567890".toByteArray(Charsets.UTF_8)
        val totpSha256Secret = "12345678901234567890123456789012".toByteArray(Charsets.UTF_8)
        val totpSha512Secret =
            "1234567890123456789012345678901234567890123456789012345678901234"
                .toByteArray(Charsets.UTF_8)

        // (timeSeconds, sha1, sha256, sha512)
        val totpVectors: List<Quad> = listOf(
            Quad(59L, "94287082", "46119246", "90693936"),
            Quad(1111111109L, "07081804", "68084774", "25091201"),
            Quad(1111111111L, "14050471", "67062674", "99943326"),
            Quad(1234567890L, "89005924", "91819424", "93441116"),
            Quad(2000000000L, "69279037", "90698825", "38618901"),
            Quad(20000000000L, "65353130", "77737706", "47863826"),
        )

        data class Quad(val time: Long, val sha1: String, val sha256: String, val sha512: String)
    }

    /** Run all assertions; throws if any vector mismatches. */
    fun runAll() {
        runHotp()
        runTotp()
        runBase32()
        runUriParser()
    }

    private fun runHotp() {
        for ((counter, expected) in Vectors.hotpExpected) {
            val code = TotpEngine.generateHotpCode(
                Vectors.hotpSecret, counter, digits = 6, algorithm = TotpAlgorithm.SHA1,
            )
            require(code == expected) { "HOTP counter=$counter: expected $expected, got $code" }
        }
    }

    private fun runTotp() {
        for (v in Vectors.totpVectors) {
            val ts = v.time * 1000L
            val s1 = TotpParams(Vectors.totpSha1Secret, "rfc", "", TotpAlgorithm.SHA1, 8, 30)
            require(TotpEngine.generateTotpCode(s1, ts) == v.sha1) {
                "TOTP SHA-1 t=${v.time}: expected ${v.sha1}"
            }
            val s2 = TotpParams(Vectors.totpSha256Secret, "rfc", "", TotpAlgorithm.SHA256, 8, 30)
            require(TotpEngine.generateTotpCode(s2, ts) == v.sha256) {
                "TOTP SHA-256 t=${v.time}: expected ${v.sha256}"
            }
            val s3 = TotpParams(Vectors.totpSha512Secret, "rfc", "", TotpAlgorithm.SHA512, 8, 30)
            require(TotpEngine.generateTotpCode(s3, ts) == v.sha512) {
                "TOTP SHA-512 t=${v.time}: expected ${v.sha512}"
            }
        }
    }

    private fun runBase32() {
        // RFC 4648 §10
        require(Base32.decode("").contentEquals(ByteArray(0)))
        require(Base32.decode("MY======").contentEquals("f".toByteArray()))
        require(Base32.decode("MZXW6YTBOI======").contentEquals("foobar".toByteArray()))
        // Tolerant input
        require(Base32.decode("mzxw6ytboi").contentEquals("foobar".toByteArray()))
        require(Base32.decode("MZXW-6YTB-OI").contentEquals("foobar".toByteArray()))
        // Errors
        runCatching { Base32.decode("MZXW6YT!") }.exceptionOrNull() ?: error("expected throw on invalid char")
        runCatching { Base32.decode("M") }.exceptionOrNull() ?: error("expected throw on length 1")
    }

    private fun runUriParser() {
        val full = OtpAuthParser.parse(
            "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP" +
                "&issuer=Example&algorithm=SHA256&digits=8&period=60",
        )
        require(full.algorithm == TotpAlgorithm.SHA256)
        require(full.digits == 8 && full.period == 60)
        require(full.issuer == "Example")

        runCatching { OtpAuthParser.parse("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=0") }
            .exceptionOrNull() ?: error("expected throw on hotp")
        runCatching { OtpAuthParser.parse("https://example.com/?secret=JBSWY3DPEHPK3PXP") }
            .exceptionOrNull() ?: error("expected throw on non-otpauth scheme")
        runCatching { OtpAuthParser.parse("otpauth://totp/x?issuer=Example") }
            .exceptionOrNull() ?: error("expected throw on missing secret")
        runCatching { OtpAuthParser.parse("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=md5") }
            .exceptionOrNull() ?: error("expected throw on bad algorithm")
    }
}
