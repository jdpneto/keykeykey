import Foundation
import LocalAuthentication
import Security
import os.log

private let keychainLog = OSLog(subsystem: "com.keykeykey.app.credential-provider", category: "keychain")

// Two item shapes live in the shared keychain group:
//
// - **Biometric DEK** is written by `AppGroupPathModule.saveBiometricDEK`
//   with the Bitwarden-style shape — plain-String account "biometric_dek",
//   no service, no generic — set with BOTH kSecAttrAccessible and an
//   accessControl bound to .biometryCurrentSet. This is the only keychain
//   item the extension actually reads.
//
// - All other items (vault_header, pin_data) are written by the main app
//   through expo-secure-store v14 and therefore use its shape:
//     kSecAttrService   = "app:no-auth" (default) or "app:auth"
//     kSecAttrAccount   = Data(key.utf8)
//     kSecAttrGeneric   = Data(key.utf8)
//   A query from the appex must match that shape exactly or
//   SecItemCopyMatching returns errSecItemNotFound.
struct KeychainHelper {
    static let accessGroup: String = {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "KeychainAccessGroup") as? String else {
            fatalError("KeychainAccessGroup not configured in Info.plist")
        }
        return group
    }()

    private static let serviceNoAuth = "app:no-auth"
    private static let serviceAuth = "app:auth"

    // Keys must match apps/mobile/lib/storage.ts.
    static let vaultHeaderKey = "vault_header"
    static let biometricDEKKey = "biometric_dek"
    static let biometricEnabledFlagKey = "biometric_enabled"
    static let pinDataKey = "pin_data"

    // expo-secure-store shape for non-DEK items.
    private static func secureStoreQuery(key: String, requireAuth: Bool) -> [String: Any] {
        let encodedKey = Data(key.utf8)
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: requireAuth ? serviceAuth : serviceNoAuth,
            kSecAttrGeneric as String: encodedKey,
            kSecAttrAccount as String: encodedKey,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    // Bitwarden-style shape for the biometric DEK only.
    private static func biometricDEKQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: biometricDEKKey,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    // "Is biometric unlock configured?" probe that never triggers biometry.
    //
    // SecItemCopyMatching on the ACL-protected DEK can't answer this — when
    // `kSecUseAuthenticationUISkip` is set, iOS deliberately OMITS ACL
    // items from the result set (returns errSecItemNotFound) instead of
    // reporting that they exist but require auth. Proven on-device: a
    // follow-up SecItemAdd returned errSecDuplicateItem, i.e. the DEK was
    // there the whole time.
    //
    // The main app mirrors its intent in a plain expo-secure-store flag
    // `biometric_enabled` (written in `lib/storage.ts` via
    // `setBiometricEnabledFlag`). That flag has no auth gate and lives in
    // the same shared access group, so we can read it from the appex to
    // decide whether to surface the biometric unlock path.
    static func isBiometricConfigured() -> Bool {
        guard let data = read(key: biometricEnabledFlagKey, requireAuth: false),
              let value = String(data: data, encoding: .utf8) else {
            return false
        }
        return value == "true"
    }

    // Read the biometric DEK. iOS will present the Face ID / Touch ID
    // prompt automatically because the item carries an
    // accessControl(.biometryCurrentSet). Passing an LAContext only lets us
    // customise the prompt copy; it is not required for the prompt to fire.
    static func readBiometricDEK() -> Data? {
        let context = LAContext()
        context.localizedReason = "Unlock KeyKeyKey"
        var query = biometricDEKQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else {
            os_log("readBiometricDEK status=%d", log: keychainLog, type: .error, Int(status))
            return nil
        }
        return result as? Data
    }

    // Existence check for non-DEK keychain items (PIN, vault header).
    static func exists(key: String, requireAuth: Bool = false) -> Bool {
        var query = secureStoreQuery(key: key, requireAuth: requireAuth)
        query[kSecReturnAttributes as String] = true
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUISkip
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    // Read non-DEK keychain items.
    static func read(key: String, requireAuth: Bool = false) -> Data? {
        var query = secureStoreQuery(key: key, requireAuth: requireAuth)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    // Write a non-DEK keychain item (e.g. PIN attempts counter). The
    // appex-owned keys that round-trip back to the main app still use the
    // expo-secure-store shape so both sides agree.
    @discardableResult
    static func write(key: String, data: Data, requireAuth: Bool = false) -> Bool {
        delete(key: key, requireAuth: requireAuth)
        var query = secureStoreQuery(key: key, requireAuth: requireAuth)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    static func delete(key: String, requireAuth: Bool = false) {
        let query = secureStoreQuery(key: key, requireAuth: requireAuth)
        SecItemDelete(query as CFDictionary)
    }

    // Diagnostic dump — lists what's visible in the shared access group
    // and whether the three keys we care about are readable. Kept concise
    // so it fits in a UIAlertController body for screenshotting.
    static func diagnosticDump() {
        os_log("%{public}@", log: keychainLog, type: .info, diagnosticReport())
    }

    static func diagnosticReport() -> String {
        var lines: [String] = []
        lines.append("group=\(accessGroup)")

        let listQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUISkip,
        ]
        var listResult: AnyObject?
        let listStatus = SecItemCopyMatching(listQuery as CFDictionary, &listResult)
        lines.append("list status=\(Int(listStatus))")
        if let items = listResult as? [[String: Any]] {
            lines.append("items count=\(items.count)")
            for item in items {
                let service = item[kSecAttrService as String] as? String ?? "<nil>"
                let accountData = item[kSecAttrAccount as String] as? Data
                let accountStr = accountData.flatMap { String(data: $0, encoding: .utf8) }
                    ?? (item[kSecAttrAccount as String] as? String)
                    ?? "<nil>"
                lines.append(" • svc=\(service) acct=\(accountStr)")
            }
        }

        lines.append("bio configured=\(isBiometricConfigured())")
        lines.append("pin exists=\(exists(key: pinDataKey, requireAuth: false))")
        lines.append("hdr exists=\(exists(key: vaultHeaderKey, requireAuth: false))")

        return lines.joined(separator: "\n")
    }
}
