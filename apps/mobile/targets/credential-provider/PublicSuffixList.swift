import Foundation

/// Mozilla Public Suffix List parser + lookup for the credential-provider appex.
///
/// Loads `public_suffix_list.dat` from the appex bundle on first access, builds a
/// reverse-label trie, and exposes `registrableDomain(for:)` — the eTLD+1 the
/// matcher uses to decide whether two URLs belong to the same site.
///
/// The PSL has three rule shapes:
/// - Normal rule: `co.uk` — matches suffixes with exactly these labels
/// - Wildcard rule: `*.ck` — matches any single label + `.ck`
/// - Exception rule: `!www.ck` — overrides a wildcard; `www.ck` is NOT a public
///   suffix even though `*.ck` says it would be
///
/// Algorithm (per https://publicsuffix.org/list/):
/// 1. Lowercase the host, split on dots.
/// 2. Find the prevailing rule: longest non-exception rule matching the host's
///    right-hand labels, with exceptions taking priority.
/// 3. The public suffix is the labels named by the prevailing rule.
/// 4. The registrable domain is the public suffix plus ONE more label to the
///    left. If the host has no extra label, there's no registrable domain.
///
/// If no rule matches, the PSL convention is a default `*` rule — the public
/// suffix is the rightmost label only.
final class PublicSuffixList {
    static let shared = PublicSuffixList()

    /// Trie node. Children keyed by label (read right-to-left — the root's children
    /// are TLD labels like "uk", "com").
    private final class Node {
        var children: [String: Node] = [:]
        /// True if a rule terminates here (this labelset IS a public suffix).
        var isRule = false
        /// True if this rule is an exception (`!foo.bar`). Exceptions remove their
        /// matched labels from the public suffix — the public suffix is one label
        /// shorter than the matched rule.
        var isException = false
        /// True if this rule is a wildcard — `*.labels` matches any single label
        /// at this trie position.
        var isWildcard = false
    }

    private let root = Node()
    private var loaded = false
    private let loadLock = NSLock()

    private init() {}

    /// Load the PSL from the appex bundle. Idempotent. First call costs ~15ms
    /// on a modern iPhone; subsequent calls are no-ops.
    private func ensureLoaded() {
        loadLock.lock()
        defer { loadLock.unlock() }
        if loaded { return }

        let bundle = Bundle(for: Self.self)
        var url = bundle.url(forResource: "public_suffix_list", withExtension: "dat")
        // Test-runner fallback: the standalone SPM runner at
        // __tests__/DomainMatcherRunner sets KKK_PSL_PATH to the source-tree
        // path so we avoid duplicating the ~460KB data file. The appex
        // production build leaves the env var unset, so this branch is
        // effectively dead code outside of tests.
        if url == nil, let envPath = ProcessInfo.processInfo.environment["KKK_PSL_PATH"] {
            url = URL(fileURLWithPath: envPath)
        }
        guard let pslURL = url else {
            NSLog("[PSL] public_suffix_list.dat missing from bundle; falling back to exact-host matching")
            loaded = true
            return
        }

        guard let data = try? String(contentsOf: pslURL, encoding: .utf8) else {
            NSLog("[PSL] could not read PSL data")
            loaded = true
            return
        }

        for rawLine in data.split(separator: "\n", omittingEmptySubsequences: false) {
            // Trim whitespace. Treat first whitespace-delimited field as the rule
            // (PSL spec says anything after the first whitespace is a comment).
            let trimmed = rawLine.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            if trimmed.hasPrefix("//") { continue }
            let rule = trimmed.split(separator: " ").first.map(String.init) ?? trimmed
            if rule.isEmpty { continue }
            insert(rule: rule)
        }
        loaded = true
    }

    private func insert(rule: String) {
        var ruleLabels = rule
        let isException = ruleLabels.hasPrefix("!")
        if isException { ruleLabels.removeFirst() }

        // Trie is indexed right-to-left: reverse the labels.
        let labels = ruleLabels.split(separator: ".").map(String.init).reversed()
        var node = root
        for label in labels {
            if label == "*" {
                // Wildcard must be the leftmost label in the original rule — it
                // lives as a marker on the current node rather than a child.
                node.isWildcard = true
            } else {
                if let child = node.children[label] {
                    node = child
                } else {
                    let n = Node()
                    node.children[label] = n
                    node = n
                }
            }
        }
        node.isRule = true
        node.isException = isException
    }

    /// Returns the public suffix (eTLD) for `host`, e.g. "co.uk" for "bob.co.uk".
    /// Returns nil if the host has no labels.
    func effectiveTLD(for host: String) -> String? {
        ensureLoaded()
        let labels = host.lowercased().split(separator: ".").map(String.init)
        guard !labels.isEmpty else { return nil }

        // Walk the trie right-to-left. Track the deepest rule match and the
        // deepest exception match.
        var node = root
        var longestMatchDepth = 0
        var exceptionMatchDepth = 0
        var depth = 0

        for label in labels.reversed() {
            if let child = node.children[label] {
                node = child
                depth += 1
                if node.isRule {
                    if node.isException {
                        exceptionMatchDepth = depth
                    } else {
                        longestMatchDepth = depth
                    }
                }
            } else if node.isWildcard {
                // Wildcard consumes one more label.
                depth += 1
                longestMatchDepth = depth
                break
            } else {
                break
            }
        }

        // Exceptions win: the eTLD is one label shorter than the exception rule.
        let matchDepth: Int
        if exceptionMatchDepth > 0 {
            matchDepth = exceptionMatchDepth - 1
        } else if longestMatchDepth > 0 {
            matchDepth = longestMatchDepth
        } else {
            // Default rule — the eTLD is the rightmost label.
            matchDepth = 1
        }

        guard matchDepth > 0, matchDepth <= labels.count else { return nil }
        return labels.suffix(matchDepth).joined(separator: ".")
    }

    /// Returns the registrable domain (eTLD+1) for `host`, e.g. "bob.co.uk" for
    /// "login.bob.co.uk". Returns nil if the host IS the public suffix (e.g.
    /// "co.uk" itself) or has no labels.
    func registrableDomain(for host: String) -> String? {
        guard let etld = effectiveTLD(for: host) else { return nil }
        let hostLower = host.lowercased()
        guard hostLower != etld else { return nil }
        let labels = hostLower.split(separator: ".").map(String.init)
        let etldLabels = etld.split(separator: ".").count
        guard labels.count > etldLabels else { return nil }
        return labels.suffix(etldLabels + 1).joined(separator: ".")
    }
}
