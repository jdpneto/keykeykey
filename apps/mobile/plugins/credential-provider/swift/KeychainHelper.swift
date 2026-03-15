import Foundation
import Security
import LocalAuthentication

struct KeychainHelper {
    // Read access group from Info.plist (config plugin writes the resolved value)
    static let accessGroup: String = {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "KeychainAccessGroup") as? String else {
            fatalError("KeychainAccessGroup not configured in Info.plist")
        }
        return group
    }()

    static func read(key: String, requireBiometric: Bool = false) -> Data? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if requireBiometric {
            let context = LAContext()
            context.localizedReason = "Unlock KeyKeyKey"
            query[kSecUseAuthenticationContext as String] = context
        }
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    static func write(key: String, data: Data, requireBiometric: Bool = false) -> Bool {
        delete(key: key)
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        if requireBiometric {
            let access = SecAccessControlCreateWithFlags(
                nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                .biometryCurrentSet, nil
            )
            query[kSecAttrAccessControl as String] = access
            query.removeValue(forKey: kSecAttrAccessible as String)
        }
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // Keys must match React Native storage layer (apps/mobile/lib/storage.ts)
    static let vaultHeaderKey = "vault_header"
    static let biometricDEKKey = "biometric_dek"
    static let pinDataKey = "pin_data"
}
