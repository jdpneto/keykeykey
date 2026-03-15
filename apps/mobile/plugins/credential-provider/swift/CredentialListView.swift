import SwiftUI
import AuthenticationServices

struct CredentialListView: View {
    let credentials: [VaultAccess.MatchedCredential]
    let serviceIdentifiers: [ASCredentialServiceIdentifier]
    let onSelect: (VaultAccess.MatchedCredential) -> Void
    let onSearch: () -> Void
    let onCreate: () -> Void
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
            Section(header: Text("Matching Credentials")) {
                ForEach(credentials, id: \.id) { cred in
                    Button(action: { onSelect(cred) }) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(cred.name).font(.headline).foregroundColor(.primary)
                            Text(cred.username).font(.subheadline).foregroundColor(.secondary)
                        }.padding(.vertical, 4)
                    }
                }
            }
            Section {
                Button(action: onSearch) { Label("Search vault", systemImage: "magnifyingglass") }
                Button(action: onCreate) { Label("Create new credential", systemImage: "plus") }
            }
        }
    }

    private var noMatchView: some View {
        VStack(spacing: 20) {
            Image(systemName: "key.slash").font(.system(size: 48)).foregroundColor(.secondary)
            Text("No matching credentials found").font(.headline)
            Text("Search your vault or create a new credential")
                .font(.subheadline).foregroundColor(.secondary).multilineTextAlignment(.center)
            VStack(spacing: 12) {
                Button(action: onSearch) {
                    Label("Search vault", systemImage: "magnifyingglass").frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent)
                Button(action: onCreate) {
                    Label("Create new credential", systemImage: "plus").frame(maxWidth: .infinity)
                }.buttonStyle(.bordered)
            }.padding(.horizontal, 40)
        }.padding()
    }
}
