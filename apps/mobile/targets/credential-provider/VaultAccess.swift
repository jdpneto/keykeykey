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
    }

    enum AuthMethod {
        case biometric
        case pin
        case masterPassword
    }

    static func availableAuthMethod() -> AuthMethod {
        if KeychainHelper.read(key: KeychainHelper.biometricDEKKey) != nil {
            return .biometric
        }
        if KeychainHelper.read(key: KeychainHelper.pinDataKey) != nil {
            return .pin
        }
        return .masterPassword
    }

    static func unlockWithBiometric() -> Data? {
        guard let dekData = KeychainHelper.read(key: KeychainHelper.biometricDEKKey, requireBiometric: true) else {
            return nil
        }
        guard let json = try? JSONSerialization.jsonObject(with: dekData) as? [String: String],
              let dekBase64 = json["dek"],
              let dek = Data(base64Encoded: dekBase64) else {
            return nil
        }
        // Check 14-day expiry
        if let savedAt = json["savedAt"],
           let savedDate = ISO8601DateFormatter().date(from: savedAt),
           Date().timeIntervalSince(savedDate) > 14 * 24 * 60 * 60 {
            var mutableDek = dek
            mutableDek.resetBytes(in: 0..<mutableDek.count)
            return nil
        }
        // Zero intermediate Keychain data
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
                    appIdentifiers: credAppIdentifiers
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
