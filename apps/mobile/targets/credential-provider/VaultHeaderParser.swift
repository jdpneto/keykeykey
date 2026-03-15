import Foundation

// MARK: - VaultHeader

/// Parsed representation of a serialized vault header.
///
/// Mirrors the TypeScript `VaultHeader` type in `packages/core/src/crypto/vault-header.ts`.
struct VaultHeader {
    /// Schema version (must be 1).
    let version: UInt8
    /// Salt for master password KDF (16 bytes).
    let masterSalt: Data
    /// Salt for recovery key KDF (16 bytes).
    let recoverySalt: Data
    /// Argon2id tuning parameters.
    let argon2Params: Argon2Params
    /// DEK encrypted with the master password KEK.
    let masterWrappedDEK: Data
    /// DEK encrypted with the recovery key KEK.
    let recoveryWrappedDEK: Data
}

// MARK: - VaultHeaderParser

/// Parses the binary vault header format produced by the TypeScript `serializeVaultHeader`.
///
/// Binary layout (v1, all multi-byte integers are little-endian):
/// ```
/// [1B  version]
/// [16B masterSalt]
/// [16B recoverySalt]
/// [4B  argon2.t LE][4B argon2.m LE][4B argon2.p LE][4B argon2.dkLen LE]
/// [2B  masterWrappedDEK.length LE][...masterWrappedDEK bytes]
/// [2B  recoveryWrappedDEK.length LE][...recoveryWrappedDEK bytes]
/// ```
struct VaultHeaderParser {

    // MARK: - Errors

    enum ParseError: Error, LocalizedError {
        /// The input data is shorter than the minimum required length.
        case tooShort(Int)
        /// The version byte is not supported (only version 1 is valid).
        case unsupportedVersion(UInt8)
        /// The data ends unexpectedly while reading a named field.
        case truncated(String)

        var errorDescription: String? {
            switch self {
            case .tooShort(let length):
                return "Vault header data is too short: \(length) bytes"
            case .unsupportedVersion(let v):
                return "Unsupported vault header version: \(v) (expected 1)"
            case .truncated(let field):
                return "Vault header truncated at field: \(field)"
            }
        }
    }

    // MARK: - Public API

    /// Decode a base64 string and parse the resulting binary vault header.
    ///
    /// - Parameter base64String: Standard base64-encoded vault header.
    /// - Returns: A populated `VaultHeader`.
    /// - Throws: `ParseError` if the data is malformed or `DecodingError` if base64 is invalid.
    func parse(base64String: String) throws -> VaultHeader {
        guard let data = Data(base64Encoded: base64String) else {
            throw ParseError.tooShort(0)
        }
        return try parse(data: data)
    }

    /// Parse a binary vault header from raw `Data`.
    ///
    /// - Parameter data: The raw bytes produced by `serializeVaultHeader`.
    /// - Returns: A populated `VaultHeader`.
    /// - Throws: `ParseError` on any structural mismatch.
    func parse(data: Data) throws -> VaultHeader {
        // Minimum fixed-field size:
        //   1 (version) + 16 (masterSalt) + 16 (recoverySalt) + 16 (argon2 params) + 2 + 2 = 53
        let minimumLength = 53
        guard data.count >= minimumLength else {
            throw ParseError.tooShort(data.count)
        }

        var offset = 0

        // --- Version (1 byte) ---
        let version = data[data.startIndex + offset]
        offset += 1

        guard version == 1 else {
            throw ParseError.unsupportedVersion(version)
        }

        // --- masterSalt (16 bytes) ---
        let masterSalt = try readBytes(data: data, offset: &offset, count: 16, field: "masterSalt")

        // --- recoverySalt (16 bytes) ---
        let recoverySalt = try readBytes(
            data: data, offset: &offset, count: 16, field: "recoverySalt"
        )

        // --- Argon2 params (4 x UInt32 LE = 16 bytes total) ---
        let t = Int(try readUInt32LE(data: data, offset: &offset, field: "argon2.t"))
        let m = Int(try readUInt32LE(data: data, offset: &offset, field: "argon2.m"))
        let p = Int(try readUInt32LE(data: data, offset: &offset, field: "argon2.p"))
        let dkLen = Int(try readUInt32LE(data: data, offset: &offset, field: "argon2.dkLen"))

        let argon2Params = Argon2Params(t: t, m: m, p: p, dkLen: dkLen)

        // --- masterWrappedDEK (UInt16 length prefix + bytes) ---
        let masterLen = Int(
            try readUInt16LE(data: data, offset: &offset, field: "masterWrappedDEK.length")
        )
        let masterWrappedDEK = try readBytes(
            data: data, offset: &offset, count: masterLen, field: "masterWrappedDEK"
        )

        // --- recoveryWrappedDEK (UInt16 length prefix + bytes) ---
        let recoveryLen = Int(
            try readUInt16LE(data: data, offset: &offset, field: "recoveryWrappedDEK.length")
        )
        let recoveryWrappedDEK = try readBytes(
            data: data, offset: &offset, count: recoveryLen, field: "recoveryWrappedDEK"
        )

        return VaultHeader(
            version: version,
            masterSalt: masterSalt,
            recoverySalt: recoverySalt,
            argon2Params: argon2Params,
            masterWrappedDEK: masterWrappedDEK,
            recoveryWrappedDEK: recoveryWrappedDEK
        )
    }

    // MARK: - Private Helpers

    /// Read `count` bytes from `data` at the current `offset`, advancing `offset` afterwards.
    private func readBytes(data: Data, offset: inout Int, count: Int, field: String) throws -> Data {
        let start = data.startIndex + offset
        guard data.startIndex + offset + count <= data.endIndex else {
            throw ParseError.truncated(field)
        }
        let result = data.subdata(in: start ..< start + count)
        offset += count
        return result
    }

    /// Read a 2-byte little-endian `UInt16` from `data` at the current `offset`.
    private func readUInt16LE(data: Data, offset: inout Int, field: String) throws -> UInt16 {
        guard data.startIndex + offset + 2 <= data.endIndex else {
            throw ParseError.truncated(field)
        }
        let lo = UInt16(data[data.startIndex + offset])
        let hi = UInt16(data[data.startIndex + offset + 1])
        offset += 2
        return lo | (hi << 8)
    }

    /// Read a 4-byte little-endian `UInt32` from `data` at the current `offset`.
    private func readUInt32LE(data: Data, offset: inout Int, field: String) throws -> UInt32 {
        guard data.startIndex + offset + 4 <= data.endIndex else {
            throw ParseError.truncated(field)
        }
        let b0 = UInt32(data[data.startIndex + offset])
        let b1 = UInt32(data[data.startIndex + offset + 1])
        let b2 = UInt32(data[data.startIndex + offset + 2])
        let b3 = UInt32(data[data.startIndex + offset + 3])
        offset += 4
        return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
    }
}
