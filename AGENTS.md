# Repository Guidelines

## Project Structure & Module Organization

KeyKeyKey is a pnpm/Turbo monorepo. `packages/core/src` holds shared crypto,
models, vault store, sync, import/export, generator, domain, PIN, and biometric
logic. `packages/ui/src` holds shared tokens and UI.
Apps live in `apps/mobile` (Expo React Native), `apps/desktop` (Tauri 2,
React/Vite in `src/`, Rust in `src-tauri/src`), and `apps/extension` (Manifest
V3 with `background/`, `content/`, and `popup/`). Tests live beside source as
`*.test.ts(x)` or `__tests__`; cross-platform flows are in `e2e/`. Read
`CONTEXT.md`, `docs/adr/`, and `docs/superpowers/specs/` before architecture
changes.

## Build, Test, and Development Commands

- `pnpm install`: install dependencies using pnpm 10.
- `pnpm build`: build all packages/apps through Turbo.
- `pnpm dev`: start workspace dev tasks.
- `pnpm test`: run unit tests after dependent builds.
- `pnpm lint`: run ESLint.
- `pnpm format` / `pnpm format:check`: apply or verify Prettier.
- `pnpm --filter @keykeykey/core test`: test one workspace package.
- `pnpm --filter @keykeykey/mobile ios`: run the Expo app on iOS.
- `pnpm --filter @keykeykey/extension build`: build Chrome and Firefox outputs.
- `pnpm e2e:mobile:ios` or `cd e2e && pnpm test:extension`: run targeted E2E.

## Coding Style & Naming Conventions

Use Node 22+ and ESM TypeScript. Prettier enforces 2-space indentation,
semicolons, single quotes, trailing commas, and 100-character lines. ESLint is in
`eslint.config.js`; prefix intentionally unused values with `_`. Use PascalCase
for React components, `useThing` for hooks, `thing.test.ts` or `Thing.test.tsx`
for tests, and `index.ts` files for package exports. Extension code must use
`webextension-polyfill`'s `browser` namespace, not `chrome`.

## Testing Guidelines

Vitest covers `packages/core`, `packages/ui`, `apps/desktop`, and
`apps/extension`; mobile uses Jest with `jest-expo`; E2E uses Playwright plus
Firefox-specific Vitest tests. Add focused tests next to changed code. Expand
E2E coverage when behavior crosses app, extension, storage, or sync boundaries.
Run filtered tests during iteration and `pnpm test` before broad changes. Use
`test:coverage` when touching crypto, vault storage, sync,
import/export, or unlock flows.

## Commit & Pull Request Guidelines

Git history follows Conventional Commits: `fix(core/store): ...`,
`feat(desktop/biometric): ...`, `refactor(core/sync): ...`, `docs(plan): ...`.
Keep commits scoped and imperative. Pull requests should describe the user-facing
change, list verification commands, link related issues or design docs, and
include screenshots or recordings for UI changes. Call out security, migration,
storage, or sync implications.

## Security & Configuration Tips

Never commit real vaults, credentials, OAuth secrets, or generated local build
artifacts. Respect `.gitleaks.toml` and run `pnpm audit` for dependency review.
Keep local Xcode, Android Studio, Rust, and Apple Team ID configuration out of
source control.
