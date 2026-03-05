# @keykeykey/desktop

KeyKeyKey desktop app for macOS, Windows, and Linux, built with Tauri v2 (Rust backend + Vite/React frontend).

## Features

- Vault management (credentials, cards, secure notes)
- OS keyring integration (macOS Keychain, Windows Credential Manager) for DEK caching
- Global keyboard shortcuts (e.g., `Cmd+Shift+Space` for quick search)
- Minimal binary size (<10MB) and low RAM usage via native webview

## Prerequisites

- Node.js >= 22
- pnpm >= 10
- Rust toolchain (install via [rustup](https://rustup.rs))
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `webkit2gtk`, `libappindicator`, `librsvg` (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))
  - **Windows**: Microsoft Visual Studio C++ Build Tools, WebView2

## Development

```bash
# Start Vite dev server (frontend only)
pnpm dev

# Start full Tauri dev environment (frontend + Rust backend)
pnpm tauri dev

# Run frontend tests
pnpm test

# Run Rust tests
cd src-tauri && cargo test

# Build for production
pnpm tauri build
```

## Project Structure

```
apps/desktop/
  src/               # React frontend (Vite)
    App.tsx          # Root component
    main.tsx         # Entry point
  src-tauri/         # Rust backend
    src/
      lib.rs         # Tauri commands and plugin setup
      main.rs        # Entry point
    Cargo.toml       # Rust dependencies
    tauri.conf.json  # Tauri configuration
```

## Testing

- **Frontend**: Vitest + React Testing Library
- **Backend**: `cargo test` with `mockall` for OS keychain mocking
- **E2E**: Playwright driving the Tauri webview
