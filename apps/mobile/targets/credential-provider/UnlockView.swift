import SwiftUI

struct UnlockView: View {
    let authMethod: VaultAccess.AuthMethod
    let onBiometricUnlock: () -> Void
    let onPinUnlock: (String) -> Void
    let onPasswordUnlock: (String) -> Void
    let onCancel: () -> Void
    /// True when both PIN and master-password data are on disk and reachable
    /// from the extension. When `authMethod` is `.biometric` we surface the
    /// corresponding fallback link so the user can escape a broken Face ID
    /// (mirror of the Android AuthActivity flow).
    var hasPinFallback: Bool = false
    var hasPasswordFallback: Bool = false

    @State private var pin = ""
    @State private var password = ""
    @State private var error = ""
    @State private var isLoading = false
    /// Active auth shape — may differ from `authMethod` after the user taps a
    /// fallback link. Starts at `authMethod`.
    @State private var activeMethod: VaultAccess.AuthMethod? = nil

    private enum Field: Hashable { case pin, password }
    @FocusState private var focusedField: Field?

    private var resolvedMethod: VaultAccess.AuthMethod {
        activeMethod ?? authMethod
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 48))
                    .foregroundColor(.accentColor)
                Text("KeyKeyKey").font(.title2.bold())

                switch resolvedMethod {
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
                // A primary-action Unlock button in the nav bar for PIN /
                // password modes. Putting it in the toolbar gives it a hit
                // target outside the SecureField's hierarchy — tapping it
                // won't be intercepted by the field's text-edit menu
                // (observed SwiftUI behaviour on iOS 26 where a nearby
                // Button inside the SecureField's VStack re-focuses the
                // field instead of firing).
                ToolbarItem(placement: .primaryAction) {
                    switch resolvedMethod {
                    case .pin:
                        Button("Unlock") {
                            focusedField = nil
                            if pin.count >= 4 { onPinUnlock(pin) }
                        }
                        .disabled(pin.count < 4 || isLoading)
                    case .masterPassword:
                        Button("Unlock") {
                            focusedField = nil
                            isLoading = true
                            onPasswordUnlock(password)
                        }
                        .disabled(password.isEmpty || isLoading)
                    case .biometric:
                        EmptyView()
                    }
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

            // Fallback links so Face ID is never a dead-end. Parity with the
            // Android AuthActivity which offers a PIN/password path alongside
            // biometric. Only surfaced when the corresponding credential is
            // available to the extension. Each button gets a generous hit
            // target via `.buttonStyle(.bordered)` + vertical padding so taps
            // don't leak into the adjacent Face ID button.
            if hasPinFallback {
                Button("Use PIN instead") { activeMethod = .pin }
                    .buttonStyle(.bordered)
                    .controlSize(.regular)
                    .padding(.top, 8)
            }
            if hasPasswordFallback {
                Button("Use master password instead") { activeMethod = .masterPassword }
                    .buttonStyle(.bordered)
                    .controlSize(.regular)
            }
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
                .focused($focusedField, equals: .pin)
                .toolbar {
                    // Number-pad keyboard has no Return key, so we add a
                    // keyboard toolbar Done button that submits the PIN.
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("Done") {
                            focusedField = nil
                            if pin.count >= 4 { onPinUnlock(pin) }
                        }
                        .disabled(pin.count < 4)
                    }
                }
                // Auto-submit when the PIN hits exactly 4 digits — mirrors
                // the iOS lock-screen UX. A SwiftUI SecureField eats taps
                // inside its sibling VStack (its selection menu intercepts
                // anything within its parent's bounds), so relying on the
                // Unlock button alone was unreliable. KeyKeyKey PINs are
                // fixed at 4 digits so this doesn't cut off longer PINs.
                .onChange(of: pin) { _, newValue in
                    if newValue.count == 4 {
                        focusedField = nil
                        onPinUnlock(newValue)
                    }
                }
            Button("Unlock") {
                focusedField = nil
                onPinUnlock(pin)
            }
            .buttonStyle(.borderedProminent)
            .disabled(pin.count < 4)
            .padding(.top, 8)
        }
        .onAppear { focusedField = .pin }
    }

    private var passwordView: some View {
        VStack(spacing: 16) {
            Text("Enter your master password").font(.subheadline).foregroundColor(.secondary)
            SecureField("Master Password", text: $password)
                .textFieldStyle(.roundedBorder).frame(maxWidth: 300)
                .focused($focusedField, equals: .password)
                .submitLabel(.go)
                .onSubmit {
                    focusedField = nil
                    if !password.isEmpty && !isLoading {
                        isLoading = true
                        onPasswordUnlock(password)
                    }
                }
            Button("Unlock") {
                focusedField = nil
                isLoading = true
                onPasswordUnlock(password)
            }
            .buttonStyle(.borderedProminent)
            .disabled(password.isEmpty || isLoading)
            .padding(.top, 8)
            if isLoading { ProgressView("Deriving encryption key...").font(.footnote) }
        }
        .onAppear { focusedField = .password }
    }
}
