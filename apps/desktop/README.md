# @keykeykey/desktop

KeyKeyKey desktop app for macOS, Windows, and Linux, built with [Tauri v2](https://v2.tauri.app/) (Rust backend + Vite/React frontend).

## Features

- Vault management (credentials, cards, secure notes)
- Native Argon2id KDF via Rust (fast key derivation with desktop-strength parameters)
- OS keyring integration (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- Local SQLite storage for encrypted vault items
- Minimal binary size (<10 MB) and low RAM usage via native OS webview
- Light mode (peach/lime) and dark mode (green/black) themes

## App Structure

```
apps/desktop/
  src/                          # React frontend (Vite)
    main.tsx                    # Entry point, registers Argon2 adapter
    App.tsx                     # Root component with React Router
    lib/
      vault-context.tsx         # React context wrapping @keykeykey/core
      tauri-storage.ts          # TypeScript bridge to Rust storage commands
      tauri-argon2-adapter.ts   # Argon2id adapter using Rust backend
      theme.tsx                 # Light/dark theme provider
      clipboard.ts              # Clipboard with auto-clear
    components/
      AppShell.tsx              # Desktop sidebar + content layout
      StatusRouter.tsx          # Status-based route redirector
      ui/                       # Reusable UI components (Button, TextInput, etc.)
    screens/                    # All app screens
    styles/
      global.css                # CSS reset, fonts, focus styles
  src-tauri/                    # Rust backend
    src/
      lib.rs                    # Tauri setup, command registration
      main.rs                   # Entry point
      storage.rs                # SQLite + file-based vault storage
      keyring_cmds.rs           # OS keyring (keychain) commands
      argon2_cmd.rs             # Native Argon2id hashing
    Cargo.toml                  # Rust dependencies
    tauri.conf.json             # Tauri window, bundle, and build config
    icons/                      # Generated app icons (all platforms)
```

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 22 ([download](https://nodejs.org/))
- **pnpm** >= 10 (`npm install -g pnpm` or via [Corepack](https://pnpm.io/installation#using-corepack))
- **Rust toolchain** (see platform-specific instructions below)
- **Platform-specific system dependencies** (see below)

---

## Setup: macOS

### Step 1: Install Xcode Command Line Tools

```bash
xcode-select --install
```

Follow the on-screen prompt. If you already have Xcode installed from the Mac App Store, the CLT are included.

> **Note**: Full Xcode is only needed if you plan to target iOS from Tauri. For desktop-only development, the Command Line Tools are sufficient.

### Step 2: Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Follow the prompts (press Enter for defaults). Then load Rust into your current shell:

```bash
source "$HOME/.cargo/env"
```

Verify:

```bash
rustc --version   # e.g., rustc 1.94.0
cargo --version   # e.g., cargo 1.94.0
```

> **Tip**: Add `source "$HOME/.cargo/env"` to your `~/.zshrc` (or `~/.bashrc`) so Rust is available in all future terminal sessions.

### Step 3: Build shared packages and install dependencies

From the **monorepo root** (`/keykeykey`):

```bash
pnpm install
pnpm build
```

### Step 4: Run in development mode

```bash
cd apps/desktop
pnpm tauri dev
```

This starts both the Vite dev server (frontend hot-reload on port 1420) and the Tauri Rust backend. The app window opens automatically. The first run takes a few minutes as Rust compiles all dependencies; subsequent runs are much faster.

### Step 5: Build for production

```bash
pnpm tauri build
```

This creates a `.dmg` installer and a `.app` bundle in `src-tauri/target/release/bundle/`.

---

## Setup: Windows

### Step 1: Install Microsoft C++ Build Tools

1. Download the [Visual Studio Build Tools installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
2. Run the installer and select **"Desktop development with C++"**.
3. Complete the installation and restart your terminal.

### Step 2: Verify WebView2

WebView2 is pre-installed on Windows 10 (v1803+) and Windows 11. To verify:

1. Open **Settings > Apps > Installed apps**.
2. Search for "WebView2".

If not present, download the [Evergreen Bootstrapper](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) and run it.

### Step 3: Install Rust

Download and run `rustup-init.exe` from [rustup.rs](https://rustup.rs/).

During setup, select the default options. Ensure the MSVC toolchain is used:

```powershell
rustup default stable-msvc
```

Verify:

```powershell
rustc --version
cargo --version
```

### Step 4: Build shared packages and install dependencies

From the monorepo root:

```powershell
pnpm install
pnpm build
```

### Step 5: Run in development mode

```powershell
cd apps\desktop
pnpm tauri dev
```

### Step 6: Build for production

```powershell
pnpm tauri build
```

This creates an `.msi` installer and a `.exe` in `src-tauri\target\release\bundle\`.

> **Optional (MSI installers only)**: If you need MSI installer support, enable VBScript via **Settings > Apps > Optional features > More Windows features**.

---

## Setup: Linux

### Step 1: Install system dependencies

#### Debian / Ubuntu

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

#### Fedora

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel
sudo dnf group install "c-development"
```

#### Arch Linux

```bash
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg xdotool
```

### Step 2: Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

Verify:

```bash
rustc --version
cargo --version
```

### Step 3: Build shared packages and install dependencies

From the monorepo root:

```bash
pnpm install
pnpm build
```

### Step 4: Run in development mode

```bash
cd apps/desktop
pnpm tauri dev
```

### Step 5: Build for production

```bash
pnpm tauri build
```

This creates a `.deb` and/or `.AppImage` in `src-tauri/target/release/bundle/`.

---

## Development Commands

All commands run from `apps/desktop/`:

```bash
# Start Vite dev server only (frontend, no Rust backend)
pnpm dev

# Start full Tauri dev environment (frontend + Rust backend, hot-reload)
pnpm tauri dev

# Run frontend tests (Vitest)
pnpm test

# Run frontend tests in watch mode
pnpm test:watch

# Run frontend tests with coverage
pnpm test:coverage

# Run Rust backend tests
cd src-tauri && cargo test

# Type-check the frontend
pnpm typecheck

# Lint the frontend
pnpm lint

# Build for production (creates platform-specific installers)
pnpm tauri build
```

---

## Rust Backend

The Tauri Rust backend (`src-tauri/`) provides native OS integrations exposed as IPC commands:

| Module | Commands | Purpose |
|--------|----------|---------|
| `storage.rs` | `save_vault_header`, `load_vault_header`, `save_encrypted_item`, `load_all_encrypted_items`, `delete_encrypted_item`, `is_vault_setup_complete`, `set_vault_setup_complete` | SQLite database for encrypted vault items, file-based vault header |
| `keyring_cmds.rs` | `save_to_keyring`, `load_from_keyring`, `delete_from_keyring` | OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service) |
| `argon2_cmd.rs` | `argon2_hash` | Native Argon2id KDF — enables desktop-strength parameters (64 MiB, 3 iterations, 4 threads) in <200ms |

Data is stored in the platform-specific app data directory:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/com.keykeykey.desktop/` |
| Windows | `C:\Users\<User>\AppData\Roaming\com.keykeykey.desktop\` |
| Linux | `~/.local/share/com.keykeykey.desktop/` |

---

## Testing

- **Frontend**: [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) with jsdom
- **Rust backend**: `cargo test` with inline `#[cfg(test)]` modules (6 tests covering SQLite CRUD, vault header I/O, Argon2 hashing)
- **E2E (planned)**: Playwright driving the Tauri webview

---

## Troubleshooting

### `cargo check` or `pnpm tauri dev` fails on first run

The first Rust compilation downloads and builds all crate dependencies (~200 crates). This can take 2-5 minutes. Subsequent builds are incremental and fast (<5s).

If it fails with network errors, check your internet connection and try again.

### "failed to open icon" error during Rust compilation

The Tauri build process expects icons in `src-tauri/icons/`. Generate them from any 1024x1024 PNG:

```bash
cd apps/desktop
npx @tauri-apps/cli icon path/to/your-icon.png
```

### macOS: "xcrun: error: invalid active developer path"

Install or repair Xcode Command Line Tools:

```bash
xcode-select --install
```

### Linux: "Package webkit2gtk-4.1 was not found"

Install the WebKit2GTK development package for your distro (see Linux setup above). The package name varies:
- Debian/Ubuntu: `libwebkit2gtk-4.1-dev`
- Fedora: `webkit2gtk4.1-devel`
- Arch: `webkit2gtk-4.1`

### Windows: "link.exe not found"

Ensure the Visual Studio C++ Build Tools are installed with the "Desktop development with C++" workload. Restart your terminal after installation.

### Rust version mismatch

Update Rust to the latest stable:

```bash
rustup update stable
```

### Cargo crate version conflicts

If Tauri reports unknown config fields after updating, sync the Rust crates:

```bash
cd apps/desktop/src-tauri
cargo update
```
