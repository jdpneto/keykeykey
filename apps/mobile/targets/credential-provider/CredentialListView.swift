import SwiftUI
import AuthenticationServices

/// Post-unlock credential picker. Matches the Android flow (AutofillPicker.kt):
///
/// - Screen 1 (matches): shown immediately after unlock. Lists only credentials
///   matching the requesting service. "Search all credentials" and "Create new"
///   buttons sit below the list so the user can escape to the full vault or add
///   a new entry. When there are no matches the list area shows a neutral
///   empty-state instead of silently finishing.
/// - Screen 2 (search): opens from the matches screen. Full vault search — the
///   list starts empty with a prompt to type a query. We deliberately do NOT
///   dump the whole vault by default; the user asked for explicit search, not
///   a password dump.
struct CredentialListView: View {
    let credentials: [VaultAccess.MatchedCredential]
    let serviceIdentifiers: [ASCredentialServiceIdentifier]
    let onSelect: (VaultAccess.MatchedCredential) -> Void
    let onCreate: () -> Void
    let onCancel: () -> Void

    private enum Mode {
        case matches
        case search
    }

    @State private var mode: Mode = .matches
    @State private var query: String = ""

    private var matches: [VaultAccess.MatchedCredential] {
        credentials.filter { $0.isMatch }
    }

    private var siteLabel: String {
        guard let first = serviceIdentifiers.first else { return "this site" }
        if first.type == .domain {
            return first.identifier
        }
        // Full URL — extract the host for a friendlier label.
        if let host = URL(string: first.identifier)?.host, !host.isEmpty {
            return host
        }
        return first.identifier
    }

    private func matchesQuery(_ cred: VaultAccess.MatchedCredential) -> Bool {
        let trimmed = query.trimmingCharacters(in: .whitespaces).lowercased()
        if trimmed.isEmpty { return false }
        if cred.name.lowercased().contains(trimmed) { return true }
        if cred.username.lowercased().contains(trimmed) { return true }
        if let url = cred.url, url.lowercased().contains(trimmed) { return true }
        return false
    }

    private var searchResults: [VaultAccess.MatchedCredential] {
        credentials.filter(matchesQuery)
    }

    var body: some View {
        NavigationView {
            Group {
                if credentials.isEmpty {
                    emptyVaultView
                } else {
                    matchesView
                }
            }
            .navigationTitle("Passwords for \(siteLabel)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
            }
        }
    }

    private var navigationTitle: String {
        switch mode {
        case .matches: return "Passwords for \(siteLabel)"
        case .search: return "Search all credentials"
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        switch mode {
        case .matches:
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel)
            }
        case .search:
            ToolbarItem(placement: .cancellationAction) {
                Button("Back") {
                    query = ""
                    mode = .matches
                }
            }
        }
    }

    // MARK: - Matches screen

    private var matchesView: some View {
        // Single-screen picker with an always-visible search bar. When the
        // query is empty we show matches for the requesting service (with a
        // gentle empty-state when there are none); once the user types, the
        // list filters across the whole vault. A pinned Create button at the
        // bottom handles the new-credential flow. This avoids relying on a
        // two-mode Button/NavigationLink transition that SwiftUI wouldn't
        // fire reliably inside the credential-provider extension.
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let isSearching = !trimmed.isEmpty
        let filtered = isSearching ? credentials.filter(matchesQuery) : matches
        return VStack(spacing: 0) {
            List {
                if !isSearching && filtered.isEmpty {
                    Text("No saved passwords for \(siteLabel).")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .padding(.vertical, 24)
                        .listRowBackground(Color.clear)
                    Text("Start typing above to search your full vault (\(credentials.count)).")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .listRowBackground(Color.clear)
                } else if isSearching && filtered.isEmpty {
                    Text("No credentials matching \"\(query)\".")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .padding(.vertical, 24)
                        .listRowBackground(Color.clear)
                } else {
                    Section(header: Text(isSearching ? "Search results" : "Matching this site")) {
                        ForEach(filtered, id: \.id) { cred in
                            credentialRow(cred)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search all credentials"
            )

            Button(action: onCreate) {
                Label("Create new for \(siteLabel)", systemImage: "plus")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding()
        }
    }

    // MARK: - Search screen

    private var searchView: some View {
        List {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                Text("Start typing to search your credentials.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, 24)
                    .listRowBackground(Color.clear)
            } else if searchResults.isEmpty {
                Text("No credentials matching \"\(query)\".")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, 24)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(searchResults, id: \.id) { cred in
                    credentialRow(cred)
                }
            }
        }
        .listStyle(.insetGrouped)
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Search name, username, URL"
        )
        .navigationTitle("Search all credentials")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Shared row

    private func credentialRow(_ cred: VaultAccess.MatchedCredential) -> some View {
        Button(action: { onSelect(cred) }) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if cred.isMatch {
                        Image(systemName: "star.fill")
                            .font(.caption)
                            .foregroundColor(.yellow)
                    }
                    Text(cred.name)
                        .font(.headline)
                        .foregroundColor(.primary)
                }
                if !cred.username.isEmpty {
                    Text(cred.username)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                if let url = cred.url, !url.isEmpty {
                    Text(url)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: - Empty vault

    private var emptyVaultView: some View {
        VStack(spacing: 20) {
            Image(systemName: "key.slash")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("Your vault is empty")
                .font(.headline)
            Text("Create your first credential to use autofill.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            Button(action: onCreate) {
                Label("Create new credential", systemImage: "plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 40)
        }
        .padding()
    }
}

// MARK: - Previews

#if DEBUG
private let previewCredentials: [VaultAccess.MatchedCredential] = [
    VaultAccess.MatchedCredential(
        id: "1", name: "davidneto.eu", username: "admin",
        password: "p", url: "https://www.davidneto.eu/admin/login",
        appIdentifiers: [], totp: nil, isMatch: true
    ),
    VaultAccess.MatchedCredential(
        id: "2", name: "cloud.davidneto.eu", username: "david",
        password: "p", url: "https://cloud.davidneto.eu",
        appIdentifiers: [], totp: nil, isMatch: true
    ),
    VaultAccess.MatchedCredential(
        id: "3", name: "1password", username: "jdpneto@gmail.com",
        password: "p", url: "https://1password.com",
        appIdentifiers: [], totp: nil, isMatch: false
    ),
    VaultAccess.MatchedCredential(
        id: "4", name: "9gag.com", username: "jdpneto@gmail.com",
        password: "p", url: "https://9gag.com",
        appIdentifiers: [], totp: nil, isMatch: false
    ),
    VaultAccess.MatchedCredential(
        id: "5", name: "github.com", username: "dneto",
        password: "p", url: "https://github.com",
        appIdentifiers: [], totp: nil, isMatch: false
    ),
]

private let previewDomainIdentifier = ASCredentialServiceIdentifier(
    identifier: "davidneto.eu", type: .domain
)

private let previewNoMatchIdentifier = ASCredentialServiceIdentifier(
    identifier: "unknownsite.example", type: .domain
)

#Preview("Matches — with results") {
    CredentialListView(
        credentials: previewCredentials,
        serviceIdentifiers: [previewDomainIdentifier],
        onSelect: { _ in }, onCreate: {}, onCancel: {}
    )
}

#Preview("Matches — empty") {
    CredentialListView(
        credentials: previewCredentials,
        serviceIdentifiers: [previewNoMatchIdentifier],
        onSelect: { _ in }, onCreate: {}, onCancel: {}
    )
}

#Preview("Empty vault") {
    CredentialListView(
        credentials: [],
        serviceIdentifiers: [previewDomainIdentifier],
        onSelect: { _ in }, onCreate: {}, onCancel: {}
    )
}
#endif
