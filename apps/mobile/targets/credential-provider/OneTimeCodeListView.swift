import SwiftUI
import AuthenticationServices

/// Picker shown for `prepareOneTimeCodeCredentialList(for:)`.
/// Lists every credential matching the requesting service that carries a
/// `totp` field, with a live preview of the current code.
struct OneTimeCodeListView: View {
    let credentials: [VaultAccess.MatchedCredential]
    let onSelect: (VaultAccess.MatchedCredential) -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationView {
            Group {
                if credentials.isEmpty { noMatchView } else { matchListView }
            }
            .navigationTitle("KeyKeyKey")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
            }
        }
    }

    private var matchListView: some View {
        List {
            Section(header: Text("2FA Codes")) {
                ForEach(credentials, id: \.id) { cred in
                    Button(action: { onSelect(cred) }) {
                        OtpRow(credential: cred)
                    }
                }
            }
        }
    }

    private var noMatchView: some View {
        VStack(spacing: 20) {
            Image(systemName: "shield.slash")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("No 2FA codes found").font(.headline)
            Text("Open KeyKeyKey to add a TOTP secret to a credential.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

/// Renders one row showing the credential name, account, the live 6-digit
/// code, and a countdown. Uses a 1-second timer so the displayed code stays
/// in sync with the period boundary while the picker is open.
private struct OtpRow: View {
    let credential: VaultAccess.MatchedCredential
    @State private var now = Date()

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(credential.name).font(.headline).foregroundColor(.primary)
                if !credential.username.isEmpty {
                    Text(credential.username).font(.subheadline).foregroundColor(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(formattedCode)
                    .font(.system(.title3, design: .monospaced))
                    .foregroundColor(remainingSeconds <= 5 ? .red : .primary)
                Text("\(remainingSeconds)s")
                    .font(.caption)
                    .foregroundColor(remainingSeconds <= 5 ? .red : .secondary)
            }
        }
        .padding(.vertical, 4)
        .onReceive(timer) { now = $0 }
    }

    private var params: TotpParams? {
        guard let uri = credential.totp else { return nil }
        return try? OtpAuthParser.parse(uri)
    }

    private var formattedCode: String {
        guard let p = params, let code = try? TotpEngine.generateTotpCode(p, at: now) else {
            return "------"
        }
        let mid = code.count / 2
        let i = code.index(code.startIndex, offsetBy: mid)
        return "\(code[..<i]) \(code[i...])"
    }

    private var remainingSeconds: Int {
        guard let p = params else { return 0 }
        return TotpEngine.remainingSeconds(period: p.period, at: now)
    }
}
