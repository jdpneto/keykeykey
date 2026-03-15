import Foundation

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

    // TODO: Implement when libsodium is linked
    static func findCredentials(appIdentifier: String?, domain: String?, dek: Data) -> [MatchedCredential] {
        return []
    }

    // TODO: Implement when SQLite write access is available
    static func associateAppIdentifier(credentialId: String, appIdentifier: String, dek: Data) -> Bool {
        return false
    }
}
