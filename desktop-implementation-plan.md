# Tauri Desktop App Implementation Plan

## Context

Section 4 of `implementationplan.md` specifies a Tauri desktop app (`apps/desktop`). Currently only a scaffold exists: a placeholder `App.tsx` (heading + tagline), a `greet` Rust command in `lib.rs`, and basic Vite/React/Tauri config. The mobile app (`apps/mobile`) is fully built with 8 screens, vault CRUD, native Argon2, and 70 tests. The shared `packages/core` (crypto, models, store, sync, import) and `packages/ui` (design tokens) are complete. This plan builds the desktop app by porting the mobile patterns to a Tauri + React Router web frontend with a Rust storage backend.

---

## Phase 1: Foundation (Rust Backend + Routing + VaultContext)

### 1A. Rust Backend — Storage & Native Commands

**`apps/desktop/src-tauri/Cargo.toml`** — MODIFY: Add dependencies:
- `rusqlite` (bundled) — SQLite for encrypted vault items
- `keyring` v3 — OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- `argon2` v0.5 — Native Argon2id KDF (<200ms with desktop params)
- `base64` v0.22 — Data encoding for JS↔Rust transfer
- `directories` v5 — Cross-platform app data dir

**`apps/desktop/src-tauri/src/storage.rs`** — NEW: SQLite + file storage module
- `init_db()` — Creates `vault_items(id, type, encrypted_data, created_at, updated_at)` table
- `save_vault_header(data)` / `load_vault_header()` — Binary file in app data dir
- `save_encrypted_item()` / `load_all_encrypted_items()` / `delete_encrypted_item()` — SQLite CRUD
- `is_vault_setup_complete()` / `set_vault_setup_complete()` — File marker flag
- Mirrors the storage contract from `apps/mobile/lib/storage.ts`

**`apps/desktop/src-tauri/src/keyring_cmds.rs`** — NEW: OS keyring commands
- `save_to_keyring(key, value)` / `load_from_keyring(key)` / `delete_from_keyring(key)`
- Service name: `"com.keykeykey.desktop"` — for future DEK caching / biometric unlock

**`apps/desktop/src-tauri/src/argon2_cmd.rs`** — NEW: Native Argon2id
- `argon2_hash(password_b64, salt_b64, t, m, p, dk_len) -> Result<String>`
- Decodes base64 inputs, runs Argon2id via Rust crate, returns base64 result
- Enables `ARGON2_PRESETS.desktop` (64 MiB, 3 iterations, 4 parallelism) from `packages/core/src/crypto/constants.ts`

**`apps/desktop/src-tauri/src/lib.rs`** — MODIFY: Wire all modules
- Add `mod storage; mod keyring_cmds; mod argon2_cmd;`
- `AppState` struct holding `Mutex<Connection>` + `app_data_dir`
- Register all commands in `invoke_handler`

### 1B. Frontend — Tauri API Bridge

**`apps/desktop/src/lib/tauri-storage.ts`** — NEW: TypeScript wrappers around `invoke()` calls
- Same interface as mobile's `storage.ts`: `saveVaultHeader`, `loadVaultHeader`, `saveEncryptedItem`, `loadAllEncryptedItems`, `deleteEncryptedItem`, `isVaultSetupComplete`, `setVaultSetupComplete`

**`apps/desktop/src/lib/tauri-argon2-adapter.ts`** — NEW: Argon2Adapter implementation
- Implements `Argon2Adapter` interface from `packages/core/src/crypto/argon2-adapter.ts`
- Calls Rust `argon2_hash` command via `invoke()`
- Base64 encode/decode for Uint8Array transfer

### 1C. Frontend — VaultContext

**`apps/desktop/src/lib/vault-context.tsx`** — NEW: Port of `apps/mobile/lib/vault-context.tsx`
- Same `VaultProvider` + `useVault()` hook pattern
- Status machine: `loading → needs_setup → locked → unlocked`
- CRUD: `setupVault`, `unlock`, `lock`, `addItem`, `updateItem`, `removeItem`, `search`
- Changes from mobile:
  - Import from `./tauri-storage` instead of `./storage`
  - Auto-lock via Page Visibility API (replaces React Native `AppState`)
  - Use `ARGON2_PRESETS.desktop` instead of `.mobile`

### 1D. Frontend — Theme & Routing

**`apps/desktop/src/lib/theme.tsx`** — NEW: Theme provider
- Uses tokens from `@keykeykey/ui` (same as mobile's `lib/theme.ts`)
- `ThemeProvider` context with `useTheme()` hook
- OS detection via `matchMedia('(prefers-color-scheme: dark)')` + localStorage override
- Sets CSS custom properties on `:root`

**`apps/desktop/src/styles/global.css`** — NEW: Global styles
- CSS reset, system font stack, focus-visible outlines, scrollbar styling

**`apps/desktop/src/App.tsx`** — REWRITE: Full routing
- `BrowserRouter` with routes: `/` (StatusRouter), `/setup`, `/recovery`, `/unlock`, `/vault/*` (AppShell with nested routes)

**`apps/desktop/src/components/StatusRouter.tsx`** — NEW: Status-based redirect
- Calls `initialize()`, watches vault status, redirects accordingly

**`apps/desktop/src/components/AppShell.tsx`** — NEW: Desktop layout
- 220px sidebar (Vault, Generator, Settings nav + Lock button) + `<Outlet />` content area
- `NavLink` with lime accent for active state, `lucide-react` icons

**`apps/desktop/src/main.tsx`** — MODIFY: Register Argon2 adapter + import global CSS

**`apps/desktop/package.json`** — MODIFY: Add dependencies
- `@tauri-apps/api` ^2.3.0, `react-router-dom` ^7.0.0, `lucide-react` ^0.460.0

---

## Phase 2: Core Screens (Setup, Unlock, Vault List)

### 2A. Shared UI Components

All in `apps/desktop/src/components/ui/` — NEW files:

| Component | Port of | Notes |
|-----------|---------|-------|
| `Button.tsx` | mobile `Button.tsx` | HTML `<button>`, variants: primary/secondary/danger, loading spinner |
| `TextInput.tsx` | mobile `TextInput.tsx` | HTML `<input>`, label, error, password toggle, Enter-to-submit |
| `ItemCard.tsx` | mobile `ItemCard.tsx` | `<div>` with hover effect, icon/name/subtitle/star/chevron |
| `EmptyState.tsx` | mobile `EmptyState.tsx` | Centered icon + title + subtitle |
| `ToggleSwitch.tsx` | — | CSS toggle for boolean options (generator, settings) |

### 2B. Screens

All in `apps/desktop/src/screens/` — NEW files:

**`SetupScreen.tsx`** — Port of `apps/mobile/app/setup.tsx`
- Centered card (max-width ~480px), password + confirm fields, requirement indicators, "Create Vault" button
- Calls `setupVault()`, navigates to `/recovery`

**`RecoveryScreen.tsx`** — Port of `apps/mobile/app/recovery.tsx`
- Monospace recovery key display, copy button via `navigator.clipboard`, warning box, continue button

**`UnlockScreen.tsx`** — Port of `apps/mobile/app/unlock.tsx`
- Centered card, password field with `autoFocus`, Enter submits, error on failure
- Calls `unlock()`, navigates to `/vault`

**`VaultListScreen.tsx`** — Port of `apps/mobile/app/(tabs)/index.tsx`
- Search bar + filter chips (All/Logins/Cards/Notes) + scrollable ItemCard list
- Sorting: favorites first, then updatedAt desc
- "+" button navigates to `/vault/add`

---

## Phase 3: Item Management

All in `apps/desktop/src/screens/` — NEW files:

**`AddItemScreen.tsx`** — Port of `apps/mobile/app/item/add.tsx`
- Type selector chips, conditional form fields per type (credential/card/note)
- Validation, `addItem()`, navigate back on success

**`ItemDetailScreen.tsx`** — Port of `apps/mobile/app/item/[id].tsx`
- `useParams()` for id, reveal/hide sensitive fields, copy buttons, favorite toggle
- Edit button → `/vault/edit/:id`, delete with `window.confirm()`

**`EditItemScreen.tsx`** — Port of `apps/mobile/app/item/edit.tsx`
- Pre-populated form from current item, `updateItem()`, navigate back on save

---

## Phase 4: Password Generator in Core + Polish

### 4A. Password Generator in `packages/core` (Section 10 of implementationplan.md)

**`packages/core/src/generator/index.ts`** — NEW: Full generator per Section 10 spec
- `generatePassword(options: PasswordGeneratorOptions): string` — random + passphrase modes
- `calculateEntropy(password, options): number` — entropy in bits
- `estimateStrength(entropy): 'weak' | 'fair' | 'strong' | 'very-strong'`
- Random mode: configurable length (8-128), character class toggles, excludeAmbiguous, rejection sampling for class guarantees
- Passphrase mode: EFF large wordlist, configurable word count/separator/capitalize/appendNumberSymbol
- Uses `crypto.getRandomValues()` exclusively (no Math.random)

**`packages/core/src/generator/wordlist.ts`** — NEW: Bundled EFF large wordlist (7,776 words)

**`packages/core/src/generator/__tests__/generator.test.ts`** — NEW: Tests per Section 10.5
- Character class constraints, length constraints, entropy calculation, passphrase word count/separator
- Property-based testing: 1,000 passwords all satisfy constraints
- Verify `crypto.getRandomValues()` is used

**`packages/core/src/index.ts`** — MODIFY: Re-export generator module

**`packages/core/package.json`** — MODIFY: Add `"./generator"` export path

### 4B. Desktop Generator Screen

**`apps/desktop/src/screens/GeneratorScreen.tsx`** — NEW
- Consumes `generatePassword`, `calculateEntropy`, `estimateStrength` from `@keykeykey/core/generator`
- Password display, range slider for length, toggle switches for character classes
- Real-time entropy display with strength indicator
- Mode toggle: Random / Passphrase
- Copy with auto-clear

**`apps/desktop/src/screens/SettingsScreen.tsx`** — NEW
- Lock Vault, Theme toggle (Light/Dark/System), Auto-lock display, version info
- Future placeholders: Cloud Sync, Export

**`apps/desktop/src/lib/clipboard.ts`** — NEW
- `copyWithAutoClear(text, timeout=30s)` — writes to clipboard, clears after timeout

**`apps/desktop/src/components/ui/Toast.tsx`** — NEW
- `ToastProvider` + `useToast()` hook for feedback messages ("Copied!", "Saved!")

---

## Phase 5: Testing

### Frontend Tests (Vitest + React Testing Library)

**`apps/desktop/src/test-setup.ts`** — NEW: Mock `@tauri-apps/api/core`, `navigator.clipboard`, `matchMedia`

| Test File | Covers |
|-----------|--------|
| `src/lib/__tests__/vault-context.test.tsx` | Status transitions, CRUD, auto-lock, search |
| `src/lib/__tests__/tauri-storage.test.ts` | invoke() calls with correct args |
| `src/lib/__tests__/theme.test.ts` | OS detection, toggle persistence, token shape |
| `src/screens/__tests__/SetupScreen.test.tsx` | Form validation, setupVault call, navigation |
| `src/screens/__tests__/UnlockScreen.test.tsx` | Password entry, error, unlock, Enter key |
| `src/screens/__tests__/VaultListScreen.test.tsx` | Item list, search, filter, empty state |

### Rust Tests (inline `#[cfg(test)]` modules)

- `storage.rs` — SQLite CRUD round-trips, vault header file I/O, setup flag
- `argon2_cmd.rs` — Known test vector, base64 round-trip

---

## Verification

1. **Rust backend**: `cd apps/desktop/src-tauri && cargo test` — all storage and argon2 tests pass
2. **Frontend tests**: `cd apps/desktop && pnpm test` — all vitest tests pass
3. **Full build**: `pnpm turbo build --filter=@keykeykey/desktop` — Vite + Tauri build succeeds
4. **Manual smoke test**: `cd apps/desktop && pnpm tauri dev` — app launches, create vault → recovery → unlock → add item → view → edit → delete → lock → re-unlock flow works
5. **CI**: Existing `test-desktop` job in GitHub Actions should pass

---

## Key Files Reference

| Purpose | File |
|---------|------|
| Mobile VaultContext (port source) | `apps/mobile/lib/vault-context.tsx` |
| Mobile storage interface (contract) | `apps/mobile/lib/storage.ts` |
| Argon2 adapter interface | `packages/core/src/crypto/argon2-adapter.ts` |
| Argon2 presets | `packages/core/src/crypto/constants.ts` |
| Design tokens | `packages/ui/src/tokens/index.ts` |
| Current Rust entry point | `apps/desktop/src-tauri/src/lib.rs` |
| Current frontend entry | `apps/desktop/src/App.tsx` |
