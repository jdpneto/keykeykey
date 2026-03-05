# @keykeykey/extension

KeyKeyKey browser extension for Chrome, Firefox, and Safari. Built with Vite, React, and Manifest V3.

## Features

- Popup UI for quick vault search and credential copying
- Background service worker for DEK lifecycle and auto-locking
- Content scripts for autofill injection into login forms
- Encrypted local storage via `chrome.storage.local`

## Supported Browsers

- **Chromium**: Chrome, Edge, Brave
- **Firefox**: via WebExtensions API
- **Safari**: via Xcode Web Extension converter

## Prerequisites

- Node.js >= 22
- pnpm >= 10
- Chrome or Firefox (for development/testing)

## Development

```bash
# Start Vite dev server with HMR
pnpm dev

# Build the extension
pnpm build

# Lint manifest.json
pnpm lint:manifest

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage
```

### Loading in Chrome

1. Run `pnpm build`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist/` directory

### Loading in Firefox

1. Run `pnpm build`
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on" and select `dist/manifest.json`

## Project Structure

```
apps/extension/
  src/
    popup/           # Popup UI (React)
      index.html     # Popup entry HTML
      main.tsx       # React mount point
      Popup.tsx      # Root popup component
    background/      # Service worker
      index.ts       # DEK management, auto-lock, message handling
    content/         # Content scripts
      index.ts       # Login form detection and autofill injection
  manifest.json      # Manifest V3 configuration
```

## Testing

- **Unit/Integration**: Vitest for popup components, background logic, and content scripts
- **E2E**: Playwright with `--load-extension` for full flow testing
- **Manifest Validation**: `web-ext lint` in CI
