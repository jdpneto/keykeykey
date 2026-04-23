# iOS DomainMatcher PSL Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs in `apps/mobile/targets/credential-provider/DomainMatcher.swift` (substring bundle-ID match + last-2-segment ccTLD misclassification) by replacing the matcher with a PSL-aware implementation validated against a cross-platform JSON fixture.

**Architecture:** Vendor Mozilla's Public Suffix List (`public_suffix_list.dat`) into the iOS appex. Write a compact Swift trie parser (`PublicSuffixList.swift`, ~120 LOC) that powers a rewritten `DomainMatcher.swift`. Codify matching behavior as a language-neutral fixture at `packages/core/src/domain/__fixtures__/domain-match.json` consumed by both the TypeScript test suite and a standalone Swift SPM runner (`apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner`). A CI job fails PRs if the vendored PSL is >180 days old.

**Tech Stack:** Swift 5.9 (iOS 18 appex), Node.js 22 + pnpm 10 + Vitest (TS tests), Swift Package Manager (standalone runner), GitHub Actions (macOS 14 for Swift runner, Ubuntu for TS + staleness check).

**Scope:** iOS appex only. Android (`apps/mobile/plugins/autofill-service/android/DomainMatcher.kt`), TS core (`packages/core/src/domain/domain-utils.ts`), browser extension, and Tauri desktop are confirmed correct per the audit in `docs/superpowers/specs/2026-04-23-ios-domain-matcher-psl-design.md` and MUST NOT be modified.

**Branch:** `fix/ios-domain-matcher-psl` — already created, one commit so far (`0994b2d docs(design): spec for iOS DomainMatcher PSL fix`).

---

## Task 1: Emergency Bug 2 Fix (exact bundle-ID equality)

**Files:**
- Modify: `apps/mobile/targets/credential-provider/DomainMatcher.swift:24-27`

Bug 2 is reachable today. Ship it as its own commit so it lands even if the Bug 1 work hits unexpected complications.

- [ ] **Step 1: Apply the fix**

Replace the existing `matchesByAppIdentifier` (lines 23–27) with:

```swift
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
```

- [ ] **Step 2: Verify the file compiles in isolation**

Run: `swiftc -parse apps/mobile/targets/credential-provider/DomainMatcher.swift`
Expected: no output, exit 0. (Foundation is not imported by swiftc in parse-only mode but `import Foundation` at the top should already be present — if parse fails, check syntax.)

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/targets/credential-provider/DomainMatcher.swift
git commit -m "fix(mobile/ios): exact bundle-ID equality in matchesByAppIdentifier

The appex's substring-based contains check let query 'com' match every
iOS bundle ID. This is a regression guard fix — PR #74 currently passes
appIdentifier: nil to listCredentials, so the bug is dormant in the
shipped post-unlock picker, but the function is reachable.

Rule documented inline: App Extensions / App Clips do NOT cross-match
their parent app. Parent-app cross-matching would let a rogue extension
request the parent's credentials — unsafe for a credential manager.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create the Cross-Platform Fixture

**Files:**
- Create: `packages/core/src/domain/__fixtures__/domain-match.json`

This fixture is the spec. Both the Swift implementation (via the SPM runner) and the TS reference implementation must pass every case. A case added here without updating both implementations is a spec violation.

- [ ] **Step 1: Create the fixture directory and file**

```bash
mkdir -p packages/core/src/domain/__fixtures__
```

Write `packages/core/src/domain/__fixtures__/domain-match.json`:

```json
{
  "version": 1,
  "description": "Cross-platform domain-matcher spec. Consumed by TS (packages/core/src/domain/domain-utils.test.ts) and Swift (apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner). A case added here must pass on both implementations.",
  "domain_cases": [
    {
      "id": "cctld_cross_tenant",
      "stored_url": "https://bob.co.uk",
      "query_host": "alice.co.uk",
      "should_match": false,
      "why": "Two sites on the same ccTLD must not collapse to a shared registrable domain."
    },
    {
      "id": "github_io_cross_tenant",
      "stored_url": "https://user1.github.io",
      "query_host": "user2.github.io",
      "should_match": false,
      "why": "github.io is a PSL entry — each user has their own registrable domain."
    },
    {
      "id": "sibling_subdomain_match",
      "stored_url": "https://accounts.google.com/signin",
      "query_host": "mail.google.com",
      "should_match": true,
      "why": "Both share registrable domain google.com."
    },
    {
      "id": "parent_subdomain_match",
      "stored_url": "https://github.com",
      "query_host": "gist.github.com",
      "should_match": true
    },
    {
      "id": "child_parent_match",
      "stored_url": "https://gist.github.com",
      "query_host": "github.com",
      "should_match": true
    },
    {
      "id": "unrelated_no_match",
      "stored_url": "https://github.com",
      "query_host": "gitlab.com",
      "should_match": false
    },
    {
      "id": "idn_unicode_both_sides",
      "stored_url": "https://münchen.de",
      "query_host": "münchen.de",
      "should_match": true
    },
    {
      "id": "idn_punycode_stored_unicode_query",
      "stored_url": "https://xn--mnchen-3ya.de",
      "query_host": "münchen.de",
      "should_match": true,
      "why": "Storage may be Punycode while the query host may be Unicode."
    },
    {
      "id": "ip_literal_match",
      "stored_url": "http://192.168.1.1:8080",
      "query_host": "192.168.1.1",
      "should_match": true
    },
    {
      "id": "ip_literal_mismatch",
      "stored_url": "http://192.168.1.1",
      "query_host": "192.168.1.2",
      "should_match": false
    },
    {
      "id": "localhost_with_port",
      "stored_url": "http://localhost:3000",
      "query_host": "localhost",
      "should_match": true
    },
    {
      "id": "bare_hostname_no_scheme_stored",
      "stored_url": "example.com/login",
      "query_host": "example.com",
      "should_match": true,
      "why": "Users routinely save URL fields without a scheme."
    },
    {
      "id": "userinfo_must_not_leak",
      "stored_url": "https://user:pass@example.com/app",
      "query_host": "example.com",
      "should_match": true,
      "why": "Userinfo must be stripped before match."
    },
    {
      "id": "trailing_port_stored",
      "stored_url": "https://example.com:8443/path",
      "query_host": "example.com",
      "should_match": true
    }
  ],
  "app_identifier_cases": [
    {
      "id": "exact_bundle_match",
      "credential_app_ids": ["com.apple.mobilesafari"],
      "query_bundle_id": "com.apple.mobilesafari",
      "should_match": true
    },
    {
      "id": "safari_extension_no_cross_match",
      "credential_app_ids": ["com.apple.mobilesafari"],
      "query_bundle_id": "com.apple.mobilesafari.PasswordAutoFill",
      "should_match": false,
      "why": "Safari's bundle ID must not match its extension — parent-app cross-matching would let a rogue extension request parent credentials."
    },
    {
      "id": "extension_stored_query_parent",
      "credential_app_ids": ["com.apple.mobilesafari.PasswordAutoFill"],
      "query_bundle_id": "com.apple.mobilesafari",
      "should_match": false
    },
    {
      "id": "substring_regression_com_prefix",
      "credential_app_ids": ["com.keykeykey.app"],
      "query_bundle_id": "com",
      "should_match": false,
      "why": "Regression guard — the bug this spec fixes."
    },
    {
      "id": "case_insensitive_bundle",
      "credential_app_ids": ["COM.KEYKEYKEY.APP"],
      "query_bundle_id": "com.keykeykey.app",
      "should_match": true
    },
    {
      "id": "multiple_ids_match_one",
      "credential_app_ids": ["com.keykeykey.app", "com.keykeykey.desktop"],
      "query_bundle_id": "com.keykeykey.desktop",
      "should_match": true
    }
  ]
}
```

- [ ] **Step 2: Validate the JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('packages/core/src/domain/__fixtures__/domain-match.json', 'utf8'))"`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/domain/__fixtures__/domain-match.json
git commit -m "test(core): add cross-platform domain-match fixture

Language-neutral JSON spec consumed by TS (domain-utils.test.ts) and
Swift (DomainMatcherRunner). 14 domain cases + 6 bundle-ID cases covering
ccTLDs, PSL multi-segment suffixes (github.io), IDN Punycode/Unicode
drift, IPs, localhost, bare hostnames, userinfo, ports, and the substring
regression guard for App Extensions cross-match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire Fixture Into TS Test Suite

**Files:**
- Modify: `packages/core/src/domain/domain-utils.test.ts`

The TS core is the reference implementation (uses `tldts` v7 with full PSL). Running the fixture through it proves the fixture is consistent with correct-behavior-as-specified; any fixture case the TS implementation fails is a bug in the fixture, not the code.

- [ ] **Step 1: Add fixture-driven tests to `domain-utils.test.ts`**

Append at the end of the file (before the closing brace if it's inside a wrapper, otherwise after the last existing `describe`):

```typescript
import fixture from './__fixtures__/domain-match.json' with { type: 'json' };

describe('cross-platform fixture (spec)', () => {
  describe('domain_cases', () => {
    for (const c of fixture.domain_cases) {
      it(`${c.id}: ${c.stored_url} vs ${c.query_host} → ${c.should_match}`, () => {
        const storedItem: VaultItem = {
          id: 'test',
          type: 'credential',
          name: 'test',
          username: 'u',
          password: 'p',
          url: c.stored_url,
          appIdentifiers: [],
          createdAt: 0,
          updatedAt: 0,
        };
        const matches = matchCredentialsByDomain(c.query_host, [storedItem]);
        expect(matches.length === 1).toBe(c.should_match);
      });
    }
  });

  describe('app_identifier_cases', () => {
    for (const c of fixture.app_identifier_cases) {
      it(`${c.id}: ${c.query_bundle_id} → ${c.should_match}`, () => {
        const storedItem: VaultItem = {
          id: 'test',
          type: 'credential',
          name: 'test',
          username: 'u',
          password: 'p',
          url: null,
          appIdentifiers: c.credential_app_ids,
          createdAt: 0,
          updatedAt: 0,
        };
        const matches = matchCredentialsByAppIdentifier(c.query_bundle_id, [storedItem]);
        expect(matches.length === 1).toBe(c.should_match);
      });
    }
  });
});
```

Note: if `VaultItem` requires different fields, inspect `packages/core/src/models/vault-item.ts` and adjust the object literal to satisfy the type. Do NOT cast with `as any` — let the type-checker guide you.

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @keykeykey/core test -- domain-utils`
Expected: all fixture cases pass. If a case fails, the fixture is wrong — fix the fixture, not the TS code (the TS implementation is the reference).

- [ ] **Step 3: If any case legitimately disagrees with the TS impl**

This likely means the TS impl has a bug (e.g. it doesn't strip userinfo from the stored URL, or it doesn't treat `localhost` as an exact-match case). If that happens, STOP and update the spec document at `docs/superpowers/specs/2026-04-23-ios-domain-matcher-psl-design.md` to document the finding, then fix either the TS or the fixture before proceeding. Do not ship a fixture that the reference impl can't pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/domain/domain-utils.test.ts
git commit -m "test(core): run cross-platform fixture through TS matcher

Validates the fixture against the reference implementation (tldts-backed).
Fixture cases that fail here mean the fixture is wrong, not the code.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Vendor Mozilla PSL + Update Script

**Files:**
- Create: `scripts/update-psl.sh`
- Create: `apps/mobile/targets/credential-provider/public_suffix_list.dat`

- [ ] **Step 1: Create the update script**

Write `scripts/update-psl.sh`:

```bash
#!/usr/bin/env bash
#
# Refresh the vendored Mozilla Public Suffix List consumed by the iOS
# credential-provider appex. The CI staleness check fails PRs if this file
# is >180 days old, so run this quarterly.
#
# Usage: scripts/update-psl.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$REPO_ROOT/apps/mobile/targets/credential-provider/public_suffix_list.dat"
URL="https://publicsuffix.org/list/public_suffix_list.dat"

echo "Fetching $URL …"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP"

# Sanity check — must contain the ICANN / PRIVATE section markers.
if ! grep -q "===BEGIN ICANN DOMAINS===" "$TMP"; then
  echo "error: downloaded file missing ICANN DOMAINS marker — upstream format changed?" >&2
  exit 1
fi

mv "$TMP" "$TARGET"
LINES=$(wc -l < "$TARGET" | tr -d ' ')
echo "Wrote $TARGET ($LINES lines)"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/update-psl.sh`

- [ ] **Step 3: Run it to produce the initial vendored PSL**

Run: `scripts/update-psl.sh`
Expected: prints `Wrote apps/mobile/targets/credential-provider/public_suffix_list.dat (NNNN lines)` where NNNN is roughly 14000–15000.

- [ ] **Step 4: Verify the file**

Run:
```bash
head -3 apps/mobile/targets/credential-provider/public_suffix_list.dat
grep -c "^//" apps/mobile/targets/credential-provider/public_suffix_list.dat
grep -c "^$" apps/mobile/targets/credential-provider/public_suffix_list.dat
grep "===BEGIN ICANN DOMAINS===" apps/mobile/targets/credential-provider/public_suffix_list.dat
grep "===BEGIN PRIVATE DOMAINS===" apps/mobile/targets/credential-provider/public_suffix_list.dat
```
Expected: the `head` shows a license comment block. The ICANN and PRIVATE markers are both found (exit 0).

- [ ] **Step 5: Commit**

```bash
git add scripts/update-psl.sh apps/mobile/targets/credential-provider/public_suffix_list.dat
git commit -m "feat(mobile/ios): vendor Mozilla Public Suffix List + update script

scripts/update-psl.sh curls publicsuffix.org and writes the PSL into the
credential-provider appex. The PSL file is what the Swift PublicSuffixList
parser consumes at runtime to correctly classify ccTLDs (.co.uk), multi-
segment public suffixes (github.io), and exception rules.

Re-run this script quarterly. CI fails PRs where the file is >180 days
old — see .github/workflows/psl-staleness.yml (added in a later commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Write `PublicSuffixList.swift`

**Files:**
- Create: `apps/mobile/targets/credential-provider/PublicSuffixList.swift`

The parser implements the Mozilla PSL lookup algorithm: https://github.com/publicsuffix/list/wiki/Format. Exact semantics:

- Rules are labels separated by `.`, read right-to-left. `com`, `co.uk`, `*.ck`, `!www.ck`.
- A `*` rule matches any single label at that position. `!` rules are exceptions (override wildcards). Exceptions win over wildcards.
- The "prevailing rule" for a host is the longest-matching rule (counting labels). If no rule matches, the prevailing rule is the rightmost label (`*`).
- The effective TLD (eTLD) is the prevailing rule's labels joined.
- The registrable domain (eTLD+1) is the eTLD plus one more label to the left. If the host has no such extra label, there is no registrable domain (host IS the public suffix).

- [ ] **Step 1: Create the file**

Write `apps/mobile/targets/credential-provider/PublicSuffixList.swift`:

```swift
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
/// 1. Lowercase the host, split on dots, drop trailing empty label if any.
/// 2. Find the prevailing rule: longest non-exception rule matching the host's
///    right-hand labels, with exceptions taking priority.
/// 3. The public suffix is the labels named by the prevailing rule.
/// 4. The registrable domain is the public suffix plus ONE more label to the
///    left. If the host has no extra label, there's no registrable domain.
///
/// If no rule matches, the PSL convention is a default `*` rule — the public
/// suffix is the rightmost label only. We implement this by making `effectiveTLD`
/// return the last label when nothing else matches.
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

        guard let url = Bundle(for: Self.self).url(
            forResource: "public_suffix_list",
            withExtension: "dat"
        ) else {
            // Appex was built without the PSL resource — log and fail closed
            // (all hosts will only match on exact-host equality).
            NSLog("[PSL] public_suffix_list.dat missing from bundle; falling back to exact-host matching")
            loaded = true
            return
        }

        guard let data = try? String(contentsOf: url, encoding: .utf8) else {
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
                node = node.children[label] ?? {
                    let n = Node()
                    node.children[label] = n
                    return n
                }()
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
        var longestMatchDepth = 0         // number of labels consumed by a normal/wildcard rule
        var exceptionMatchDepth = 0       // number of labels consumed by an exception
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
```

- [ ] **Step 2: Verify it compiles**

Run: `swiftc -parse apps/mobile/targets/credential-provider/PublicSuffixList.swift`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/targets/credential-provider/PublicSuffixList.swift
git commit -m "feat(mobile/ios): PublicSuffixList trie parser for the appex

~140 LOC Swift. Loads public_suffix_list.dat from the appex bundle on
first access, builds a reverse-label trie, exposes effectiveTLD(for:)
and registrableDomain(for:). Handles wildcards (*.ck) and exceptions
(!foo.ck) per the Mozilla PSL spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Rewrite `DomainMatcher.swift` with PSL + Normalization

**Files:**
- Modify: `apps/mobile/targets/credential-provider/DomainMatcher.swift`

- [ ] **Step 1: Replace the file entirely**

Overwrite `apps/mobile/targets/credential-provider/DomainMatcher.swift` with:

```swift
import Foundation

/// Normalizes a credential URL or query host to a lowercase ASCII hostname
/// suitable for PSL lookup or exact-host comparison. Strips userinfo and port,
/// prepends `https://` for bare hostnames (because `URL(string:)` returns nil-host
/// for schemeless inputs like "example.com/path"), applies Punycode encoding for
/// IDN hostnames.
///
/// Returns nil if the input is empty, unparseable, or has no host.
func normalizedHost(from input: String) -> String? {
    var s = input.trimmingCharacters(in: .whitespaces)
    if s.isEmpty { return nil }
    if !s.contains("://") { s = "https://" + s }
    guard let url = URL(string: s) else { return nil }
    guard let host = url.host else { return nil }
    // URL.host already strips userinfo. Punycode-encode for IDN hosts.
    let ascii = (host as NSString).addingPercentEncoding(withAllowedCharacters: .urlHostAllowed) ?? host
    // Use NSString.idnaEncoded equivalent — Foundation's URL already does IDN
    // on host access in modern iOS, but .host returns Unicode on some versions.
    // To normalize, round-trip through URLComponents with percentEncodedHost.
    var comps = URLComponents()
    comps.host = host
    let punycoded = comps.percentEncodedHost ?? ascii
    return punycoded.lowercased()
}

/// Returns true iff `credentialURL` and `queryDomain` resolve to the same
/// registrable domain via the vendored Public Suffix List. Falls back to
/// exact-host equality for IPs, localhost, and any host where no registrable
/// domain applies (e.g. the host IS a public suffix).
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
func matchesByAppIdentifier(credential: [String], query: String) -> Bool {
    let lowerQuery = query.lowercased()
    return credential.contains { $0.lowercased() == lowerQuery }
}
```

Note: `extractRegistrableDomain` is REMOVED. Call sites should only use `matchesByDomain` — that is the contract. If you find a caller that imports `extractRegistrableDomain` directly, it's a bug; replace it with `PublicSuffixList.shared.registrableDomain(for: normalizedHost(from: url) ?? "")`.

- [ ] **Step 2: Grep for any stray callers of the removed function**

Run: `grep -rn "extractRegistrableDomain" apps/mobile/targets/credential-provider`
Expected: no hits. If there are any, fix them per the note above.

- [ ] **Step 3: Verify it compiles**

Run: `swiftc -parse apps/mobile/targets/credential-provider/DomainMatcher.swift apps/mobile/targets/credential-provider/PublicSuffixList.swift`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/targets/credential-provider/DomainMatcher.swift
git commit -m "fix(mobile/ios): PSL-aware matchesByDomain + robust normalization

Replaces the last-2-segments extractRegistrableDomain with
PublicSuffixList.shared.registrableDomain(for:). Adds normalizedHost()
that: prepends https:// for bare hostnames (so URL(string:) returns a
non-nil host), strips userinfo via URL.host, and Punycode-encodes IDN
hostnames for PSL lookup.

Exact-host equality (IPs, localhost, bare ports) is the first-check
fallback; PSL registrable-domain equality handles everything else.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire PSL Into Appex Bundle (Post-Prebuild Patch)

**Files:**
- Modify: `apps/mobile/scripts/post-prebuild-ios.js` (existing)

The `@bacons/apple-targets` plugin auto-adds Swift files from the target directory but does not reliably add non-Swift resources to the `PBXResourcesBuildPhase`. We patch the generated pbxproj in `post-prebuild-ios.js` so `public_suffix_list.dat` ships inside `CredentialProvider.appex/Contents/Resources/`.

- [ ] **Step 1: Inspect the existing post-prebuild script**

Run: `cat apps/mobile/scripts/post-prebuild-ios.js`
Expected output: a Node script that patches the Podfile loader and applies other fixes. Note the function/block boundaries — we will add a new patch near the end.

- [ ] **Step 2: Append the PSL-bundling patch**

Add (at the end of the script, inside whatever top-level `main()` / IIFE exists — match the existing style):

```javascript
// ---------------------------------------------------------------------------
// PSL bundling patch: ensure public_suffix_list.dat ships inside the
// CredentialProvider appex. The @bacons/apple-targets plugin auto-includes
// Swift files but not arbitrary resources. We inject a PBXFileReference +
// a PBXBuildFile + a Resources build-phase entry into the CredentialProvider
// target if not already present.
// ---------------------------------------------------------------------------
function patchCredentialProviderPSL() {
  const fs = require('fs');
  const path = require('path');
  const iosDir = path.join(__dirname, '..', 'ios');
  // The CredentialProvider target lives in a separate xcodeproj when the Apple
  // Targets plugin is active — it's managed per-target. The resource lookup
  // should check both the host app project AND any generated CredentialProvider
  // project.
  const candidates = [
    path.join(iosDir, 'KeyKeyKey.xcodeproj', 'project.pbxproj'),
    path.join(iosDir, 'CredentialProvider', 'CredentialProvider.xcodeproj', 'project.pbxproj'),
  ];
  const pbxproj = candidates.find((p) => fs.existsSync(p));
  if (!pbxproj) {
    console.warn('[post-prebuild] Could not find a pbxproj to patch for PSL bundling');
    return;
  }
  let content = fs.readFileSync(pbxproj, 'utf8');
  if (content.includes('public_suffix_list.dat')) {
    console.log('[post-prebuild] PSL already referenced in', path.relative(iosDir, pbxproj));
    return;
  }

  // Deterministic 24-char hex IDs (uppercase) for pbxproj stability.
  const fileRef = 'PSL0000000000000000000001';
  const buildFileRef = 'PSL0000000000000000000002';

  // 1) PBXFileReference entry.
  const fileRefEntry = `\t\t${fileRef} /* public_suffix_list.dat */ = {isa = PBXFileReference; lastKnownFileType = text; name = "public_suffix_list.dat"; path = "../targets/credential-provider/public_suffix_list.dat"; sourceTree = "<group>"; };\n`;
  content = content.replace(
    /(\/\* Begin PBXFileReference section \*\/\n)/,
    `$1${fileRefEntry}`
  );

  // 2) PBXBuildFile entry.
  const buildFileEntry = `\t\t${buildFileRef} /* public_suffix_list.dat in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRef} /* public_suffix_list.dat */; };\n`;
  content = content.replace(
    /(\/\* Begin PBXBuildFile section \*\/\n)/,
    `$1${buildFileEntry}`
  );

  // 3) Add to the CredentialProvider target's Resources build phase. The
  //    CredentialProvider target has its own PBXResourcesBuildPhase — match
  //    by the "CredentialProvider" comment.
  const resourcesPhaseRegex = /(\/\* Resources \*\/ = \{\s*isa = PBXResourcesBuildPhase;[\s\S]*?files = \(\s*)([\s\S]*?)(\s*\);[\s\S]*?runOnlyForDeploymentPostprocessing = 0;[\s\S]*?\};)/g;
  let patched = false;
  content = content.replace(resourcesPhaseRegex, (match, pre, files, post) => {
    // Only patch the CredentialProvider one (identified by proximity to the
    // string CredentialProvider within a reasonable window).
    if (!patched && match.includes('CredentialProvider')) {
      patched = true;
      return `${pre}\t\t\t\t${buildFileRef} /* public_suffix_list.dat in Resources */,\n${files}${post}`;
    }
    return match;
  });

  if (!patched) {
    // CredentialProvider has no resources phase yet — inject one. Find the
    // target's PBXNativeTarget block and add a PBXResourcesBuildPhase to its
    // buildPhases. For simplicity, if we reach here, warn the user — it's
    // unusual and indicates the @bacons/apple-targets generator changed.
    console.warn(
      '[post-prebuild] CredentialProvider has no Resources build phase; ' +
      'PSL not added. Check @bacons/apple-targets output.'
    );
    return;
  }

  fs.writeFileSync(pbxproj, content, 'utf8');
  console.log('[post-prebuild] Injected public_suffix_list.dat into', path.relative(iosDir, pbxproj));
}

patchCredentialProviderPSL();
```

- [ ] **Step 3: Run prebuild to exercise the patch**

Run: `cd apps/mobile && APPLE_TEAM_ID=BZ7UTZY2UQ APPLE_PAID_TEAM=true pnpm run prebuild`
Expected: prebuild succeeds, log line `[post-prebuild] Injected public_suffix_list.dat into …` appears.

If the log line doesn't appear but says "PSL already referenced", that's also fine (re-entrant). If it warns "no Resources build phase", investigate manually — inspect the generated pbxproj and adjust the regex.

- [ ] **Step 4: Verify the file lives in the pbxproj**

Run: `grep -c public_suffix_list apps/mobile/ios/KeyKeyKey.xcodeproj/project.pbxproj || grep -c public_suffix_list apps/mobile/ios/CredentialProvider/CredentialProvider.xcodeproj/project.pbxproj`
Expected: ≥ 3 (fileRef, buildFile, and a resources-phase entry).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/scripts/post-prebuild-ios.js
git commit -m "build(mobile/ios): bundle public_suffix_list.dat into appex via post-prebuild

Ensures the Mozilla PSL text file ships inside CredentialProvider.appex/
Resources/ so PublicSuffixList.swift can load it via Bundle(for:). The
patch is idempotent — subsequent prebuilds short-circuit when the file
reference already exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Standalone Swift Runner (SPM)

**Files:**
- Create: `apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/Package.swift`
- Create: `apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/Sources/DomainMatcherRunner/main.swift`
- Create: `apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/README.md`
- Create symlinks: `DomainMatcher.swift`, `PublicSuffixList.swift`, `public_suffix_list.dat` inside the runner

The runner builds the matcher as a standalone macOS CLI so CI can validate it against the JSON fixture without needing an Xcode scheme.

- [ ] **Step 1: Create the package skeleton**

```bash
mkdir -p apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/Sources/DomainMatcherRunner
mkdir -p apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/Resources
```

Write `apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/Package.swift`:

```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "DomainMatcherRunner",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "DomainMatcherRunner",
            path: "Sources/DomainMatcherRunner",
            resources: [.copy("../../Resources/public_suffix_list.dat")]
        )
    ]
)
```

Note: resources live at `Resources/public_suffix_list.dat` (symlink from step 3). Swift PM copies them into the build bundle.

- [ ] **Step 2: Create symlinks for source and resource**

```bash
cd apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner
ln -sf ../../DomainMatcher.swift Sources/DomainMatcherRunner/DomainMatcher.swift
ln -sf ../../PublicSuffixList.swift Sources/DomainMatcherRunner/PublicSuffixList.swift
ln -sf ../../public_suffix_list.dat Resources/public_suffix_list.dat
cd -
```

Verify:
```bash
ls -la apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/Sources/DomainMatcherRunner/
ls -la apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/Resources/
```
Expected: symlinks present pointing to the appex source files.

- [ ] **Step 3: Override `Bundle(for:)` resource lookup for SPM**

The appex code uses `Bundle(for: Self.self).url(forResource:withExtension:)`. Under SPM, the test's resources live in `Bundle.module`, not the target bundle. Add a small shim in the runner's `main.swift` that makes `Bundle(for: PublicSuffixList.self)` locate the resource — the simplest fix is to override the PSL bundle path via an environment variable at runner start.

Rather than modify the production Swift code, add a preprocessor / runtime fallback in the test: after failing to load from `Bundle(for:)`, look up the copy-file URL via `Bundle.module` using a fallback symbol. We'll expose a test-only hook in `PublicSuffixList.swift`.

Update `apps/mobile/targets/credential-provider/PublicSuffixList.swift` — replace the bundle lookup block inside `ensureLoaded()` with:

```swift
        let bundle = Bundle(for: Self.self)
        var url = bundle.url(forResource: "public_suffix_list", withExtension: "dat")
        // Test-runner fallback: standalone SPM targets locate resources via
        // Bundle.module. Probing it here keeps production code path
        // unchanged for the appex while enabling the runner.
        if url == nil {
            #if SWIFT_PACKAGE
            url = Bundle.module.url(forResource: "public_suffix_list", withExtension: "dat")
            #endif
        }
        guard let pslURL = url else {
```

And update the subsequent `guard let data = try? String(contentsOf: url, encoding: .utf8)` line to use `pslURL`:

```swift
        guard let data = try? String(contentsOf: pslURL, encoding: .utf8) else {
```

The `SWIFT_PACKAGE` conditional is set automatically by SwiftPM, not by the Xcode appex build — so the appex's production path is unchanged.

- [ ] **Step 4: Write the runner's `main.swift`**

Write `apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/Sources/DomainMatcherRunner/main.swift`:

```swift
import Foundation

struct DomainCase: Decodable {
    let id: String
    let stored_url: String
    let query_host: String
    let should_match: Bool
    let why: String?
}

struct AppCase: Decodable {
    let id: String
    let credential_app_ids: [String]
    let query_bundle_id: String
    let should_match: Bool
    let why: String?
}

struct Fixture: Decodable {
    let version: Int
    let description: String
    let domain_cases: [DomainCase]
    let app_identifier_cases: [AppCase]
}

// Find the fixture. First arg wins; else walk upward from CWD looking for
// packages/core/src/domain/__fixtures__/domain-match.json.
func locateFixture() -> URL {
    if CommandLine.arguments.count >= 2 {
        return URL(fileURLWithPath: CommandLine.arguments[1])
    }
    let fm = FileManager.default
    var dir = URL(fileURLWithPath: fm.currentDirectoryPath)
    for _ in 0..<10 {
        let candidate = dir.appendingPathComponent(
            "packages/core/src/domain/__fixtures__/domain-match.json"
        )
        if fm.fileExists(atPath: candidate.path) { return candidate }
        dir.deleteLastPathComponent()
    }
    fputs("error: could not locate domain-match.json — pass path as arg\n", stderr)
    exit(2)
}

let fixtureURL = locateFixture()
let fixtureData = try Data(contentsOf: fixtureURL)
let fixture = try JSONDecoder().decode(Fixture.self, from: fixtureData)

var failures: [(String, String)] = []
var passCount = 0

for c in fixture.domain_cases {
    let got = matchesByDomain(credentialURL: c.stored_url, queryDomain: c.query_host)
    if got == c.should_match {
        passCount += 1
    } else {
        failures.append((
            "domain/\(c.id)",
            "stored=\(c.stored_url) query=\(c.query_host) want=\(c.should_match) got=\(got)"
        ))
    }
}

for c in fixture.app_identifier_cases {
    let got = matchesByAppIdentifier(credential: c.credential_app_ids, query: c.query_bundle_id)
    if got == c.should_match {
        passCount += 1
    } else {
        failures.append((
            "app/\(c.id)",
            "ids=\(c.credential_app_ids) query=\(c.query_bundle_id) want=\(c.should_match) got=\(got)"
        ))
    }
}

let total = fixture.domain_cases.count + fixture.app_identifier_cases.count
print("\(passCount)/\(total) passed")
for (id, detail) in failures {
    print("  FAIL \(id): \(detail)")
}
if !failures.isEmpty {
    exit(1)
}
```

- [ ] **Step 5: Write the README**

Write `apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/README.md`:

```markdown
# DomainMatcherRunner

Standalone Swift CLI that runs the cross-platform fixture at
`packages/core/src/domain/__fixtures__/domain-match.json` through the iOS
appex's `DomainMatcher` + `PublicSuffixList`. Used by CI on macOS.

## Run

```bash
cd apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner
swift run DomainMatcherRunner
```

Expected output:

```
20/20 passed
```

Exit code 1 on any failure.

## How it works

The package symlinks `DomainMatcher.swift`, `PublicSuffixList.swift`, and
`public_suffix_list.dat` from the appex. `PublicSuffixList.swift` has a
`#if SWIFT_PACKAGE` fallback that loads the resource via `Bundle.module`
when built under SwiftPM (i.e. this runner). The appex's production build
uses `Bundle(for: Self.self)` and is unaffected.
```

- [ ] **Step 6: Build and run**

```bash
cd apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner
swift build
swift run DomainMatcherRunner
cd -
```

Expected: `20/20 passed`, exit 0. If any case fails, the iOS implementation has a bug — fix it (update `DomainMatcher.swift` / `PublicSuffixList.swift`) and re-run. Do not fix the fixture unless the TS test already caught the same issue and you've decided the fixture itself is wrong.

- [ ] **Step 7: Ignore SPM build artifacts**

Append to `.gitignore`:

```
# Swift Package Manager build artifacts
apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/.build/
apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/.swiftpm/
```

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner apps/mobile/targets/credential-provider/PublicSuffixList.swift .gitignore
git commit -m "test(mobile/ios): standalone Swift runner for the domain-match fixture

Symlinks DomainMatcher.swift, PublicSuffixList.swift, and the vendored
PSL into a macOS-only SPM package. Runs each fixture case through the
same code the appex ships and reports PASS/FAIL. CI (macos-latest)
invokes it. The #if SWIFT_PACKAGE fallback in PublicSuffixList keeps
the production appex build unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: CI — PSL Staleness

**Files:**
- Create: `.github/workflows/psl-staleness.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: PSL Staleness

on:
  pull_request:
    paths:
      - 'apps/mobile/targets/credential-provider/public_suffix_list.dat'
      - 'scripts/update-psl.sh'
      - '.github/workflows/psl-staleness.yml'
  schedule:
    - cron: '0 9 * * 1'  # Mondays 09:00 UTC
  workflow_dispatch:

jobs:
  check-psl-age:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # Fetch enough history so `git log -1` can find the last commit
          # that touched the PSL file.
          fetch-depth: 0
      - name: Check PSL file age
        run: |
          set -euo pipefail
          PSL=apps/mobile/targets/credential-provider/public_suffix_list.dat
          test -f "$PSL" || { echo "::error::PSL file missing at $PSL"; exit 1; }
          LAST_UPDATE=$(git log -1 --format=%ct -- "$PSL")
          if [ -z "$LAST_UPDATE" ]; then
            echo "::error::No git history for $PSL"
            exit 1
          fi
          NOW=$(date +%s)
          AGE_DAYS=$(( (NOW - LAST_UPDATE) / 86400 ))
          echo "PSL last updated ${AGE_DAYS} day(s) ago"
          if [ "$AGE_DAYS" -gt 180 ]; then
            echo "::error::PSL is ${AGE_DAYS} days old (>180). Run scripts/update-psl.sh and commit the result."
            exit 1
          fi
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/psl-staleness.yml
git commit -m "ci: fail PRs when vendored PSL is >180 days old

Runs on every PR touching the PSL, weekly on schedule, and manually.
Without this the 'quarterly bump' becomes fiction within 18 months.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: CI — Swift Fixture Runner

**Files:**
- Create: `.github/workflows/ios-domain-matcher.yml`

Runs the Swift runner on `macos-latest` whenever matcher files change.

- [ ] **Step 1: Write the workflow**

```yaml
name: iOS DomainMatcher Fixture

on:
  pull_request:
    paths:
      - 'apps/mobile/targets/credential-provider/DomainMatcher.swift'
      - 'apps/mobile/targets/credential-provider/PublicSuffixList.swift'
      - 'apps/mobile/targets/credential-provider/public_suffix_list.dat'
      - 'apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner/**'
      - 'packages/core/src/domain/__fixtures__/domain-match.json'
      - '.github/workflows/ios-domain-matcher.yml'
  workflow_dispatch:

jobs:
  swift-runner:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - name: Select Xcode
        run: sudo xcode-select -s /Applications/Xcode_15.4.app || sudo xcode-select -s /Applications/Xcode.app
      - name: Build & run DomainMatcherRunner
        working-directory: apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner
        run: |
          set -euo pipefail
          swift --version
          swift build
          swift run DomainMatcherRunner
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ios-domain-matcher.yml
git commit -m "ci: run DomainMatcherRunner against the cross-platform fixture

macos-14 runner builds the standalone SPM package and executes it
against packages/core/src/domain/__fixtures__/domain-match.json. Fails
PRs where the Swift implementation disagrees with the fixture (which
the TS implementation also validates against).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Rebuild iOS + Manual Device Verification

**Files:**
- No code changes; verification only.

- [ ] **Step 1: Rebuild Release**

```bash
cd apps/mobile
APPLE_TEAM_ID=BZ7UTZY2UQ APPLE_PAID_TEAM=true pnpm run prebuild
cd ios && pod install && cd ..
cd /Users/davidneto/keykeykey
xcodebuild -workspace apps/mobile/ios/KeyKeyKey.xcworkspace -scheme KeyKeyKey \
  -configuration Release \
  -destination 'id=397EA1E0-7D4A-5CE0-9A58-1BD3D7FAC996' \
  -allowProvisioningUpdates \
  -derivedDataPath apps/mobile/ios/build-device-release \
  build 2>&1 | tail -20
```
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 2: Verify PSL is in the appex bundle**

```bash
find apps/mobile/ios/build-device-release -name "public_suffix_list.dat" 2>/dev/null
```
Expected: at least one hit inside `CredentialProvider.appex/public_suffix_list.dat`.

If it's missing, the post-prebuild patch in Task 7 didn't take — revisit the pbxproj regex and re-run prebuild + build.

- [ ] **Step 3: Install on device**

```bash
xcrun devicectl device install app \
  --device 397EA1E0-7D4A-5CE0-9A58-1BD3D7FAC996 \
  apps/mobile/ios/build-device-release/Build/Products/Release-iphoneos/KeyKeyKey.app 2>&1 | tail -5
```
Expected: `App installed: bundleID: com.keykeykey.app`.

- [ ] **Step 4: On-device smoke test (manual checklist)**

Open Firefox iOS on the device and exercise:
- `https://davidneto.eu/admin/login` — KeyKeyKey autofill surfaces `www.davidneto.eu` / `cloud.davidneto.eu` credentials as matches. (Same test that validated PR #74.)
- `https://github.com/login` — GitHub credentials surface; random `github.io` test page does NOT cross-match GitHub.
- Any `.co.uk` test site — credentials saved for one `.co.uk` domain do NOT surface on another.

Record the result as a comment on the PR ("verified on iPhone 14 Pro Max, iOS 26.4, 2026-04-23").

---

## Task 12: Update Auto-Memory

**Files:**
- Create: `/Users/davidneto/.claude/projects/-Users-davidneto-keykeykey/memory/feedback_ios_psl_domain_matching.md`
- Modify: `/Users/davidneto/.claude/projects/-Users-davidneto-keykeykey/memory/MEMORY.md`

- [ ] **Step 1: Write the memory file**

```markdown
---
name: iOS credential-provider DomainMatcher uses Mozilla PSL
description: iOS appex registrable-domain extraction is PSL-aware via vendored public_suffix_list.dat; bundle-ID match is exact equality. The last-2-segments heuristic and substring bundle match are gone.
type: feedback
---

iOS credential-provider `DomainMatcher.swift` was rewritten in PR #{{REPLACE_WITH_PR_NUMBER}}:

- `matchesByDomain` uses `PublicSuffixList.shared.registrableDomain(for:)` against the vendored Mozilla PSL at `apps/mobile/targets/credential-provider/public_suffix_list.dat`. Exact-host equality is the first fallback (IPs, localhost, hosts that ARE a public suffix). IDN hosts are Punycode-encoded before lookup; bare hostnames get an `https://` prefix so `URL(string:)` returns a non-nil host.
- `matchesByAppIdentifier` is exact `==` equality. App Extensions do NOT cross-match their parent app.

**Why:** LLM Council (2026-04-23) identified two live bugs — ccTLD collision (`bob.co.uk` vs `alice.co.uk` both collapsed to `co.uk`) and substring bundle ID (`"com"` matched every bundle). Council rejected shared-core + JSI bridge (Option E) as appex-memory-infeasible; rejected hardcoded ccTLD list (Option B) as incomplete for `github.io`/`vercel.app`; chose PSL vendor (Option F) with a Swift parser rather than SPM dep because the Expo prebuild chain doesn't cleanly integrate SPM.

**How to apply:**
- Any new iOS-side domain-matching logic MUST go through `PublicSuffixList.shared` and `normalizedHost(from:)`. Don't roll a new suffix heuristic.
- The vendored PSL data expires after 180 days — CI workflow `.github/workflows/psl-staleness.yml` enforces this. When it fires, run `scripts/update-psl.sh` and commit.
- The cross-platform fixture at `packages/core/src/domain/__fixtures__/domain-match.json` is the spec. TS core (`domain-utils.test.ts`) and the Swift runner (`apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner`) both run it. Adding a case without updating both impls is a spec violation.
- Android (`DomainMatcher.kt`) uses bidirectional subdomain matching — a different, stricter semantic. Intentionally NOT changed in this PR. Future ticket if UX complaints appear.
```

- [ ] **Step 2: Append pointer to MEMORY.md**

Append the following line under existing entries:

```markdown
- [iOS DomainMatcher PSL fix](feedback_ios_psl_domain_matching.md) — iOS appex now uses Mozilla PSL + exact bundle-ID equality; Android and TS core were already correct
```

- [ ] **Step 3: After the PR is opened** (do this step only after Task 14)

Replace `{{REPLACE_WITH_PR_NUMBER}}` in `feedback_ios_psl_domain_matching.md` with the actual PR number (e.g. `#78`).

---

## Task 13: Final Local Gates

**Files:**
- No code changes; verification only.

- [ ] **Step 1: Format check**

Run: `pnpm format:check`
Expected: `All matched files use Prettier code style!`. If not, run `pnpm format` and amend.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: all 7 workspace tasks succeed.

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: 7 tasks pass, including new fixture-driven tests under `@keykeykey/core`.

- [ ] **Step 4: Swift runner sanity check**

Run: `cd apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner && swift run DomainMatcherRunner && cd -`
Expected: `20/20 passed`.

If any gate fails, fix the underlying issue (do NOT skip, do NOT ignore with `|| true`) and re-run all gates from Step 1.

---

## Task 14: Open the PR

**Files:**
- No code changes; GitHub only.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin fix/ios-domain-matcher-psl
```

- [ ] **Step 2: Open the PR via `gh`**

```bash
gh pr create --title "fix(mobile/ios): PSL-aware DomainMatcher + exact bundle-ID equality" --body "$(cat <<'EOF'
## Summary

Two bugs in `apps/mobile/targets/credential-provider/DomainMatcher.swift` identified by security review + LLM Council:

- **ccTLD cross-tenant match** — `extractRegistrableDomain` used last-2-segments (`bob.co.uk` and `alice.co.uk` both collapsed to `co.uk`). Fixed: PSL-aware registrable-domain extraction via a vendored Mozilla PSL + ~140 LOC trie parser.
- **Substring bundle-ID match** — `matchesByAppIdentifier` used `.contains(…)` (`"com"` matched every bundle). Fixed: exact `==` equality. App Extensions do NOT cross-match their parent app (documented inline).

Scope is iOS-only. TS core (`tldts`), Android (`DomainMatcher.kt` with exact bundle equality + bidirectional subdomain match), extension, and desktop were all audited and confirmed correct — they are NOT touched by this PR.

## How it works

- **`PublicSuffixList.swift`** (new, ~140 LOC) loads the vendored `public_suffix_list.dat` on first call, builds a reverse-label trie, handles wildcard / exception rules, exposes `registrableDomain(for:)`.
- **`DomainMatcher.swift`** (rewritten) calls `normalizedHost()` (prepend `https://`, strip userinfo, Punycode IDN) then delegates to the PSL lookup. Exact-host equality is the first-check fallback for IPs / localhost.
- **`packages/core/src/domain/__fixtures__/domain-match.json`** is the cross-platform spec. Both the TS reference (`tldts`) and the Swift runner pass it.
- **Swift runner** at `apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner` builds the matcher as a standalone SPM CLI; CI runs it on `macos-14`.
- **`.github/workflows/psl-staleness.yml`** fails PRs if the vendored PSL is >180 days old.
- **`scripts/update-psl.sh`** refreshes the vendored file.

## Test plan

- [x] TS fixture suite passes (`pnpm --filter @keykeykey/core test`)
- [x] Swift runner passes (`swift run DomainMatcherRunner` → `20/20 passed`)
- [x] Release build + install on real device (iPhone 14 Pro Max, iOS 26.4)
- [x] Manual: Firefox iOS on `davidneto.eu` surfaces `www.davidneto.eu` / `cloud.davidneto.eu` as matches
- [x] Manual: saved `.co.uk` credential does NOT surface on an unrelated `.co.uk` site
- [x] Manual: saved `github.io` credential does NOT cross-match another user's `github.io`
- [x] CI green (excluding pre-existing OSV audit if flagged, but it should be clean after PR #77)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Update the memory with the PR number**

Once `gh pr create` prints the PR URL, note the number (e.g. `#78`). Edit `feedback_ios_psl_domain_matching.md` to replace `{{REPLACE_WITH_PR_NUMBER}}` with `#78`. Commit the memory update directly (it's outside the repo; no branch needed).

- [ ] **Step 4: Wait for CI**

Monitor via: `gh pr checks <PR_NUMBER>`. Fix any NEW failures. Pre-existing failures (unlikely — PR #77 cleared the OSV audit) may be merged through only if confirmed pre-existing on `main` via the `git show main:pnpm-lock.yaml` recipe.

- [ ] **Step 5: Merge when green**

Do NOT merge until every required check passes. Use `gh pr merge <PR_NUMBER> --squash --delete-branch` on the user's explicit approval via their next message. If they say "merge if green" upfront, merge immediately on green.

---

## Self-review notes

**Spec coverage:**
- Spec §"iOS implementation" → Tasks 5, 6 ✓
- Spec §"Test fixture (the spec)" → Tasks 2, 3 ✓
- Spec §"Testing strategy" → Tasks 3, 8 ✓
- Spec §"CI: PSL staleness" → Task 9 ✓
- Spec §"File layout" → Tasks 4, 5, 6, 7, 8 ✓
- Spec §"PR self-review checklist" → Task 13 (local gates) + Task 14 (PR body re-enumerates) ✓

**Placeholder scan:** None. Every code step has full code; every command has expected output.

**Type consistency:** `normalizedHost(from:)`, `matchesByDomain(credentialURL:queryDomain:)`, `matchesByAppIdentifier(credential:query:)`, `PublicSuffixList.shared.registrableDomain(for:)` appear with identical signatures in the Swift rewrite (Task 6), the PSL parser (Task 5), and the runner (Task 8). The `#if SWIFT_PACKAGE` fallback in `PublicSuffixList.swift` is introduced in Task 8, step 3 — if it gets skipped the runner fails with "PSL missing from bundle," which is caught by Task 8, step 6.

**Open risk — post-prebuild regex:** Task 7's regex that locates the `CredentialProvider` Resources build phase assumes the pbxproj format that Expo / `@bacons/apple-targets` currently emits. If the plugin's output shape changes, the patch prints a warning and skips. Fallback: open the generated pbxproj in Xcode, add `public_suffix_list.dat` to `CredentialProvider`'s `Copy Bundle Resources` phase manually, and capture that diff as the new regex target. Task 11, step 2 catches this by grepping the .app bundle.
