import XCTest
@testable import CredentialProvider

class TotpEngineTests: XCTestCase {

    // MARK: - Base32

    func testBase32StandardVectors() throws {
        // RFC 4648 §10
        XCTAssertEqual(try Base32.decode(""), Data())
        XCTAssertEqual(try Base32.decode("MY======"), "f".data(using: .utf8))
        XCTAssertEqual(try Base32.decode("MZXQ===="), "fo".data(using: .utf8))
        XCTAssertEqual(try Base32.decode("MZXW6==="), "foo".data(using: .utf8))
        XCTAssertEqual(try Base32.decode("MZXW6YQ="), "foob".data(using: .utf8))
        XCTAssertEqual(try Base32.decode("MZXW6YTB"), "fooba".data(using: .utf8))
        XCTAssertEqual(try Base32.decode("MZXW6YTBOI======"), "foobar".data(using: .utf8))
    }

    func testBase32RelaxedInput() throws {
        // No padding
        XCTAssertEqual(try Base32.decode("MZXW6YTBOI"), "foobar".data(using: .utf8))
        // Lowercase
        XCTAssertEqual(try Base32.decode("mzxw6ytboi"), "foobar".data(using: .utf8))
        // Whitespace + hyphens
        XCTAssertEqual(try Base32.decode("MZXW 6YTB OI"), "foobar".data(using: .utf8))
        XCTAssertEqual(try Base32.decode("MZXW-6YTB-OI"), "foobar".data(using: .utf8))
    }

    func testBase32CanonicalSecret() throws {
        // JBSWY3DPEHPK3PXP -> "Hello!\xDE\xAD\xBE\xEF"
        let expected = Data([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef])
        XCTAssertEqual(try Base32.decode("JBSWY3DPEHPK3PXP"), expected)
    }

    func testBase32Errors() {
        XCTAssertThrowsError(try Base32.decode("MZXW6YT!"))
        XCTAssertThrowsError(try Base32.decode("0189"))
        XCTAssertThrowsError(try Base32.decode("M"))     // length 1
        XCTAssertThrowsError(try Base32.decode("MZX"))   // length 3
        XCTAssertThrowsError(try Base32.decode("MZXW6Y")) // length 6
    }

    // MARK: - HOTP RFC 4226 Appendix D vectors

    func testHotpRFC4226AppendixD() throws {
        // Secret: ASCII "12345678901234567890"
        let secret = "12345678901234567890".data(using: .utf8)!
        let expected: [(UInt64, String)] = [
            (0, "755224"),
            (1, "287082"),
            (2, "359152"),
            (3, "969429"),
            (4, "338314"),
            (5, "254676"),
            (6, "287922"),
            (7, "162583"),
            (8, "399871"),
            (9, "520489"),
        ]
        for (counter, expect) in expected {
            let code = try TotpEngine.generateHotpCode(
                secret: secret, counter: counter, digits: 6, algorithm: .sha1
            )
            XCTAssertEqual(code, expect, "counter \(counter)")
        }
    }

    func testHotpDigitBounds() {
        let secret = "12345678901234567890".data(using: .utf8)!
        XCTAssertThrowsError(try TotpEngine.generateHotpCode(
            secret: secret, counter: 0, digits: 5, algorithm: .sha1))
        XCTAssertThrowsError(try TotpEngine.generateHotpCode(
            secret: secret, counter: 0, digits: 9, algorithm: .sha1))
    }

    // MARK: - TOTP RFC 6238 Appendix B vectors
    // Per Errata ID 2832: each algorithm uses a different seed length.

    func testTotpRFC6238AppendixB() throws {
        let sha1Secret = "12345678901234567890".data(using: .utf8)!
        let sha256Secret = "12345678901234567890123456789012".data(using: .utf8)!
        let sha512Secret = "1234567890123456789012345678901234567890123456789012345678901234"
            .data(using: .utf8)!

        // (timeSeconds, sha1, sha256, sha512)
        let vectors: [(TimeInterval, String, String, String)] = [
            (59, "94287082", "46119246", "90693936"),
            (1111111109, "07081804", "68084774", "25091201"),
            (1111111111, "14050471", "67062674", "99943326"),
            (1234567890, "89005924", "91819424", "93441116"),
            (2000000000, "69279037", "90698825", "38618901"),
            (20000000000, "65353130", "77737706", "47863826"),
        ]
        for (t, sha1, sha256, sha512) in vectors {
            let date = Date(timeIntervalSince1970: t)
            let s1 = TotpParams(secret: sha1Secret, label: "rfc", issuer: "",
                algorithm: .sha1, digits: 8, period: 30)
            XCTAssertEqual(try TotpEngine.generateTotpCode(s1, at: date), sha1, "SHA-1 @ \(t)")
            let s2 = TotpParams(secret: sha256Secret, label: "rfc", issuer: "",
                algorithm: .sha256, digits: 8, period: 30)
            XCTAssertEqual(try TotpEngine.generateTotpCode(s2, at: date), sha256, "SHA-256 @ \(t)")
            let s3 = TotpParams(secret: sha512Secret, label: "rfc", issuer: "",
                algorithm: .sha512, digits: 8, period: 30)
            XCTAssertEqual(try TotpEngine.generateTotpCode(s3, at: date), sha512, "SHA-512 @ \(t)")
        }
    }

    func testTotpRejectsEmptySecret() {
        let p = TotpParams(secret: Data(), label: "x", issuer: "",
            algorithm: .sha1, digits: 6, period: 30)
        XCTAssertThrowsError(try TotpEngine.generateTotpCode(p))
    }

    func testTotpRejectsBadPeriod() {
        let secret = "12345678901234567890".data(using: .utf8)!
        for p in [0, -30] {
            let params = TotpParams(secret: secret, label: "x", issuer: "",
                algorithm: .sha1, digits: 6, period: p)
            XCTAssertThrowsError(try TotpEngine.generateTotpCode(params))
        }
    }

    func testRemainingSecondsCountdown() {
        XCTAssertEqual(TotpEngine.remainingSeconds(period: 30, at: Date(timeIntervalSince1970: 10)), 20)
        XCTAssertEqual(TotpEngine.remainingSeconds(period: 30, at: Date(timeIntervalSince1970: 29.999)), 1)
        XCTAssertEqual(TotpEngine.remainingSeconds(period: 30, at: Date(timeIntervalSince1970: 30)), 30)
    }

    // MARK: - otpauth URI parser

    func testParseFullUri() throws {
        let uri = "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=60"
        let p = try OtpAuthParser.parse(uri)
        XCTAssertEqual(p.label, "Example:alice@example.com")
        XCTAssertEqual(p.issuer, "Example")
        XCTAssertEqual(p.algorithm, .sha256)
        XCTAssertEqual(p.digits, 8)
        XCTAssertEqual(p.period, 60)
        XCTAssertEqual(p.secret.count, 10)
    }

    func testParseDefaults() throws {
        let p = try OtpAuthParser.parse("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP")
        XCTAssertEqual(p.algorithm, .sha1)
        XCTAssertEqual(p.digits, 6)
        XCTAssertEqual(p.period, 30)
        XCTAssertEqual(p.label, "x")
        XCTAssertEqual(p.issuer, "")
    }

    func testParseExtractsIssuerFromLabel() throws {
        let p = try OtpAuthParser.parse(
            "otpauth://totp/ACME%20Co:alice@example.com?secret=JBSWY3DPEHPK3PXP")
        XCTAssertEqual(p.label, "ACME Co:alice@example.com")
        XCTAssertEqual(p.issuer, "ACME Co")
    }

    func testParseRejectsHotp() {
        XCTAssertThrowsError(
            try OtpAuthParser.parse("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=0"))
    }

    func testParseRejectsNonOtpauthScheme() {
        XCTAssertThrowsError(
            try OtpAuthParser.parse("https://example.com/?secret=JBSWY3DPEHPK3PXP"))
    }

    func testParseRejectsMissingSecret() {
        XCTAssertThrowsError(try OtpAuthParser.parse("otpauth://totp/x?issuer=Example"))
    }

    func testParseRejectsInvalidAlgorithm() {
        XCTAssertThrowsError(
            try OtpAuthParser.parse("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=md5"))
    }

    func testParseRejectsBadDigits() {
        XCTAssertThrowsError(
            try OtpAuthParser.parse("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=4"))
        XCTAssertThrowsError(
            try OtpAuthParser.parse("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=12"))
    }

    func testParseRejectsBadPeriod() {
        XCTAssertThrowsError(
            try OtpAuthParser.parse("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0"))
    }
}
