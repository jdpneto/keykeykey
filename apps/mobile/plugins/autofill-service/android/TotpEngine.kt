package com.keykeykey.app

import java.nio.ByteBuffer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Pure-Kotlin RFC 6238 TOTP engine for the Android AutofillService.
 *
 * Mirrors the JS engine in `@keykeykey/core/totp` and the Swift engine in
 * `apps/mobile/targets/credential-provider/TotpEngine.swift` — kept in sync
 * by the shared RFC 4226 App. D and RFC 6238 App. B test vectors.
 *
 * Uses `javax.crypto.Mac` for HMAC; no extra dependency.
 */

class TotpException(message: String) : RuntimeException(message)

enum class TotpAlgorithm(val javaName: String) {
    SHA1("HmacSHA1"),
    SHA256("HmacSHA256"),
    SHA512("HmacSHA512");

    companion object {
        fun parse(raw: String): TotpAlgorithm {
            val v = raw.replace("-", "").uppercase()
            return when (v) {
                "SHA1" -> SHA1
                "SHA256" -> SHA256
                "SHA512" -> SHA512
                else -> throw TotpException("unsupported TOTP algorithm: $raw")
            }
        }
    }
}

data class TotpParams(
    val secret: ByteArray,
    val label: String,
    val issuer: String,
    val algorithm: TotpAlgorithm,
    val digits: Int,
    val period: Int,
)

object Base32 {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    private val LOOKUP: IntArray = IntArray(256).also { table ->
        for (i in table.indices) table[i] = -1
        for ((i, ch) in ALPHABET.withIndex()) {
            table[ch.code] = i
            table[ch.lowercaseChar().code] = i
        }
    }

    /**
     * Decode a Base32 string. Tolerates whitespace, hyphens, and `=` padding.
     * Throws [TotpException] on invalid characters or impossible lengths.
     */
    fun decode(input: String): ByteArray {
        val sb = StringBuilder(input.length)
        for (ch in input) {
            when (ch) {
                ' ', '-', '\t', '\n', '\r' -> continue
                '=' -> break
                else -> sb.append(ch)
            }
        }
        if (sb.isEmpty()) return ByteArray(0)

        val rem = sb.length % 8
        if (rem == 1 || rem == 3 || rem == 6) {
            throw TotpException("invalid base32: length ${sb.length} cannot represent whole bytes")
        }

        val out = ByteArray((sb.length * 5) / 8)
        var buffer = 0
        var bits = 0
        var pos = 0
        for (ch in sb) {
            val code = ch.code
            val value = if (code in 0..255) LOOKUP[code] else -1
            if (value < 0) {
                throw TotpException("invalid base32: unexpected character \"$ch\"")
            }
            buffer = (buffer shl 5) or value
            bits += 5
            if (bits >= 8) {
                bits -= 8
                out[pos++] = ((buffer shr bits) and 0xff).toByte()
            }
        }
        return out
    }
}

object TotpEngine {

    /** Encode a 64-bit counter as 8 big-endian bytes (RFC 4226 §5.2). */
    private fun counterBytes(counter: Long): ByteArray =
        ByteBuffer.allocate(8).putLong(counter).array()

    private fun hmac(secret: ByteArray, counter: Long, algorithm: TotpAlgorithm): ByteArray {
        val mac = Mac.getInstance(algorithm.javaName)
        mac.init(SecretKeySpec(secret, algorithm.javaName))
        return mac.doFinal(counterBytes(counter))
    }

    /** HOTP per RFC 4226 §5.3. `digits` must be 6, 7, or 8. */
    fun generateHotpCode(
        secret: ByteArray,
        counter: Long,
        digits: Int,
        algorithm: TotpAlgorithm,
    ): String {
        if (digits < 6 || digits > 8) {
            throw TotpException("invalid HOTP digits: $digits (must be 6, 7, or 8)")
        }
        val digest = hmac(secret, counter, algorithm)
        val offset = (digest[digest.size - 1].toInt() and 0x0f)
        val binCode =
            ((digest[offset].toInt() and 0x7f) shl 24) or
                ((digest[offset + 1].toInt() and 0xff) shl 16) or
                ((digest[offset + 2].toInt() and 0xff) shl 8) or
                (digest[offset + 3].toInt() and 0xff)
        var mod = 1
        repeat(digits) { mod *= 10 }
        return (binCode % mod).toString().padStart(digits, '0')
    }

    /**
     * TOTP per RFC 6238. `timestampMs` defaults to the current wall clock.
     */
    fun generateTotpCode(params: TotpParams, timestampMs: Long = System.currentTimeMillis()): String {
        if (params.secret.isEmpty()) throw TotpException("invalid TOTP secret: empty")
        if (params.period <= 0) throw TotpException("invalid TOTP period: ${params.period}")
        val counter = (timestampMs / 1000L) / params.period.toLong()
        return generateHotpCode(params.secret, counter, params.digits, params.algorithm)
    }

    /**
     * Seconds remaining before the current TOTP code rotates. A timestamp on
     * the period boundary belongs to the new window and reports a full
     * `period` of life (matches the JS / Swift engines).
     */
    fun remainingSeconds(period: Int, timestampMs: Long = System.currentTimeMillis()): Int {
        if (period <= 0) return 0
        val seconds = (timestampMs / 1000L).toInt()
        val elapsed = ((seconds % period) + period) % period
        return period - elapsed
    }
}

object OtpAuthParser {

    /**
     * Parse an `otpauth://totp/...` URI. Rejects `hotp://` (we don't support
     * HOTP credentials) and any non-otpauth scheme. Validates digits to 6–8
     * and period > 0; whitelists algorithm to SHA-1/256/512.
     */
    fun parse(uri: String): TotpParams {
        if (!uri.lowercase().startsWith("otpauth://")) {
            throw TotpException("invalid TOTP URI: must start with otpauth://")
        }
        val withoutScheme = uri.substring("otpauth://".length)

        val qIdx = withoutScheme.indexOf('?')
        val pathPart = if (qIdx == -1) withoutScheme else withoutScheme.substring(0, qIdx)
        val queryPart = if (qIdx == -1) "" else withoutScheme.substring(qIdx + 1)

        val sIdx = pathPart.indexOf('/')
        val type: String
        val label: String
        if (sIdx == -1) {
            type = pathPart.lowercase()
            label = ""
        } else {
            type = pathPart.substring(0, sIdx).lowercase()
            label = decodeUriComponent(pathPart.substring(sIdx + 1))
        }
        when (type) {
            "totp" -> { /* ok */ }
            "hotp" -> throw TotpException("HOTP URIs are not supported — only otpauth://totp/...")
            else -> throw TotpException("invalid TOTP URI: unknown type \"$type\"")
        }

        val params = mutableMapOf<String, String>()
        if (queryPart.isNotEmpty()) {
            for (pair in queryPart.split('&')) {
                val eq = pair.indexOf('=')
                if (eq == -1) {
                    params[pair] = ""
                } else {
                    params[pair.substring(0, eq)] = decodeUriComponent(pair.substring(eq + 1))
                }
            }
        }

        val rawSecret = params["secret"]?.takeIf { it.isNotEmpty() }
            ?: throw TotpException("invalid TOTP URI: missing secret")
        val secret = Base32.decode(rawSecret)

        val algorithm = TotpAlgorithm.parse(params["algorithm"] ?: "SHA1")

        val digits = params["digits"]?.toIntOrNull() ?: 6
        if (digits < 6 || digits > 8) throw TotpException("invalid TOTP digits: $digits")

        val period = params["period"]?.toIntOrNull() ?: 30
        if (period <= 0) throw TotpException("invalid TOTP period: $period")

        var issuer = params["issuer"] ?: ""
        if (issuer.isEmpty() && label.contains(':')) {
            issuer = label.substringBefore(':')
        }

        return TotpParams(
            secret = secret,
            label = label,
            issuer = issuer,
            algorithm = algorithm,
            digits = digits,
            period = period,
        )
    }

    private fun decodeUriComponent(s: String): String =
        try {
            java.net.URLDecoder.decode(s, "UTF-8")
        } catch (_: Exception) {
            s
        }
}
