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

/// Returns true if any element of `credential` contains `query` (case-insensitive).
func matchesByAppIdentifier(credential: [String], query: String) -> Bool {
    let lowercasedQuery = query.lowercased()
    return credential.contains { $0.lowercased().contains(lowercasedQuery) }
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
