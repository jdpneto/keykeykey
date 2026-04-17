import AuthenticationServices
import SwiftUI
import UIKit

class CredentialProviderViewController: ASCredentialProviderViewController {

    /// Which kind of autofill the system asked us for. iOS 17 added a
    /// dedicated one-time-code path that completes via
    /// `ASOneTimeCodeCredential` instead of `ASPasswordCredential`.
    enum RequestKind {
        case password
        case oneTimeCode
    }

    private var dek: Data?
    private var currentServiceIdentifiers: [ASCredentialServiceIdentifier] = []
    private var requestKind: RequestKind = .password

    // MARK: - ASCredentialProviderViewController overrides

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        currentServiceIdentifiers = serviceIdentifiers
        requestKind = .password
        showUnlockUI()
    }

    /// iOS 17+: system asks the provider to surface a one-time code for the
    /// current site. We unlock the vault and then show only credentials that
    /// carry a TOTP secret.
    override func prepareOneTimeCodeCredentialList(
        for serviceIdentifiers: [ASCredentialServiceIdentifier]
    ) {
        currentServiceIdentifiers = serviceIdentifiers
        requestKind = .oneTimeCode
        showUnlockUI()
    }

    override func provideCredentialWithoutUserInteraction(
        for credentialIdentity: ASPasswordCredentialIdentity
    ) {
        // Always require user interaction for v1
        self.extensionContext.cancelRequest(
            withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.userInteractionRequired.rawValue
            )
        )
    }

    override func prepareInterfaceToProvideCredential(
        for credentialIdentity: ASPasswordCredentialIdentity
    ) {
        // Extract service identifiers from the identity
        let serviceIdentifier = credentialIdentity.serviceIdentifier
        currentServiceIdentifiers = [serviceIdentifier]
        requestKind = .password
        showUnlockUI()
    }

    // Note: the iOS 18 one-time-code flow is driven entirely by
    // `prepareOneTimeCodeCredentialList(for:)` above — the system calls that
    // to populate the suggestion list, then the user's selection returns the
    // code via `extensionContext.completeOneTimeCodeRequest` (see
    // handlePinUnlock/handlePasswordUnlock). Earlier versions of this file
    // had an `override prepareInterfaceToProvideCredential(for: ASOneTimeCodeCredentialIdentity)`
    // method, but no such override exists on `ASCredentialProviderViewController`
    // in the iOS 18 SDK — the real superclass method is
    // `prepareInterfaceToProvideCredentialForRequest:` taking
    // `id<ASCredentialRequest>`. That generic entrypoint isn't needed here
    // because the user is always routed through the full unlock UI for both
    // password and one-time-code flows.

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        zeroDEK()
    }

    // MARK: - Unlock flow

    private func showUnlockUI() {
        let authMethod = VaultAccess.availableAuthMethod()
        let unlockView = UnlockView(
            authMethod: authMethod,
            onBiometricUnlock: { [weak self] in self?.handleBiometricUnlock() },
            onPinUnlock: { [weak self] pin in self?.handlePinUnlock(pin: pin) },
            onPasswordUnlock: { [weak self] password in self?.handlePasswordUnlock(password: password) },
            onCancel: { [weak self] in self?.cancelAndDismiss() }
        )
        let hostingController = UIHostingController(rootView: unlockView)
        presentChildViewController(hostingController)
    }

    private func handleBiometricUnlock() {
        guard let dek = VaultAccess.unlockWithBiometric() else {
            // Biometric failed, fall back to PIN or master password
            let fallback = KeychainHelper.read(key: KeychainHelper.pinDataKey) != nil
                ? VaultAccess.AuthMethod.pin
                : VaultAccess.AuthMethod.masterPassword
            showUnlockUIWithMethod(fallback)
            return
        }
        self.dek = dek
        showCredentialList()
    }

    private func handlePinUnlock(pin: String) {
        // Read PIN data from shared Keychain
        guard let pinDataRaw = KeychainHelper.read(key: KeychainHelper.pinDataKey),
              let pinJson = try? JSONSerialization.jsonObject(with: pinDataRaw) as? [String: String],
              let wrappedDEKBase64 = pinJson["wrappedDEK"],
              let saltBase64 = pinJson["salt"],
              let wrappedDEK = Data(base64Encoded: wrappedDEKBase64),
              let salt = Data(base64Encoded: saltBase64) else {
            showUnsupportedAlert("PIN data is corrupted. Please reconfigure PIN in the main app.")
            return
        }

        // Check remaining attempts
        let attemptsRemaining = readPinAttempts() ?? 5
        if attemptsRemaining <= 0 {
            KeychainHelper.delete(key: KeychainHelper.pinDataKey)
            deletePinAttempts()
            showUnsupportedAlert(
                "Too many failed PIN attempts. Please unlock with the main app and re-enable PIN."
            )
            return
        }

        // Derive KEK from PIN via Argon2id (mobile preset, p=1)
        let crypto = CryptoBridge()
        let params = PinPreset.argon2Params
        let kek: Data
        do {
            kek = try crypto.deriveKEK(password: pin, salt: salt, params: params)
        } catch {
            showUnsupportedAlert("Key derivation failed: \(error.localizedDescription)")
            return
        }

        // Attempt to unwrap DEK
        do {
            let unwrappedDEK = try crypto.unwrapDEK(wrappedDEK, kek: kek)
            savePinAttempts(5) // Reset on success
            self.dek = unwrappedDEK
            // Best-effort KEK zeroing. Due to Swift's copy-on-write semantics,
            // `var mutableKek = kek` creates a copy — resetBytes zeros the copy,
            // not the original. The original becomes unreachable and will be
            // reclaimed by ARC, but is not deterministically zeroed.
            // Phase 3 should adopt UnsafeMutableRawBufferPointer for guaranteed zeroing.
            var mutableKek = kek
            mutableKek.resetBytes(in: 0..<mutableKek.count)
            dismissChildViewControllers()
            showCredentialList()
        } catch {
            let remaining = attemptsRemaining - 1
            savePinAttempts(remaining)
            // Best-effort KEK zeroing. Due to Swift's copy-on-write semantics,
            // `var mutableKek = kek` creates a copy — resetBytes zeros the copy,
            // not the original. The original becomes unreachable and will be
            // reclaimed by ARC, but is not deterministically zeroed.
            // Phase 3 should adopt UnsafeMutableRawBufferPointer for guaranteed zeroing.
            var mutableKek = kek
            mutableKek.resetBytes(in: 0..<mutableKek.count)

            if remaining <= 0 {
                KeychainHelper.delete(key: KeychainHelper.pinDataKey)
                deletePinAttempts()
                showUnsupportedAlert(
                    "Too many failed PIN attempts. PIN has been disabled. "
                    + "Please unlock with the main app."
                )
            } else {
                showPinError(
                    "Wrong PIN. \(remaining) attempt\(remaining == 1 ? "" : "s") remaining."
                )
            }
        }
    }

    private func handlePasswordUnlock(password: String) {
        // TODO: Implement master password KDF when Argon2 is linked
        showUnsupportedAlert("Master password unlock is not yet available in autofill. Please enable biometric unlock in the main app.")
    }

    private func showUnlockUIWithMethod(_ method: VaultAccess.AuthMethod) {
        dismissChildViewControllers()
        let unlockView = UnlockView(
            authMethod: method,
            onBiometricUnlock: { [weak self] in self?.handleBiometricUnlock() },
            onPinUnlock: { [weak self] pin in self?.handlePinUnlock(pin: pin) },
            onPasswordUnlock: { [weak self] password in self?.handlePasswordUnlock(password: password) },
            onCancel: { [weak self] in self?.cancelAndDismiss() }
        )
        let hostingController = UIHostingController(rootView: unlockView)
        presentChildViewController(hostingController)
    }

    // MARK: - Credential list flow

    private func showCredentialList() {
        guard let dek = self.dek else { return }

        let domain = currentServiceIdentifiers.first.map { identifier -> String? in
            if identifier.type == .domain {
                return identifier.identifier
            }
            return nil
        } ?? nil

        let appIdentifier = currentServiceIdentifiers.first.map { identifier -> String? in
            if identifier.type == .URL {
                return identifier.identifier
            }
            return nil
        } ?? nil

        let credentials = VaultAccess.findCredentials(
            appIdentifier: appIdentifier,
            domain: domain,
            dek: dek
        )

        dismissChildViewControllers()

        switch requestKind {
        case .password:
            let listView = CredentialListView(
                credentials: credentials,
                serviceIdentifiers: currentServiceIdentifiers,
                onSelect: { [weak self] cred in self?.selectCredential(cred) },
                onSearch: { [weak self] in self?.openSearchInApp() },
                onCreate: { [weak self] in
                    self?.requestCreateCredential(domain: domain, appIdentifier: appIdentifier)
                },
                onCancel: { [weak self] in self?.cancelAndDismiss() }
            )
            let hostingController = UIHostingController(rootView: listView)
            presentChildViewController(hostingController)
        case .oneTimeCode:
            let totpCredentials = credentials.filter { $0.totp != nil && !($0.totp!.isEmpty) }
            let listView = OneTimeCodeListView(
                credentials: totpCredentials,
                onSelect: { [weak self] cred in self?.selectCredential(cred) },
                onCancel: { [weak self] in self?.cancelAndDismiss() }
            )
            let hostingController = UIHostingController(rootView: listView)
            presentChildViewController(hostingController)
        }
    }

    private func selectCredential(_ credential: VaultAccess.MatchedCredential) {
        switch requestKind {
        case .password:
            let passwordCredential = ASPasswordCredential(
                user: credential.username,
                password: credential.password
            )
            extensionContext.completeRequest(withSelectedCredential: passwordCredential, completionHandler: nil)
        case .oneTimeCode:
            guard let uri = credential.totp,
                  let params = try? OtpAuthParser.parse(uri),
                  let code = try? TotpEngine.generateTotpCode(params) else {
                showUnsupportedAlert("Could not derive a TOTP code for this credential.")
                return
            }
            let oneTimeCredential = ASOneTimeCodeCredential(code: code)
            extensionContext.completeOneTimeCodeRequest(
                using: oneTimeCredential,
                completionHandler: nil
            )
        }
    }

    private func openSearchInApp() {
        // TODO: Implement full vault search within the extension
        cancelAndDismiss()
    }

    private func requestCreateCredential(domain: String?, appIdentifier: String?) {
        let defaults = UserDefaults(suiteName: "group.com.keykeykey.shared")
        var pendingCreate: [String: String] = [:]
        if let domain = domain { pendingCreate["domain"] = domain }
        if let appIdentifier = appIdentifier { pendingCreate["appIdentifier"] = appIdentifier }
        defaults?.set(pendingCreate, forKey: "pending_create_credential")
        defaults?.synchronize()

        let alert = UIAlertController(
            title: "Open KeyKeyKey",
            message: "Please open KeyKeyKey to create a new credential for this app.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
            self?.cancelAndDismiss()
        })
        present(alert, animated: true)
    }

    // MARK: - Helpers

    private func cancelAndDismiss() {
        zeroDEK()
        extensionContext.cancelRequest(
            withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.userCanceled.rawValue
            )
        )
    }

    private func zeroDEK() {
        // Best-effort DEK zeroing. Swift's Data is a value type with copy-on-write
        // semantics, so resetBytes may not zero all copies of the backing buffer.
        // For Phase 1 this is acceptable since the extension process terminates
        // shortly after use, reclaiming all memory. Phase 2 should consider using
        // UnsafeMutableRawBufferPointer for guaranteed zeroing.
        self.dek?.resetBytes(in: 0..<(self.dek?.count ?? 0))
        self.dek = nil
    }

    private func showUnsupportedAlert(_ message: String) {
        let alert = UIAlertController(
            title: "Not Available",
            message: message,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
            self?.cancelAndDismiss()
        })
        present(alert, animated: true)
    }

    private func presentChildViewController(_ child: UIViewController) {
        addChild(child)
        child.view.frame = view.bounds
        child.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(child.view)
        child.didMove(toParent: self)
    }

    private func dismissChildViewControllers() {
        for child in children {
            child.willMove(toParent: nil)
            child.view.removeFromSuperview()
            child.removeFromParent()
        }
    }

    // MARK: - PIN attempts

    private static let pinAttemptsKey = "pin_attempts"

    private func readPinAttempts() -> Int? {
        guard let data = KeychainHelper.read(key: Self.pinAttemptsKey),
              let str = String(data: data, encoding: .utf8),
              let value = Int(str) else { return nil }
        return value
    }

    private func savePinAttempts(_ remaining: Int) {
        if let data = String(remaining).data(using: .utf8) {
            _ = KeychainHelper.write(key: Self.pinAttemptsKey, data: data)
        }
    }

    private func deletePinAttempts() {
        KeychainHelper.delete(key: Self.pinAttemptsKey)
    }

    // MARK: - PIN error UI

    private func showPinError(_ message: String) {
        let alert = UIAlertController(
            title: "Incorrect PIN",
            message: message,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Try Again", style: .default) { [weak self] _ in
            self?.dismissChildViewControllers()
            self?.showUnlockUIWithMethod(.pin)
        })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.cancelAndDismiss()
        })
        present(alert, animated: true)
    }
}
