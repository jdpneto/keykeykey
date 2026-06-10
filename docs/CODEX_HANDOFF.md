# CODEX_HANDOFF

Snapshot for the next coding agent picking up this repo.

- **Date written:** 2026-04-30 (UTC evening, post-CI-green on `main`)
- **Author of handoff:** Claude Code session — read-only investigation; no application code changed
- **Repo:** `keykeykey` (cross-platform credential manager — TS core + Tauri desktop + Expo mobile + MV3 extension)
- **Working tree root:** `/Users/davidneto/keykeykey`

---

## 1. Current Objective

**There is no in-flight feature.** The repo is at a clean post-burst state: a 4-day cluster of small refactors and infra fixes has just landed. CI is green on `main`, no open PRs, no open issues, no feature branch checked out.

The next agent's job is to **pick the next item from the backlog in `IMPLEMENTATION_STATUS.md` §4**, not to continue prior work. Recommended candidates (priority order, see §6 below for the why):

1. Fix the GitHub Actions Node.js 20 deprecation (soft deadline 2026-09-16).
2. Add `apple-app-site-association` hosting decision (low effort, unblocks iOS auto-domain-match autofill).
3. Tackle Windows Hello biometric (mirrors the macOS Touch ID work that just shipped — pickable only on Windows hardware).
4. Wire `cargo test` for `apps/desktop/src-tauri` into CI (testing-debt; spec'd but not running).

If the user has named a specific objective, defer to that — the above is only the "if no instructions" fallback.

---

## 2. Branch and Git Status

```
On branch main
Your branch is up to date with 'origin/main'.
HEAD: 8591db4 build(deps): bump rustls-webpki from 0.103.10 to 0.103.13 in apps/desktop/src-tauri (#94)
```

No staged or modified files. **Untracked files** (broken into three buckets so the next agent knows which to clean up vs. keep):

### 2a. Stray Expo prebuild output at the wrong path (likely accidental)

These look like the result of running `npx expo prebuild` from the repo root instead of from `apps/mobile/`. The `apps/mobile/android/` and `apps/mobile/ios/` paths are gitignored; the root-level versions are not.

- `android/` — full Android prebuild tree (gradle, gradlew, app/, etc.)
- `app.json` — `{ "android": { "package": "com.anonymous.keykeykey" } }` (the _real_ app config is `apps/mobile/app.config.js`)
- `tsconfig.json` — `{ "compilerOptions": {}, "extends": "expo/tsconfig.base" }` (the real per-package configs live under each workspace)

**Recommendation:** confirm with the user, then `rm -rf android/ app.json tsconfig.json` and add `/android/`, `/app.json`, `/tsconfig.json` (or a tighter pattern) to `.gitignore` so a future misrun prebuild doesn't pollute the root again.

### 2b. Build/run artifacts that should be gitignored

- `apps/desktop/nohup.out`, `apps/mobile/nohup.out` — dev-server logs from `nohup pnpm dev`
- `apps/desktop/selfIdentity.plist`, `apps/mobile/selfIdentity.plist` — Apple binary plists from a local sign run

**Recommendation:** add `nohup.out` and `selfIdentity.plist` (or `*.plist` scoped under `apps/*/`) to `.gitignore`.

### 2c. Old, never-committed top-level docs

These have been sitting untracked for 2+ weeks (mtime 2026-04-14 to 2026-04-16). They may be intentional (drafts, off-repo content) or forgotten:

- `.oauth-redirect-urls.md` — sync provider redirect URL scratchpad (absorbed into docs/OAUTH_DISABLED.md; file deleted)
- `PRESENTING_KEYKEYKEY.md` — pitch / presentation deck draft (5644 bytes)
- `PRIVACY_POLICY.md` — privacy policy text (7134 bytes)
- `AGENTS.md` — repo-guidelines doc for non-Claude agents, **mtime 2026-04-30 23:17 today** (3025 bytes)

**Do not delete or commit any of these without asking.** `AGENTS.md` was edited today, so the user is actively working on it. The others are likely intentional off-repo drafts.

---

## 3. Recent Activity (last 5 days, 2026-04-26 → 2026-04-30)

All landed via PR and merged to `main`. Listed newest first; PR numbers in `(#NN)`.

| PR  | Date  | Type     | Summary                                                                     |
| --- | ----- | -------- | --------------------------------------------------------------------------- |
| #95 | 04-30 | fix      | passphrase test resilient to EFF wordlist hyphenated words                  |
| #94 | 04-30 | deps     | dependabot rustls-webpki 0.103.10 → 0.103.13 (Rust desktop)                 |
| #93 | 04-30 | fix(e2e) | extension sync-flow timeouts 30s → 45s for Firefox runner parity            |
| #92 | 04-30 | refactor | desktop: split fetch-proxy out of `sync.ts`, adds tests                     |
| #91 | 04-29 | refactor | core/biometric: re-seam onto `OSBiometricStore` + `DEKProtector` interfaces |
| #90 | 04-29 | refactor | core/sync: hoist not-found + auth-error contract into adapter base          |
| #89 | 04-29 | refactor | core/store: split `vault-store` into `dek-holder` + `decryptor`             |
| #88 | 04-26 | feat     | desktop: Touch ID biometric unlock (macOS) — full feature                   |
| #87 | 04-26 | fix      | bump vitest birpc DEFAULT_TIMEOUT 60s → 5m via pnpm patch                   |
| #86 | 04-26 | chore    | use vitest forks pool + restore per-handler items tests                     |
| #85 | 04-26 | fix      | extension: items handlers reject content-script callers (sender guard)      |
| #84 | 04-26 | feat     | password history restore (core + 3 platforms + E2E + docs)                  |

**This session changed nothing in application code** — the only file added is the document you are reading. Investigation commands are listed in §5.

---

## 4. Decisions Made (visible in recent merges)

These are architectural choices the next agent should not relitigate without good reason:

1. **Biometric DEK protection has a layered interface.** `OSBiometricStore` (platform abstraction) + `DEKProtector` (crypto seam) was introduced in PR #91. Anything new touching biometric unlock should consume those interfaces, not reach directly into platform code. See `packages/core/src/biometric/` and `apps/desktop/src-tauri/src/biometric_cmds/`.
2. **Sync adapters share an error-contract base class.** PR #90 hoisted `NotFoundError` + `AuthError` into the base. New sync adapters extend that base; do not invent local error types.
3. **`vault-store` is split: dek-holder + decryptor.** PR #89. Treat them as distinct concerns; do not collapse them back.
4. **Desktop fetch proxy is a separate module from sync.** PR #92. The Tauri Rust HTTP-proxy bridge is consumed via a thin TS module, kept out of `sync.ts`.
5. **macOS Touch ID is the reference implementation for desktop biometric.** PR #88 + post-merge follow-ups (`6f17d08`, `3911bbe`, `764853c`). `apps/desktop/src-tauri/src/biometric_cmds/macos.rs` uses `kSecAccessControlBiometryCurrentSet` for the Keychain ACL and `objc2` for `LAContext`. **Windows Hello is not yet implemented and should follow the same shape** (real biometric gating, DPAPI-encrypted DEK).
6. **Passphrase word-counting uses leading-capital, not `split('-')`.** PR #95. The EFF wordlist contains hyphenated entries (`drop-down`, `t-shirt`, `yo-yo`, `felt-tip`); naive split inflates the count ~1-in-400. Saved as a memory; do not regress this.
7. **Extension items handlers refuse content-script senders.** PR #85. Don't widen the sender guard.
8. **E2E sync-flow waits are 45s, not 30s, on both Chrome and Firefox runners.** PR #93. If you flake, fix the cause; do not re-lower the wait.

---

## 5. Commands Run This Session and Their Results

All commands here were read-only investigation to produce this handoff. No tests or builds were executed.

| Command                                | Result                                                           |
| -------------------------------------- | ---------------------------------------------------------------- |
| `git status`                           | clean working tree, untracked-only (see §2)                      |
| `git log --oneline -30`                | confirmed `main` HEAD = `8591db4` (#94)                          |
| `git branch -a`                        | only stale remote branches for already-merged PRs                |
| `git stash list`                       | empty                                                            |
| `gh pr list --state open`              | empty                                                            |
| `gh pr list --state merged --limit 15` | most recent #95 (2026-04-30 20:57Z), #88 was the Touch ID feat   |
| `gh issue list --state open`           | empty                                                            |
| `gh run list --limit 8 --branch main`  | latest run **success** (`25189438074`, 5m11s, all 12 jobs green) |

**No `pnpm build`, `pnpm test`, `pnpm lint`, or e2e run was executed in this session.** The next agent should run them at minimum once before claiming green:

```bash
pnpm build && pnpm test && pnpm lint
cd e2e && npx playwright test --grep @critical
```

---

## 6. Known Failures and Blockers

### Live blockers: none

CI is green; no open PRs; no open issues. If you start a feature and hit a wall, check `IMPLEMENTATION_STATUS.md` §4–§6 — outstanding questions are catalogued there.

### Soft deadlines / non-blocking warnings on CI

These showed up as **annotations** on the latest successful run (`gh run view 25189438074`):

1. **Node.js 20 deprecation in GitHub Actions.** `pnpm/action-setup@v4`, `actions/cache@v4`, `actions/upload-artifact@v5` all run on Node 20. GitHub's timeline:
   - 2026-06-02: forced to Node 24 by default.
   - 2026-09-16: Node 20 removed from runners.

   The fix is bumping each action to a Node-24-compatible version. Search `.github/workflows/` for the pinned versions.

2. **Spurious "no files found" artifact-upload warnings.** Two paths print "no files found" on green runs:
   - `.github/workflows/ci.yml:271` → `path: e2e/test-results/` (E2E critical job — only populated on failure)
   - `.github/workflows/ci.yml:335` → `path: /tmp/kkk-ff-*.*` (Firefox E2E — same pattern)

   Both are benign (the dirs are populated only on failure) but produce log noise. Fix by adding `if-no-files-found: ignore` to the `upload-artifact` step.

### Memory items that may be stale (verified during this handoff)

The auto-memory system carried two pending items. **Both are likely already done — verify before acting:**

- **"Verification Codes picker still pending"** (memory note from 2026-04-19) — appears stale. `apps/mobile/targets/credential-provider/OneTimeCodeListView.swift` was added in commit `438c4c2` (PR #54) on 2026-04-14, and `CredentialProviderViewController.swift` does call `prepareOneTimeCodeCredentialList` and `completeOneTimeCodeRequest`. PR #74 (2026-04-19, "iOS autofill parity") likely closed the picker concern. If you're picking up TOTP autofill work, run the iOS device flow first to confirm the picker behaves before assuming it's broken.
- **"Sync-flow §5 real-device test pending on Android"** (memory note, scheduled 2026-04-18) — there is no recent commit explicitly closing this. If the user asks about Android sync-flow §5, treat it as still pending.

---

## 7. Exact Next Steps

If the user gives an explicit task, do that. Otherwise, in priority order:

### Step A — Housekeep the working tree (5 minutes, ASK FIRST)

The untracked files in §2a/§2b are noise. Confirm with the user, then either:

```bash
# After confirming with user that the prebuild output is stray:
rm -rf android/ app.json tsconfig.json
rm apps/{desktop,mobile}/nohup.out apps/{desktop,mobile}/selfIdentity.plist
```

And update `.gitignore` to add `/android/`, `/app.json` (root only — the per-package ones must stay tracked), `nohup.out`, `apps/*/selfIdentity.plist`.

**Do not touch** `PRESENTING_KEYKEYKEY.md`, `PRIVACY_POLICY.md`, `AGENTS.md`. They look intentional. (`.oauth-redirect-urls.md` has since been deleted — its content is in docs/OAUTH_DISABLED.md.)

### Step B — Pick a backlog item from `IMPLEMENTATION_STATUS.md` §4

Read `IMPLEMENTATION_STATUS.md:90-118` for the full backlog. Highest-leverage starters:

1. **Bump Node-20 GitHub Actions** — touch only `.github/workflows/*.yml`, no application code. Estimated 30 min.
2. **`apple-app-site-association` hosting decision** — first action is research (is the file already hosted?), not code. Asks a question, not a PR.
3. **Cargo CI for `apps/desktop/src-tauri`** — separate `test-desktop-rust` job. Needs `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev` on Ubuntu runner. Estimated half-day.
4. **Windows Hello biometric** — mirrors the macOS shape from `apps/desktop/src-tauri/src/biometric_cmds/macos.rs`. **Pickable only if you can test on Windows hardware.** Estimated 1 day.

### Step C — Workflow expectations

For any code change:

- Run `pnpm test` for the affected package before claiming green.
- Always run `cd e2e && npx playwright test --grep @critical` before pushing (per `CLAUDE.md`).
- Conventional Commits: `type(scope): message` — see `git log --oneline -20` for style.
- Never disable or weaken a CI check to make a test pass — fix the root cause (per `CLAUDE.md` "Annoyances" section).

---

## 8. Out of Scope

Explicit do-not-do for the next agent unless the user reopens the question:

- **iCloud sync, local/network sync, Safari extension** — `IMPLEMENTATION_STATUS.md:108` flags these as "needs design first" because they share a sandboxed-extension blocker. No code until the bridge architecture is brainstormed with the user.
- **Stryker mutation testing** — spec calls it optional; the user's preference (per `IMPLEMENTATION_STATUS.md:116`) is "skip unless you specifically want it."
- **`packages/ui` real components** — the package has zero tests today. Don't add tests-for-tests' sake; the user wants a _decision_ first about whether `packages/ui` should grow into a real component library or stay as tokens/primitives.
- **Application code changes in this handoff** — the user explicitly told this session not to change application code. The only file written this session is `docs/CODEX_HANDOFF.md`. Do not commit anything else as part of "the handoff."
- **Local-network WebDAV testing patches** — see `CLAUDE.md` "Local Network Testing (WebDAV)" section. The two LOCAL TESTING ONLY guards (`packages/core/src/sync/webdav-adapter.ts` and `apps/desktop/src-tauri/src/http_proxy.rs`) must NEVER be merged to main.

---

## 9. Important Context Not Obvious from the Code

- **`IMPLEMENTATION_STATUS.md` is the canonical backlog.** It's a living doc, last meaningfully updated around the PR #88 (Touch ID) merge. Treat it as the source of truth for "what's done vs. not"; do not duplicate the backlog into new tracker docs.
- **`CLAUDE.md` carries hard rules, not just style guidance.** Notably: never dismiss errors as "pre-existing" (fix everything you find), never disable CI features to pass tests, always rebuild after a feature so the user can install it, always run E2E `@critical` before push.
- **There is a Knowledge Graph navigation layer** for this repo. `CLAUDE.md` instructs Claude-family agents to query `graphify query "..."` before reading raw files; the entrypoint is `graphify-out/wiki/index.md`. If the next agent doesn't have the `graphify` skill, ignore this — direct file reading is fine.
- **The repo just finished a "decomposition" mini-initiative.** PRs #46, #47, #48 (early April) decomposed PlatformStorage, SyncSettings, and HTTP adapters. PRs #89–#92 (this week) continued the spirit by splitting `vault-store`, the sync error contract, biometric, and the desktop fetch proxy. The pattern: **prefer narrow, named seams over fat coupling.** New work should respect these seams, not blur them.
- **Module-system note:** ESM throughout (`"type": "module"`). Don't introduce CJS — the existing tar-v7 / `@expo/cli` interop required a pnpm patch (`patches/@expo__cli@0.22.28.patch`); do not regress that.
- **iOS build requires Xcode 26.4.1+ and respects two env vars** (`APPLE_TEAM_ID`, `APPLE_PAID_TEAM`). Read `CLAUDE.md` "iOS Build Notes" before any mobile build attempt — there are five automated patches you don't want to fight by accident.
- **Auto-memory pointers (Claude Code-only).** `~/.claude/projects/-Users-davidneto-keykeykey/memory/MEMORY.md` carries cross-session notes (e.g., "expo-sqlite absolute-path bug", "iOS keychain ACL items invisible to UISkip"). If you're not the Claude Code agent, ignore. If you are, treat the memory as advisory and verify any specific function/file/flag claim before acting on it.

---

## 10. Quick Reference

- Branch: `main` @ `8591db4`
- CI: green (`gh run view 25189438074`)
- Backlog: `IMPLEMENTATION_STATUS.md` §4 (`docs/IMPLEMENTATION_STATUS.md` does not exist — the file is at the repo root)
- Build/test commands: `pnpm build && pnpm test && pnpm lint` ; E2E: `cd e2e && npx playwright test --grep @critical`
- Specs/plans dirs: `docs/superpowers/specs/`, `docs/superpowers/plans/`
- ADRs: `docs/adr/0001-platformstorage-is-narrow-on-purpose.md`, `docs/adr/0002-tauri-command-set-stays-flat.md`
- Repo guidelines: `AGENTS.md` (untracked, recently authored) and `CLAUDE.md` (committed). For non-Claude agents prefer `AGENTS.md`.
