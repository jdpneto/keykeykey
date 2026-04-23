import Foundation

enum VaultAccessError: Error {
    case databaseNotFound
    case databaseCorrupted(String)
    case emptyVault
}

struct VaultAccess {
    struct MatchedCredential {
        let id: String
        let name: String
        let username: String
        let password: String
        let url: String?
        let appIdentifiers: [String]
        /// Raw `otpauth://` URI when the credential carries a TOTP secret.
        /// Stays in memory only as long as the matched-credential struct does.
        let totp: String?
        /// True when the credential's URL or appIdentifiers match the
        /// currently-requested service. The picker surfaces matches on top.
        let isMatch: Bool
    }

    enum AuthMethod {
        case biometric
        case pin
        case masterPassword
    }

    static func availableAuthMethod() -> AuthMethod {
        KeychainHelper.diagnosticDump()
        if KeychainHelper.isBiometricConfigured() {
            return .biometric
        }
        if KeychainHelper.exists(key: KeychainHelper.pinDataKey) {
            return .pin
        }
        return .masterPassword
    }

    static func unlockWithBiometric() -> Data? {
        // The biometric DEK keychain item carries its own ACL
        // (.biometryCurrentSet) — SecItemCopyMatching raises the Face ID /
        // Touch ID prompt automatically. No LAContext dance at the API
        // boundary; cancel / failure surfaces as `nil`.
        guard let dekData = KeychainHelper.readBiometricDEK() else {
            return nil
        }
        guard let json = try? JSONSerialization.jsonObject(with: dekData) as? [String: String],
              let dekBase64 = json["dek"],
              let dek = Data(base64Encoded: dekBase64) else {
            return nil
        }
        if let savedAt = json["savedAt"],
           let savedDate = ISO8601DateFormatter().date(from: savedAt),
           Date().timeIntervalSince(savedDate) > 14 * 24 * 60 * 60 {
            var mutableDek = dek
            mutableDek.resetBytes(in: 0..<mutableDek.count)
            return nil
        }
        var mutableDekData = dekData
        mutableDekData.resetBytes(in: 0..<mutableDekData.count)
        return dek
    }

    /// Decrypt vault credentials and return those matching the given app identifier or domain.
    ///
    /// - Parameters:
    ///   - appIdentifier: Optional bundle/app identifier to match against (e.g. "com.github.ios").
    ///   - domain: Optional domain or URL to match against (e.g. "github.com").
    ///   - dek: The 32-byte Data Encryption Key used to decrypt vault items.
    /// - Returns: An array of matching `MatchedCredential` values.
    static func findCredentials(
        appIdentifier: String?,
        domain: String?,
        dek: Data
    ) -> [MatchedCredential] {
        return (try? findCredentialsWithError(
            appIdentifier: appIdentifier,
            domain: domain,
            dek: dek
        )) ?? []
    }

    /// Decrypt and return every credential in the vault, tagging each with
    /// whether it matches the current service identifiers. The picker uses
    /// this to render a full searchable list with matches surfaced first —
    /// so the user can pick or search for any credential after unlock even
    /// when the form doesn't map to a stored item.
    static func listCredentials(
        appIdentifier: String?,
        domain: String?,
        dek: Data
    ) -> [MatchedCredential] {
        return (try? listCredentialsWithError(
            appIdentifier: appIdentifier,
            domain: domain,
            dek: dek
        )) ?? []
    }

    static func listCredentialsWithError(
        appIdentifier: String?,
        domain: String?,
        dek: Data
    ) throws -> [MatchedCredential] {
        let items: [EncryptedItem]
        do {
            items = try readCredentials()
        } catch DatabaseError.notFound {
            throw VaultAccessError.databaseNotFound
        } catch {
            throw VaultAccessError.databaseCorrupted(error.localizedDescription)
        }

        let crypto = CryptoBridge()
        var out: [MatchedCredential] = []

        for item in items {
            guard let encryptedData = Data(base64Encoded: item.encryptedDataBase64) else {
                continue
            }
            guard var decryptedData = try? crypto.decrypt(encryptedData, key: dek) else {
                continue
            }
            defer { decryptedData.resetBytes(in: 0..<decryptedData.count) }

            guard let json = try? JSONSerialization.jsonObject(with: decryptedData) as? [String: Any],
                  let name = json["name"] as? String,
                  let username = json["username"] as? String,
                  let password = json["password"] as? String else {
                continue
            }

            let url = json["url"] as? String
            let credAppIdentifiers = json["appIdentifiers"] as? [String] ?? []
            let totp = json["totp"] as? String

            var isMatch = false
            if let appIdentifier = appIdentifier,
               matchesByAppIdentifier(credential: credAppIdentifiers, query: appIdentifier) {
                isMatch = true
            }
            if !isMatch, let domain = domain,
               matchesByDomain(credentialURL: url, queryDomain: domain) {
                isMatch = true
            }

            out.append(MatchedCredential(
                id: item.id,
                name: name,
                username: username,
                password: password,
                url: url,
                appIdentifiers: credAppIdentifiers,
                totp: totp,
                isMatch: isMatch
            ))
        }

        // Matches first, then alphabetical within each group.
        return out.sorted { a, b in
            if a.isMatch != b.isMatch { return a.isMatch && !b.isMatch }
            let aKey = a.name.lowercased()
            let bKey = b.name.lowercased()
            if aKey != bKey { return aKey < bKey }
            return a.username.lowercased() < b.username.lowercased()
        }
    }

    /// Decrypt vault credentials and return those matching the given app identifier or domain.
    /// Unlike `findCredentials`, this variant throws detailed errors for UI reporting.
    ///
    /// - Parameters:
    ///   - appIdentifier: Optional bundle/app identifier to match against.
    ///   - domain: Optional domain or URL to match against.
    ///   - dek: The 32-byte Data Encryption Key.
    /// - Returns: An array of matching `MatchedCredential` values.
    /// - Throws: `VaultAccessError` if the database is missing, corrupted, or empty.
    static func findCredentialsWithError(
        appIdentifier: String?,
        domain: String?,
        dek: Data
    ) throws -> [MatchedCredential] {
        let items: [EncryptedItem]
        do {
            items = try readCredentials()
        } catch DatabaseError.notFound(let msg) {
            throw VaultAccessError.databaseNotFound
        } catch {
            throw VaultAccessError.databaseCorrupted(error.localizedDescription)
        }

        guard !items.isEmpty else {
            throw VaultAccessError.emptyVault
        }

        let crypto = CryptoBridge()
        var matched: [MatchedCredential] = []

        for item in items {
            guard let encryptedData = Data(base64Encoded: item.encryptedDataBase64) else {
                continue
            }

            guard var decryptedData = try? crypto.decrypt(encryptedData, key: dek) else {
                continue
            }

            defer {
                decryptedData.resetBytes(in: 0..<decryptedData.count)
            }

            guard let json = try? JSONSerialization.jsonObject(with: decryptedData) as? [String: Any],
                  let name = json["name"] as? String,
                  let username = json["username"] as? String,
                  let password = json["password"] as? String else {
                continue
            }

            let url = json["url"] as? String
            let credAppIdentifiers = json["appIdentifiers"] as? [String] ?? []
            let totp = json["totp"] as? String

            var isMatch = false

            if let appIdentifier = appIdentifier {
                isMatch = matchesByAppIdentifier(
                    credential: credAppIdentifiers,
                    query: appIdentifier
                )
            }

            if !isMatch, let domain = domain {
                isMatch = matchesByDomain(credentialURL: url, queryDomain: domain)
            }

            if isMatch {
                // Note: MatchedCredential.password is a Swift String, which is immutable
                // and cannot be zeroed. Passwords remain in memory until the struct is
                // deallocated. This is acceptable for Phase 2 since the extension process
                // terminates shortly after use. Phase 3 should consider using Data instead
                // of String for password fields to enable explicit zeroing.
                matched.append(MatchedCredential(
                    id: item.id,
                    name: name,
                    username: username,
                    password: password,
                    url: url,
                    appIdentifiers: credAppIdentifiers,
                    totp: totp,
                    isMatch: true
                ))
            }
        }

        return matched
    }

    // TODO: Implement when SQLite write access is available
    static func associateAppIdentifier(credentialId: String, appIdentifier: String, dek: Data) -> Bool {
        return false
    }
}
