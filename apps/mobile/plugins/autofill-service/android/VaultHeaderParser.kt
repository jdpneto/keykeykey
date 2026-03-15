package com.keykeykey.app

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Parsed vault header matching the binary format from @keykeykey/core vault-header.ts.
 *
 * Binary format (v1):
 * [1B version]
 * [16B masterSalt]
 * [16B recoverySalt]
 * [4B argon2.t LE][4B argon2.m LE][4B argon2.p LE][4B argon2.dkLen LE]
 * [2B masterWrappedDEK.length LE][...masterWrappedDEK]
 * [2B recoveryWrappedDEK.length LE][...recoveryWrappedDEK]
 */
data class VaultHeader(
    val version: Int,
    val masterSalt: ByteArray,
    val recoverySalt: ByteArray,
    val argon2Params: Argon2Params,
    val masterWrappedDEK: ByteArray,
    val recoveryWrappedDEK: ByteArray,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is VaultHeader) return false
        return version == other.version &&
            masterSalt.contentEquals(other.masterSalt) &&
            recoverySalt.contentEquals(other.recoverySalt) &&
            argon2Params == other.argon2Params &&
            masterWrappedDEK.contentEquals(other.masterWrappedDEK) &&
            recoveryWrappedDEK.contentEquals(other.recoveryWrappedDEK)
    }

    override fun hashCode(): Int {
        var result = version
        result = 31 * result + masterSalt.contentHashCode()
        result = 31 * result + recoverySalt.contentHashCode()
        result = 31 * result + argon2Params.hashCode()
        result = 31 * result + masterWrappedDEK.contentHashCode()
        result = 31 * result + recoveryWrappedDEK.contentHashCode()
        return result
    }
}

/**
 * Parser for the binary vault header format.
 */
object VaultHeaderParser {

    private const val EXPECTED_VERSION = 1
    private const val SALT_SIZE = 16
    /** Minimum size: 1 (version) + 16 (masterSalt) + 16 (recoverySalt) + 16 (argon2 params) = 49 */
    private const val MIN_FIXED_SIZE = 49

    /**
     * Parse a binary vault header.
     *
     * @param data Raw bytes of the serialized vault header
     * @return Parsed VaultHeader
     * @throws IllegalArgumentException if data is malformed or version is unsupported
     */
    fun parse(data: ByteArray): VaultHeader {
        require(data.isNotEmpty()) { "Vault header is empty" }

        val buf = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)

        // Version (1 byte, read as unsigned)
        val version = buf.get().toInt() and 0xFF
        require(version == EXPECTED_VERSION) {
            "Unsupported vault version: $version, expected $EXPECTED_VERSION"
        }

        require(data.size >= MIN_FIXED_SIZE) { "Vault header too short" }

        // Salts (16 bytes each)
        val masterSalt = ByteArray(SALT_SIZE)
        buf.get(masterSalt)
        val recoverySalt = ByteArray(SALT_SIZE)
        buf.get(recoverySalt)

        // Argon2 params (4 x int32 LE)
        val t = buf.getInt()
        val m = buf.getInt()
        val p = buf.getInt()
        val dkLen = buf.getInt()
        val argon2Params = Argon2Params(t = t, m = m, p = p, dkLen = dkLen)

        // masterWrappedDEK (length-prefixed, uint16 LE)
        require(buf.remaining() >= 2) { "Vault header truncated at masterWrappedDEK length" }
        val masterLen = buf.getShort().toInt() and 0xFFFF
        require(buf.remaining() >= masterLen) { "Vault header truncated at masterWrappedDEK data" }
        val masterWrappedDEK = ByteArray(masterLen)
        buf.get(masterWrappedDEK)

        // recoveryWrappedDEK (length-prefixed, uint16 LE)
        require(buf.remaining() >= 2) { "Vault header truncated at recoveryWrappedDEK length" }
        val recoveryLen = buf.getShort().toInt() and 0xFFFF
        require(buf.remaining() >= recoveryLen) { "Vault header truncated at recoveryWrappedDEK data" }
        val recoveryWrappedDEK = ByteArray(recoveryLen)
        buf.get(recoveryWrappedDEK)

        return VaultHeader(
            version = version,
            masterSalt = masterSalt,
            recoverySalt = recoverySalt,
            argon2Params = argon2Params,
            masterWrappedDEK = masterWrappedDEK,
            recoveryWrappedDEK = recoveryWrappedDEK,
        )
    }
}
