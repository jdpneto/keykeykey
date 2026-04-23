package com.keykeykey.app

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Parsed vault header matching the binary format from @keykeykey/core vault-header.ts.
 *
 * Both v1 and v2 are accepted; v2 adds a length-prefixed UTF-8 `vaultId`
 * between the version byte and the salts. The extension only needs the
 * cryptographic fields (salts / params / wrapped DEKs), so `vaultId` is
 * discarded after parsing.
 *
 * Binary format (v2):
 * [1B version=2]
 * [1B vaultId.length][...vaultId UTF-8]
 * [16B masterSalt]
 * [16B recoverySalt]
 * [4B argon2.t LE][4B argon2.m LE][4B argon2.p LE][4B argon2.dkLen LE]
 * [2B masterWrappedDEK.length LE][...masterWrappedDEK]
 * [2B recoveryWrappedDEK.length LE][...recoveryWrappedDEK]
 *
 * v1 is identical but omits the vaultId header.
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

    private const val SALT_SIZE = 16
    /** Fixed section after version[+vaultId]: 16 (masterSalt) + 16 (recoverySalt) + 16 (argon2 params) = 48 */
    private const val MIN_POST_VERSION_SIZE = 48

    /**
     * Parse a binary vault header. Accepts v1 and v2 layouts.
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
        require(version == 1 || version == 2) {
            "Unsupported vault version: $version, expected 1 or 2"
        }

        // v2 inserts a length-prefixed UTF-8 vaultId between the version byte
        // and the salts. We don't need the value for autofill — just consume
        // the bytes so the subsequent offsets line up.
        if (version == 2) {
            require(buf.remaining() >= 1) { "Vault header truncated at vaultId length" }
            val vaultIdLen = buf.get().toInt() and 0xFF
            require(vaultIdLen > 0) { "Invalid v2 vault header: vaultId length must be > 0" }
            require(buf.remaining() >= vaultIdLen) { "Vault header truncated at vaultId data" }
            val skip = ByteArray(vaultIdLen)
            buf.get(skip)
        }

        require(buf.remaining() >= MIN_POST_VERSION_SIZE) { "Vault header too short" }

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
