import ExpoModulesCore
import LocalAuthentication
import Security

public class AppGroupPathModule: Module {
    public func definition() -> ModuleDefinition {
        Name("AppGroupPath")

        Function("getContainerPath") { (groupId: String) -> String? in
            return FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: groupId
            )?.path
        }

        // The fully team-prefixed keychain access group string, e.g.
        // "BZ7UTZY2UQ.com.keykeykey.shared". Stamped into Info.plist by
        // post-prebuild-ios.js so it is identical to the value the
        // CredentialProvider appex reads, avoiding any team-prefix drift.
        Function("getKeychainAccessGroup") { () -> String? in
            return Bundle.main.object(forInfoDictionaryKey: "KeychainAccessGroup") as? String
        }

        // Biometric DEK storage. The item shape intentionally mirrors
        // Bitwarden iOS (BitwardenKit/KeychainServiceFacade.setValue) to the
        // byte: a single kSecClassGenericPassword item keyed by a plain
        // String account "biometric_dek", no service or generic attribute,
        // ACL-protected with .biometryCurrentSet. kSecAttrAccessible is
        // NOT set separately — the accessControl already encodes the
        // protection class (.whenUnlockedThisDeviceOnly). Bitwarden sets
        // only accessControl + value on the write, and so do we;
        // duplicating the protection in kSecAttrAccessible appears to make
        // iOS 26 silently drop the add. Writes use SecItemUpdate-then-
        // SecItemAdd so toggling biometric off→on doesn't hit
        // errSecDuplicateItem.
        AsyncFunction("saveBiometricDEK") { (payload: String) -> Bool in
            guard let group = Bundle.main.object(forInfoDictionaryKey: "KeychainAccessGroup") as? String,
                  let data = payload.data(using: .utf8) else {
                return false
            }

            cleanupLegacyBiometricDEK(group: group)

            var aclError: Unmanaged<CFError>?
            guard let accessControl = SecAccessControlCreateWithFlags(
                nil,
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                .biometryCurrentSet,
                &aclError
            ) else {
                return false
            }

            let baseQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: biometricDEKAccount,
                kSecAttrAccessGroup as String: group,
            ]
            let attributes: [String: Any] = [
                kSecAttrAccessControl as String: accessControl,
                kSecValueData as String: data,
            ]

            // Update path first — cheaper than delete+add and avoids a
            // tiny window where the item is absent. UI-skip hint keeps the
            // matching step from trying to raise Face ID for the lookup.
            var updateLookup = baseQuery
            updateLookup[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUISkip
            let updateStatus = SecItemUpdate(updateLookup as CFDictionary, attributes as CFDictionary)
            if updateStatus == errSecSuccess {
                return true
            }

            // Insert path — either the item didn't exist or the update
            // itself failed. Best-effort delete (in case a ghost with a
            // different ACL is blocking the add) then try SecItemAdd.
            SecItemDelete(updateLookup as CFDictionary)
            var addAttributes = baseQuery
            addAttributes[kSecAttrAccessControl as String] = accessControl
            addAttributes[kSecValueData as String] = data
            return SecItemAdd(addAttributes as CFDictionary, nil) == errSecSuccess
        }

        AsyncFunction("loadBiometricDEK") { () -> String? in
            guard let group = Bundle.main.object(forInfoDictionaryKey: "KeychainAccessGroup") as? String else {
                return nil
            }
            let context = LAContext()
            context.localizedReason = "Authenticate to unlock your vault"

            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: biometricDEKAccount,
                kSecAttrAccessGroup as String: group,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
                kSecUseAuthenticationContext as String: context,
            ]
            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            guard status == errSecSuccess,
                  let data = result as? Data,
                  let str = String(data: data, encoding: .utf8) else {
                return nil
            }
            return str
        }

        AsyncFunction("deleteBiometricDEK") { () -> Bool in
            guard let group = Bundle.main.object(forInfoDictionaryKey: "KeychainAccessGroup") as? String else {
                return false
            }
            cleanupLegacyBiometricDEK(group: group)
            // Delete the current Bitwarden-shape item too. UI-skip hint so
            // delete never tries to prompt.
            let q: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: biometricDEKAccount,
                kSecAttrAccessGroup as String: group,
                kSecUseAuthenticationUI as String: kSecUseAuthenticationUISkip,
            ]
            SecItemDelete(q as CFDictionary)
            return true
        }

        // Sanity-test helper: lists items visible in the shared group,
        // probes a biometric-ACL write, and scans every entitled group to
        // surface where items actually landed. Wired to a debug row in
        // Settings so users can screenshot the output.
        Function("keychainDiagnostic") { () -> String in
            guard let group = Bundle.main.object(forInfoDictionaryKey: "KeychainAccessGroup") as? String else {
                return "no KeychainAccessGroup in Info.plist"
            }
            var lines: [String] = ["group=\(group)"]

            let cleanup: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "diag",
                kSecAttrAccount as String: Data("diag-probe".utf8),
                kSecAttrAccessGroup as String: group,
            ]
            SecItemDelete(cleanup as CFDictionary)

            let addQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "diag",
                kSecAttrAccount as String: Data("diag-probe".utf8),
                kSecAttrAccessGroup as String: group,
                kSecValueData as String: Data("hello".utf8),
                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            ]
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            lines.append("add status=\(Int(addStatus))")

            let listQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccessGroup as String: group,
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
                    let svc = item[kSecAttrService as String] as? String ?? "<nil>"
                    let acctData = item[kSecAttrAccount as String] as? Data
                    let acct = acctData.flatMap { String(data: $0, encoding: .utf8) }
                        ?? (item[kSecAttrAccount as String] as? String) ?? "<nil>"
                    lines.append("  • svc=\(svc) acct=\(acct)")
                }
            }

            SecItemDelete(cleanup as CFDictionary)

            // Explicit exists-check for the Bitwarden-shape biometric_dek item.
            let bioQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: biometricDEKAccount,
                kSecAttrAccessGroup as String: group,
                kSecReturnAttributes as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
                kSecUseAuthenticationUI as String: kSecUseAuthenticationUISkip,
            ]
            let bioStatus = SecItemCopyMatching(bioQuery as CFDictionary, nil)
            let bioExists = bioStatus == errSecSuccess || bioStatus == errSecInteractionNotAllowed
            lines.append("bio(new-shape) exists=\(bioExists) (status=\(Int(bioStatus)))")

            // Live probe: try the exact Bitwarden-shape biometric write and
            // report the OSStatus + whether the item is findable afterward.
            // Uses a different account ("diag_bio_probe") so it never
            // clobbers the real DEK. Doesn't need a SecAccessControl that
            // actually prompts — we just want to know if the access group
            // + ACL + kSecClassGenericPassword combination succeeds.
            let probeAccount = "diag_bio_probe"
            let probeCleanup: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: probeAccount,
                kSecAttrAccessGroup as String: group,
                kSecUseAuthenticationUI as String: kSecUseAuthenticationUISkip,
            ]
            SecItemDelete(probeCleanup as CFDictionary)

            var probeAclError: Unmanaged<CFError>?
            guard let probeAcl = SecAccessControlCreateWithFlags(
                nil,
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                .biometryCurrentSet,
                &probeAclError
            ) else {
                let code = probeAclError.map { CFErrorGetCode($0.takeRetainedValue()) } ?? -1
                lines.append("probe SecAccessControl FAILED code=\(code)")
                return lines.joined(separator: "\n")
            }
            let probeAdd: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: probeAccount,
                kSecAttrAccessGroup as String: group,
                kSecAttrAccessControl as String: probeAcl,
                kSecValueData as String: Data("probe".utf8),
            ]
            let probeAddStatus = SecItemAdd(probeAdd as CFDictionary, nil)
            lines.append("probe bio-add[shared] status=\(Int(probeAddStatus))")
            let probeCheckStatus = SecItemCopyMatching(probeCleanup as CFDictionary, nil)
            lines.append("probe bio-add[shared] exists=\(probeCheckStatus == errSecSuccess || probeCheckStatus == errSecInteractionNotAllowed) (status=\(Int(probeCheckStatus)))")
            SecItemDelete(probeCleanup as CFDictionary)

            // Probe 2: ACL write WITHOUT kSecAttrAccessGroup. iOS falls
            // back to the app's default (first-entry) keychain group.
            // Main-app entitlements list the shared group first, so the
            // item should still land there — but iOS may treat an implicit
            // group differently for ACL items.
            let probeImplicitCleanup: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: "diag_bio_probe_implicit",
                kSecUseAuthenticationUI as String: kSecUseAuthenticationUISkip,
            ]
            SecItemDelete(probeImplicitCleanup as CFDictionary)
            let probeImplicitAdd: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: "diag_bio_probe_implicit",
                kSecAttrAccessControl as String: probeAcl,
                kSecValueData as String: Data("probe".utf8),
            ]
            let probeImplicitStatus = SecItemAdd(probeImplicitAdd as CFDictionary, nil)
            lines.append("probe bio-add[default-group] status=\(Int(probeImplicitStatus))")
            // Broad scan afterward so we can see which group iOS picked.
            var implicitResult: AnyObject?
            let implicitList: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: "diag_bio_probe_implicit",
                kSecReturnAttributes as String: true,
                kSecMatchLimit as String: kSecMatchLimitAll,
                kSecUseAuthenticationUI as String: kSecUseAuthenticationUISkip,
            ]
            let implicitListStatus = SecItemCopyMatching(implicitList as CFDictionary, &implicitResult)
            lines.append("probe bio-add[default-group] list status=\(Int(implicitListStatus))")
            if let items = implicitResult as? [[String: Any]] {
                for item in items {
                    let grp = item[kSecAttrAccessGroup as String] as? String ?? "<nil>"
                    lines.append("  landed in grp=\(grp)")
                }
            }
            SecItemDelete(probeImplicitCleanup as CFDictionary)

            // Probe 3: ACL write to the APP-PRIVATE bundle-id-based group.
            // Main-app entitlements include this as a secondary group.
            // If this lands but the shared-group probe doesn't, the
            // regression is specific to the non-bundle-id group name.
            let appBundlePrefix = (Bundle.main.bundleIdentifier ?? "")
            let teamPrefix = group.components(separatedBy: ".").first ?? ""
            let appPrivateGroup = "\(teamPrefix).\(appBundlePrefix)"
            let probeAppCleanup: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: "diag_bio_probe_appgroup",
                kSecAttrAccessGroup as String: appPrivateGroup,
                kSecUseAuthenticationUI as String: kSecUseAuthenticationUISkip,
            ]
            SecItemDelete(probeAppCleanup as CFDictionary)
            let probeAppAdd: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: "diag_bio_probe_appgroup",
                kSecAttrAccessGroup as String: appPrivateGroup,
                kSecAttrAccessControl as String: probeAcl,
                kSecValueData as String: Data("probe".utf8),
            ]
            let probeAppStatus = SecItemAdd(probeAppAdd as CFDictionary, nil)
            lines.append("probe bio-add[app-private \(appPrivateGroup)] status=\(Int(probeAppStatus))")
            let probeAppCheck = SecItemCopyMatching(probeAppCleanup as CFDictionary, nil)
            lines.append("probe bio-add[app-private] exists=\(probeAppCheck == errSecSuccess || probeAppCheck == errSecInteractionNotAllowed) (status=\(Int(probeAppCheck)))")
            SecItemDelete(probeAppCleanup as CFDictionary)

            // Broad scan across every entitled group, mainly to spot items
            // that ended up somewhere unexpected.
            let broadListQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecReturnAttributes as String: true,
                kSecMatchLimit as String: kSecMatchLimitAll,
                kSecUseAuthenticationUI as String: kSecUseAuthenticationUISkip,
            ]
            var broadResult: AnyObject?
            let broadStatus = SecItemCopyMatching(broadListQuery as CFDictionary, &broadResult)
            lines.append("broad list status=\(Int(broadStatus))")
            if let items = broadResult as? [[String: Any]] {
                lines.append("broad items count=\(items.count)")
                for item in items {
                    let svc = item[kSecAttrService as String] as? String ?? "<nil>"
                    let grp = item[kSecAttrAccessGroup as String] as? String ?? "<nil>"
                    let acctData = item[kSecAttrAccount as String] as? Data
                    let acct = acctData.flatMap { String(data: $0, encoding: .utf8) }
                        ?? (item[kSecAttrAccount as String] as? String) ?? "<nil>"
                    lines.append("  • svc=\(svc) grp=\(grp) acct=\(acct)")
                }
            }

            return lines.joined(separator: "\n")
        }
    }
}

// Plain-String account matching Bitwarden's shape. Keeping it out of the
// Module body so delete/save/read share a single source of truth.
private let biometricDEKAccount = "biometric_dek"

// Purge every keychain shape we have ever used for the biometric DEK so
// stale items from prior builds don't collide with the upsert. Covers:
//   - expo-secure-store Data-encoded account + service "app:auth" (ACL-gated)
//   - expo-secure-store Data-encoded account + service "app:no-auth" (plain)
// Both in the shared access group. The current Bitwarden-shape item is
// handled by the caller (saveBiometricDEK upserts it; deleteBiometricDEK
// removes it separately).
private func cleanupLegacyBiometricDEK(group: String) {
    let legacyAccount = Data("biometric_dek".utf8)
    for service in ["app:auth", "app:no-auth"] {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: legacyAccount,
            kSecAttrGeneric as String: legacyAccount,
            kSecAttrAccessGroup as String: group,
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUISkip,
        ]
        SecItemDelete(q as CFDictionary)
    }
}
