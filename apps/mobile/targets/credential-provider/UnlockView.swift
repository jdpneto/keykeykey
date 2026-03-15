import SwiftUI

struct UnlockView: View {
    let authMethod: VaultAccess.AuthMethod
    let onBiometricUnlock: () -> Void
    let onPinUnlock: (String) -> Void
    let onPasswordUnlock: (String) -> Void
    let onCancel: () -> Void

    @State private var pin = ""
    @State private var password = ""
    @State private var error = ""
    @State private var isLoading = false

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 48))
                    .foregroundColor(.accentColor)
                Text("KeyKeyKey").font(.title2.bold())

                switch authMethod {
                case .biometric: biometricView
                case .pin: pinView
                case .masterPassword: passwordView
                }

                if !error.isEmpty {
                    Text(error).font(.footnote).foregroundColor(.red)
                }
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
            }
        }
    }

    private var biometricView: some View {
        VStack(spacing: 16) {
            Text("Authenticate to autofill").font(.subheadline).foregroundColor(.secondary)
            Button(action: onBiometricUnlock) {
                Label("Unlock with Face ID", systemImage: "faceid").frame(maxWidth: .infinity)
            }.buttonStyle(.borderedProminent).padding(.horizontal, 40)
        }
    }

    private var pinView: some View {
        VStack(spacing: 16) {
            Text("Enter your PIN").font(.subheadline).foregroundColor(.secondary)
            SecureField("PIN", text: $pin)
                .keyboardType(.numberPad)
                .frame(maxWidth: 200)
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.center)
            Button("Unlock") { onPinUnlock(pin) }
                .buttonStyle(.borderedProminent).disabled(pin.count < 4)
        }
    }

    private var passwordView: some View {
        VStack(spacing: 16) {
            Text("Enter your master password").font(.subheadline).foregroundColor(.secondary)
            SecureField("Master Password", text: $password)
                .textFieldStyle(.roundedBorder).frame(maxWidth: 300)
            Button("Unlock") { isLoading = true; onPasswordUnlock(password) }
                .buttonStyle(.borderedProminent).disabled(password.isEmpty || isLoading)
            if isLoading { ProgressView("Deriving encryption key...").font(.footnote) }
        }
    }
}
