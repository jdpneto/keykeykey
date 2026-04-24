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

- Symlinks `DomainMatcher.swift` and `PublicSuffixList.swift` from the appex target.
- Locates the PSL data file + fixture JSON at runtime by walking upward from CWD until it finds the repo-local paths. `KKK_PSL_PATH` env var is set before the matcher runs; `PublicSuffixList.ensureLoaded()` picks it up via its test-runner fallback branch. The appex production build never has this env var set, so the branch is dead code there.
- No file duplication: the PSL data file exists once, at `apps/mobile/targets/credential-provider/public_suffix_list.dat`.

## When to run

- Automatically via the `iOS DomainMatcher Fixture` workflow on every PR that touches matcher source, PSL, fixture, or runner code.
- Locally when you change any of the above.
