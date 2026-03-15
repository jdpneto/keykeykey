import AuthenticationServices
import SwiftUI
import UIKit

class CredentialProviderViewController: ASCredentialProviderViewController {

    private var dek: Data?
    private var currentServiceIdentifiers: [ASCredentialServiceIdentifier] = []

    // MARK: - ASCredentialProviderViewController overrides

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        currentServiceIdentifiers = serviceIdentifiers
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
        showUnlockUI()
    }

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
        // TODO: Implement PIN-based DEK derivation when crypto is linked
        // For now, cancel with error
        cancelAndDismiss()
    }

    private func handlePasswordUnlock(password: String) {
        // TODO: Implement master password KDF when Argon2 is linked
        // For now, cancel with error
        cancelAndDismiss()
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
    }

    private func selectCredential(_ credential: VaultAccess.MatchedCredential) {
        let passwordCredential = ASPasswordCredential(
            user: credential.username,
            password: credential.password
        )
        extensionContext.completeRequest(withSelectedCredential: passwordCredential, completionHandler: nil)
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
        // Zero the backing buffer directly on the property (Data is a value type,
        // so copying to a local var would only zero the copy)
        self.dek?.resetBytes(in: 0..<(self.dek?.count ?? 0))
        self.dek = nil
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
}
