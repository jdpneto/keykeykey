import Foundation

/// Extracts the registrable domain (last two hostname segments) from a URL string.
/// For example, `login.github.com` → `github.com`.
/// Returns nil if the URL is invalid or the hostname has fewer than two segments.
func extractRegistrableDomain(_ urlString: String) -> String? {
    guard let url = URL(string: urlString),
          let host = url.host else {
        return nil
    }

    let lowercasedHost = host.lowercased()
    let components = lowercasedHost.split(separator: ".", omittingEmptySubsequences: true)

    guard components.count >= 2 else {
        return nil
    }

    let registrable = components.suffix(2).joined(separator: ".")
    return registrable
}

/// Returns true if any element of `credential` equals `query` (case-insensitive).
///
/// Rule: exact bundle-ID equality. App Extensions and App Clips do NOT cross-match
/// their parent app — their bundle IDs are distinct (e.g. `com.apple.mobilesafari`
/// vs `com.apple.mobilesafari.PasswordAutoFill`). Users who want a credential to
/// surface in both must save an entry for each bundle ID explicitly. This is the
/// safe trade for a credential manager: parent-app cross-matching would let a
/// rogue app extension request the parent app's credentials.
///
/// Case-insensitive because bundle IDs are ASCII-only and Apple's convention is
/// lowercase, but some older apps shipped mixed-case.
func matchesByAppIdentifier(credential: [String], query: String) -> Bool {
    let lowerQuery = query.lowercased()
    return credential.contains { $0.lowercased() == lowerQuery }
}

/// Returns true if the registrable domain extracted from `credentialURL` matches
/// the registrable domain extracted from `queryDomain` (treated as a bare domain or URL).
func matchesByDomain(credentialURL: String?, queryDomain: String) -> Bool {
    guard let credentialURL = credentialURL else {
        return false
    }

    // Allow queryDomain to be passed as either a bare hostname or a full URL.
    let normalizedQuery = queryDomain.contains("://") ? queryDomain : "https://\(queryDomain)"

    guard let credDomain = extractRegistrableDomain(credentialURL),
          let qDomain = extractRegistrableDomain(normalizedQuery) else {
        return false
    }

    return credDomain == qDomain
}
