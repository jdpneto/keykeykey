import Foundation

/// Normalizes a credential URL or query host to a lowercase ASCII hostname
/// suitable for PSL lookup or exact-host comparison. Strips scheme, userinfo,
/// port, and path; prepends `https://` for bare hostnames (because
/// `URL(string:)` returns nil-host for schemeless inputs like
/// "example.com/path"); applies Punycode encoding for IDN hostnames.
///
/// Returns nil if the input is empty, unparseable, or has no host.
func normalizedHost(from input: String) -> String? {
    var s = input.trimmingCharacters(in: .whitespaces)
    if s.isEmpty { return nil }
    if !s.contains("://") { s = "https://" + s }
    guard let url = URL(string: s) else { return nil }
    guard let host = url.host, !host.isEmpty else { return nil }
    // URL.host already strips userinfo and port. Punycode-normalize IDN hosts
    // via URLComponents.percentEncodedHost — on Swift/Foundation this yields
    // the ASCII/Punycode form on every iOS version we support.
    var comps = URLComponents()
    comps.host = host
    let punycoded = comps.percentEncodedHost ?? host
    return punycoded.lowercased()
}

/// Returns true iff `credentialURL` and `queryDomain` resolve to the same
/// registrable domain via the vendored Public Suffix List. Falls back to
/// exact-host equality for IPs, localhost, and any host where no registrable
/// domain applies (e.g. the host IS a public suffix).
///
/// Must match the semantics of packages/core/src/domain/domain-utils.ts
/// `matchCredentialsByDomain` — validated by the shared fixture at
/// packages/core/src/domain/__fixtures__/domain-match.json.
func matchesByDomain(credentialURL: String?, queryDomain: String) -> Bool {
    guard let credentialURL = credentialURL else { return false }
    guard let credHost = normalizedHost(from: credentialURL),
          let queryHost = normalizedHost(from: queryDomain) else { return false }

    // Exact hostname match always wins (covers IPs, localhost, and cases
    // where the PSL lookup returns nil because the host IS a public suffix).
    if credHost == queryHost { return true }

    // PSL-aware registrable-domain equality.
    let psl = PublicSuffixList.shared
    if let credReg = psl.registrableDomain(for: credHost),
       let queryReg = psl.registrableDomain(for: queryHost),
       credReg == queryReg {
        return true
    }
    return false
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
