import Foundation
import CryptoKit

// MARK: - Errors

enum TotpError: Error, LocalizedError {
    case invalidUri(String)
    case invalidBase32(String)
    case unsupportedAlgorithm(String)
    case invalidDigits(Int)
    case invalidPeriod(Int)
    case emptySecret
    case unsupportedType(String)

    var errorDescription: String? {
        switch self {
        case .invalidUri(let m): return "invalid otpauth URI: \(m)"
        case .invalidBase32(let m): return "invalid base32: \(m)"
        case .unsupportedAlgorithm(let a): return "unsupported TOTP algorithm: \(a)"
        case .invalidDigits(let d): return "invalid TOTP digits: \(d) (must be 6, 7, or 8)"
        case .invalidPeriod(let p): return "invalid TOTP period: \(p)"
        case .emptySecret: return "invalid TOTP secret: empty"
        case .unsupportedType(let t): return "unsupported otpauth type: \(t) (only totp)"
        }
    }
}

// MARK: - Algorithm

enum TotpAlgorithm: String {
    case sha1 = "SHA-1"
    case sha256 = "SHA-256"
    case sha512 = "SHA-512"

    static func parse(_ raw: String) throws -> TotpAlgorithm {
        let v = raw.replacingOccurrences(of: "-", with: "").uppercased()
        switch v {
        case "SHA1": return .sha1
        case "SHA256": return .sha256
        case "SHA512": return .sha512
        default: throw TotpError.unsupportedAlgorithm(raw)
        }
    }
}

// MARK: - Params

struct TotpParams {
    let secret: Data
    let label: String
    let issuer: String
    let algorithm: TotpAlgorithm
    let digits: Int
    let period: Int
}

// MARK: - Base32 (RFC 4648)

enum Base32 {
    private static let alphabet: [Character] = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
    private static let lookup: [Character: Int] = {
        var map: [Character: Int] = [:]
        for (i, ch) in alphabet.enumerated() {
            map[ch] = i
            map[Character(ch.lowercased())] = i
        }
        return map
    }()

    /// Decode a Base32 string. Tolerates whitespace, hyphens, and `=` padding.
    static func decode(_ input: String) throws -> Data {
        var clean = ""
        for ch in input {
            if ch == " " || ch == "-" || ch == "\t" || ch == "\n" || ch == "\r" { continue }
            if ch == "=" { break }
            clean.append(ch)
        }
        if clean.isEmpty { return Data() }

        let rem = clean.count % 8
        if rem == 1 || rem == 3 || rem == 6 {
            throw TotpError.invalidBase32("length \(clean.count) cannot represent whole bytes")
        }

        var out: [UInt8] = []
        out.reserveCapacity((clean.count * 5) / 8)
        var buffer: UInt32 = 0
        var bits: UInt32 = 0

        for ch in clean {
            guard let value = lookup[ch] else {
                throw TotpError.invalidBase32("unexpected character \"\(ch)\"")
            }
            buffer = (buffer << 5) | UInt32(value)
            bits += 5
            if bits >= 8 {
                bits -= 8
                out.append(UInt8((buffer >> bits) & 0xff))
            }
        }
        return Data(out)
    }
}

// MARK: - HOTP / TOTP (RFC 4226 / 6238)

enum TotpEngine {

    /// Encode a 64-bit counter as 8 big-endian bytes (RFC 4226 §5.2).
    private static func counterBytes(_ counter: UInt64) -> Data {
        var out = Data(count: 8)
        for i in 0..<8 {
            out[7 - i] = UInt8((counter >> UInt64(i * 8)) & 0xff)
        }
        return out
    }

    /// HMAC over the counter for the given algorithm, returning the raw digest bytes.
    private static func hmac(secret: Data, counter: UInt64, algorithm: TotpAlgorithm) -> Data {
        let key = SymmetricKey(data: secret)
        let cb = counterBytes(counter)
        switch algorithm {
        case .sha1:
            return Data(HMAC<Insecure.SHA1>.authenticationCode(for: cb, using: key))
        case .sha256:
            return Data(HMAC<SHA256>.authenticationCode(for: cb, using: key))
        case .sha512:
            return Data(HMAC<SHA512>.authenticationCode(for: cb, using: key))
        }
    }

    /// HOTP code generation per RFC 4226 §5.3.
    static func generateHotpCode(secret: Data, counter: UInt64, digits: Int, algorithm: TotpAlgorithm) throws -> String {
        guard digits >= 6 && digits <= 8 else { throw TotpError.invalidDigits(digits) }
        let digest = hmac(secret: secret, counter: counter, algorithm: algorithm)
        let last = Int(digest[digest.count - 1])
        let offset = last & 0x0f
        let binCode =
            (UInt32(digest[offset]) & 0x7f) << 24 |
            (UInt32(digest[offset + 1]) & 0xff) << 16 |
            (UInt32(digest[offset + 2]) & 0xff) << 8 |
            (UInt32(digest[offset + 3]) & 0xff)
        let mod = UInt32(pow(10.0, Double(digits)))
        let value = binCode % mod
        return String(format: "%0\(digits)u", value)
    }

    /// TOTP code generation per RFC 6238.
    static func generateTotpCode(_ params: TotpParams, at date: Date = Date()) throws -> String {
        if params.secret.isEmpty { throw TotpError.emptySecret }
        if params.period <= 0 { throw TotpError.invalidPeriod(params.period) }
        let counter = UInt64(date.timeIntervalSince1970) / UInt64(params.period)
        return try generateHotpCode(
            secret: params.secret,
            counter: counter,
            digits: params.digits,
            algorithm: params.algorithm
        )
    }

    /// Seconds remaining before the current TOTP code rotates.
    static func remainingSeconds(period: Int, at date: Date = Date()) -> Int {
        guard period > 0 else { return 0 }
        let elapsed = Int(date.timeIntervalSince1970) % period
        return period - elapsed
    }
}

// MARK: - otpauth:// URI parser

enum OtpAuthParser {

    static func parse(_ uri: String) throws -> TotpParams {
        guard uri.lowercased().hasPrefix("otpauth://") else {
            throw TotpError.invalidUri("must start with otpauth://")
        }
        let withoutScheme = String(uri.dropFirst("otpauth://".count))

        // Split on the first '?' for path / query.
        let pathPart: String
        let queryPart: String
        if let q = withoutScheme.firstIndex(of: "?") {
            pathPart = String(withoutScheme[..<q])
            queryPart = String(withoutScheme[withoutScheme.index(after: q)...])
        } else {
            pathPart = withoutScheme
            queryPart = ""
        }

        // type/label
        let type: String
        let label: String
        if let s = pathPart.firstIndex(of: "/") {
            type = String(pathPart[..<s]).lowercased()
            let raw = String(pathPart[pathPart.index(after: s)...])
            label = raw.removingPercentEncoding ?? raw
        } else {
            type = pathPart.lowercased()
            label = ""
        }
        if type == "hotp" {
            throw TotpError.unsupportedType("hotp")
        }
        if type != "totp" {
            throw TotpError.unsupportedType(type)
        }

        // Parse query
        var params: [String: String] = [:]
        if !queryPart.isEmpty {
            for pair in queryPart.split(separator: "&") {
                let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                let k = String(kv[0])
                let v = kv.count == 2 ? String(kv[1]) : ""
                params[k] = v.removingPercentEncoding ?? v
            }
        }

        guard let rawSecret = params["secret"], !rawSecret.isEmpty else {
            throw TotpError.invalidUri("missing secret")
        }
        let secret = try Base32.decode(rawSecret)

        let algorithm = try TotpAlgorithm.parse(params["algorithm"] ?? "SHA1")

        let digitsRaw = params["digits"]
        let digits: Int = digitsRaw.flatMap(Int.init) ?? 6
        if digits < 6 || digits > 8 { throw TotpError.invalidDigits(digits) }

        let periodRaw = params["period"]
        let period: Int = periodRaw.flatMap(Int.init) ?? 30
        if period <= 0 { throw TotpError.invalidPeriod(period) }

        var issuer = params["issuer"] ?? ""
        if issuer.isEmpty, let colon = label.firstIndex(of: ":") {
            issuer = String(label[..<colon])
        }

        return TotpParams(
            secret: secret,
            label: label,
            issuer: issuer,
            algorithm: algorithm,
            digits: digits,
            period: period
        )
    }
}
