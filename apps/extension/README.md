# @keykeykey/extension

KeyKeyKey browser extension for Chrome, Firefox, and Safari. Built with Vite, React, and Manifest V3.

## Features

- Popup UI for vault management (setup, unlock, credential CRUD, search, generator)
- Background service worker for DEK lifecycle, auto-locking, and sync
- Cloud sync via Google Drive, WebDAV, or iCloud (Safari only)
- PIN unlock as a fast alternative to master password
- Content scripts for autofill injection into login forms (sub-project #2)
- Encrypted local storage via `browser.storage.local`
- Cross-browser: Chrome, Firefox, Safari via `webextension-polyfill`. Firefox
  and Chrome are produced as separate `dist-firefox/` and `dist-chrome/` builds.

## Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10
- **Chrome**, **Firefox**, or **Safari** (for testing)
- **Xcode** >= 15 (for Safari only — needed for the Web Extension converter)

## Development

```bash
# From the monorepo root — install dependencies
pnpm install

# Build the shared packages first (required before extension build)
pnpm --filter @keykeykey/core --filter @keykeykey/ui build

# Build the extension (both Chrome and Firefox targets)
pnpm --filter @keykeykey/extension build

# Or build a single target
pnpm --filter @keykeykey/extension build:chrome    # → dist-chrome/
pnpm --filter @keykeykey/extension build:firefox   # → dist-firefox/

# Start Vite dev server with HMR (Chrome target, for popup development)
pnpm --filter @keykeykey/extension dev

# Lint Firefox manifest via web-ext
pnpm --filter @keykeykey/extension lint:manifest

# Run tests
pnpm --filter @keykeykey/extension test

# Run tests with coverage
pnpm --filter @keykeykey/extension test:coverage
```

---

## Installing in Chrome (and Chromium browsers: Edge, Brave, Arc)

### Step 1: Build the extension

```bash
# From the monorepo root
pnpm install
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
pnpm --filter @keykeykey/extension build
```

This produces `apps/extension/dist-chrome/` with the built extension.

### Step 2: Open the Extensions page

- **Chrome**: Navigate to `chrome://extensions`
- **Edge**: Navigate to `edge://extensions`
- **Brave**: Navigate to `brave://extensions`
- **Arc**: Navigate to `arc://extensions`

### Step 3: Enable Developer Mode

Toggle the **"Developer mode"** switch in the top-right corner of the extensions page.

### Step 4: Load the extension

1. Click **"Load unpacked"**
2. Navigate to `apps/extension/dist-chrome/` inside the keykeykey repository
3. Select the `dist-chrome` folder and click **"Select"** (or **"Open"** on some systems)

### Step 5: Verify installation

- The KeyKeyKey icon should appear in the browser toolbar (you may need to click the puzzle-piece icon and pin it)
- Click the icon to open the popup
- You should see the setup screen if this is a fresh install

### Updating after code changes

After making changes:

```bash
pnpm --filter @keykeykey/core --filter @keykeykey/ui build   # if core/ui changed
pnpm --filter @keykeykey/extension build:chrome
```

Then go to `chrome://extensions` and click the **refresh icon** (circular arrow) on the KeyKeyKey extension card. No need to remove and re-add.

### Debugging

- **Popup**: Right-click the popup and select **"Inspect"** to open DevTools for the popup
- **Background worker**: On `chrome://extensions`, click **"service worker"** link under the extension to open DevTools for the background script
- **Console logs**: Both popup and background logs appear in their respective DevTools consoles

---

## Installing in Firefox

### Step 1: Build the extension

```bash
# From the monorepo root
pnpm install
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
pnpm --filter @keykeykey/extension build
```

This produces `apps/extension/dist-firefox/` with the Firefox-specific build.

### Step 2: Open the Add-ons Debugging page

Navigate to `about:debugging#/runtime/this-firefox`

### Step 3: Load the extension

1. Click **"Load Temporary Add-on..."**
2. Navigate to `apps/extension/dist-firefox/`
3. Select the **`manifest.json`** file inside `dist-firefox/` (not the folder — Firefox wants a file)
4. Click **"Open"**

### Step 4: Verify installation

- The KeyKeyKey icon should appear in the toolbar
- Click it to open the popup
- The extension will be listed under "Temporary Extensions" on the debugging page

### Important: Temporary extensions

Firefox temporary extensions are **removed when Firefox closes**. You need to re-load the extension each time you restart Firefox. For persistent installation during development, use `web-ext`:

```bash
# Install web-ext globally (one-time)
npm install -g web-ext

# Run the extension in Firefox with auto-reload on file changes
cd apps/extension
web-ext run --source-dir dist-firefox/ --firefox-profile keykeykey-dev --keep-profile-changes
```

This creates a dedicated Firefox profile (`keykeykey-dev`) and auto-reloads the extension when files change.

### Updating after code changes

```bash
pnpm --filter @keykeykey/core --filter @keykeykey/ui build   # if core/ui changed
pnpm --filter @keykeykey/extension build:firefox
```

If using `web-ext run`, it auto-reloads. Otherwise, go to `about:debugging#/runtime/this-firefox` and click **"Reload"** on the extension.

### A note on persistence

The Firefox build sets a stable `browser_specific_settings.gecko.id` of
`keykeykey@keykeykey.app`. This means `browser.storage.local` persists across
extension reloads during development — you won't lose your vault when you
click "Reload" on `about:debugging`. The gecko.id also drives the OAuth
redirect URL (`https://3c49e7b76ea3e960825fdf27877252c3f6775139.extensions.allizom.org/`),
which is why OAuth providers must have that exact URL registered.

### Debugging

- **Popup**: Click **"Inspect"** next to the extension on `about:debugging`
- **Background worker**: Same "Inspect" button opens DevTools for the background script
- **Console logs**: Available in the inspector's Console tab
- **Manifest validation**: Run `pnpm --filter @keykeykey/extension lint:manifest` to check for Firefox-specific manifest issues

---

## Installing in Safari (macOS)

Safari requires converting the web extension into a native macOS app wrapper using Xcode's `safari-web-extension-converter` tool.

> Safari currently uses the Chrome build (`dist-chrome/`). A dedicated Safari
> target may be added in the future — Safari's OAuth limitations (no
> `launchWebAuthFlow`) make the Chrome manifest close enough for now.

### Prerequisites

- **macOS** 12 (Monterey) or later
- **Xcode** 15 or later (install from the Mac App Store or [developer.apple.com](https://developer.apple.com/xcode/))
- **Xcode Command Line Tools**: `xcode-select --install`
- **Safari**: Enable the Develop menu (Safari → Settings → Advanced → check "Show features for web developers")

### Step 1: Build the extension

```bash
# From the monorepo root
pnpm install
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
pnpm --filter @keykeykey/extension build:chrome
```

### Step 2: Convert to Safari extension

```bash
# Run the converter on the built extension
xcrun safari-web-extension-converter apps/extension/dist-chrome/ \
  --project-location apps/extension/safari-project \
  --app-name "KeyKeyKey" \
  --bundle-identifier com.keykeykey.extension \
  --no-prompt
```

This creates an Xcode project at `apps/extension/safari-project/`.

### Step 3: Build and run in Xcode

1. Open the Xcode project:
   ```bash
   open apps/extension/safari-project/KeyKeyKey/KeyKeyKey.xcodeproj
   ```
2. In Xcode, select **"KeyKeyKey"** as the target (top-left dropdown)
3. Select **"My Mac"** as the destination
4. Click **Run** (or press `Cmd+R`)
5. The app will build and launch — you can close the app window (the extension is now installed)

### Step 4: Enable in Safari

1. Open **Safari**
2. Go to **Safari → Settings → Extensions** (or `Cmd+,` → Extensions tab)
3. Check the box next to **"KeyKeyKey"** to enable it
4. If prompted about permissions, click **"Allow"**

### Step 5: Allow unsigned extensions (development only)

If you see a warning about the extension not being signed:

1. In Safari, go to **Safari → Settings → Advanced**
2. Check **"Show features for web developers"** (if not already enabled)
3. In the menu bar, go to **Develop → Allow Unsigned Extensions**
4. Enter your macOS password when prompted
5. Go back to **Safari → Settings → Extensions** and enable KeyKeyKey

**Note:** You need to re-enable "Allow Unsigned Extensions" every time Safari restarts.

### Step 6: Verify installation

- The KeyKeyKey icon should appear in the Safari toolbar
- Click it to open the popup
- You should see the setup screen

### Updating after code changes

After making changes:

```bash
# Rebuild the extension
pnpm --filter @keykeykey/core --filter @keykeykey/ui build   # if core/ui changed
pnpm --filter @keykeykey/extension build:chrome

# Re-run the converter (updates the Xcode project)
xcrun safari-web-extension-converter apps/extension/dist-chrome/ \
  --project-location apps/extension/safari-project \
  --app-name "KeyKeyKey" \
  --bundle-identifier com.keykeykey.extension \
  --no-prompt --force
```

Then rebuild in Xcode (`Cmd+R`).

### Debugging

- **Popup**: In Safari, right-click the popup and select **"Inspect Element"**
- **Background worker**: Go to **Develop → Web Extension Background Content** → select the KeyKeyKey entry
- **Console logs**: Available in Safari's Web Inspector
- If the Develop menu is missing, enable it in Safari → Settings → Advanced

---

## Troubleshooting

### Extension doesn't appear in toolbar

| Browser | Fix                                                                                     |
| ------- | --------------------------------------------------------------------------------------- |
| Chrome  | Click the puzzle-piece icon → find KeyKeyKey → click the pin icon                       |
| Firefox | Right-click toolbar → "Customize Toolbar" → drag KeyKeyKey icon to toolbar              |
| Safari  | Safari → Settings → Extensions → ensure KeyKeyKey is enabled and has "Allow" toggled on |

### "Errors" badge on chrome://extensions

Click "Errors" to see the details. Common causes:

- **Service worker registration failed**: Make sure you built with `pnpm --filter @keykeykey/extension build`, not `pnpm dev`
- **Module not found**: Ensure shared packages were built first (`pnpm --filter @keykeykey/core --filter @keykeykey/ui build`)

### Firefox: "This extension is not signed"

This is expected for locally-loaded temporary extensions. The warning does not affect functionality. For testing, continue using "Load Temporary Add-on" via `about:debugging`.

### Safari: "Allow Unsigned Extensions" resets on restart

This is a Safari security feature. You must re-enable it via **Develop → Allow Unsigned Extensions** after each Safari restart. This only applies during development — production releases are signed via the App Store.

### Build fails with "Cannot resolve @keykeykey/core"

The shared packages must be built before the extension:

```bash
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
pnpm --filter @keykeykey/extension build
```

### Hot reload during development

For rapid development of the popup UI:

```bash
# Terminal 1: Watch and rebuild core on changes
pnpm --filter @keykeykey/core dev

# Terminal 2: Run extension dev server
pnpm --filter @keykeykey/extension dev
```

Then load the extension from `dist-chrome/` as described above. Vite HMR updates the popup automatically (Chrome only — Firefox and Safari require manual reload).

## Project Structure

```
apps/extension/
  manifest.json            # Manifest V3 base (shared fields)
  manifest.chrome.json     # Chrome-only overrides (key, oauth2, offscreen, service_worker)
  manifest.firefox.json    # Firefox-only overrides (gecko.id, clipboardWrite, scripts background)
  vite.config.ts           # Vite build config (EXT_TARGET-aware, emits dist-chrome/ or dist-firefox/)
  vitest.config.ts         # Test config
  src/
    popup/                 # Popup UI (React)
      index.html           # Popup entry HTML
      main.tsx             # React mount point
      Popup.tsx            # Root popup component
      screens/             # Screen components (setup, unlock, list, etc.)
      components/          # Shared popup components
      hooks/               # React hooks (useMessage, useTheme, etc.)
    background/            # Service worker / event page
      index.ts             # Message handler, vault store, sync engine, auto-lock
      storage.ts           # browser.storage.local persistence layer
      auto-lock.ts         # Alarm-based auto-lock logic
      sync.ts              # SyncLifecycle wiring + adapter override dispatch
      clipboard.ts         # Clipboard auto-clear (offscreen on Chrome, native on Firefox)
    content/               # Content scripts
      index.ts             # Login form detection and autofill injection
    lib/                   # Shared utilities
      browser-detect.ts    # getBrowserKind() — Chrome/Firefox/Safari runtime detection
      google-oauth.ts      # Google OAuth (Chrome: getAuthToken, Firefox: PKCE)
      dropbox-oauth.ts     # Dropbox OAuth via launchWebAuthFlow
      onedrive-oauth.ts    # OneDrive OAuth via launchWebAuthFlow
      messages.ts          # Message type definitions
      theme.ts             # ThemeProvider for popup
```

## Testing

- **Unit/Integration**: Vitest for popup components, background logic, and message handlers
- **E2E**: Playwright with `--load-extension` for Chromium extension testing (`e2e/extension/`)
- **Manifest Validation**: `pnpm lint:manifest` runs `web-ext lint` against the Firefox build
- **Cross-browser**: Separate `dist-chrome/` and `dist-firefox/` builds. Safari uses `dist-chrome/` via `safari-web-extension-converter`.
