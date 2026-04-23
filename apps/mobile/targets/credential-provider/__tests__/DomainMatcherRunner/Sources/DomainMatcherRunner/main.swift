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

// Walk upward from CWD until we find a repo file at `relPath`. Used to locate
// both the fixture JSON and the PSL data file.
func locateInRepo(_ relPath: String) -> URL? {
    let fm = FileManager.default
    var dir = URL(fileURLWithPath: fm.currentDirectoryPath)
    for _ in 0..<10 {
        let candidate = dir.appendingPathComponent(relPath)
        if fm.fileExists(atPath: candidate.path) { return candidate }
        dir.deleteLastPathComponent()
    }
    return nil
}

// First arg wins; else walk upward from CWD.
let fixtureURL: URL = {
    if CommandLine.arguments.count >= 2 {
        return URL(fileURLWithPath: CommandLine.arguments[1])
    }
    if let url = locateInRepo("packages/core/src/domain/__fixtures__/domain-match.json") {
        return url
    }
    fputs("error: could not locate domain-match.json — pass path as arg\n", stderr)
    exit(2)
}()

// Point PublicSuffixList at the repo-local PSL data file (source of truth).
// Without this the loader falls back to exact-host equality only and every
// eTLD case fails.
if let pslURL = locateInRepo("apps/mobile/targets/credential-provider/public_suffix_list.dat") {
    setenv("KKK_PSL_PATH", pslURL.path, 1)
} else {
    fputs("error: could not locate public_suffix_list.dat in repo tree\n", stderr)
    exit(2)
}
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
