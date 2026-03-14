# Playwright E2E Testing Design

End-to-end testing for the browser extension (Chrome/Firefox/Safari) and desktop app (Tauri) using Playwright, with interactive MCP-driven verification followed by automated test spec files.

## Context

The codebase has 567+ unit/integration tests across core, extension, desktop, and mobile. There are zero E2E tests. The implementation plan (Sections 7.4-7.5) calls for Playwright E2E across desktop and extension. A Playwright MCP server is available for interactive browser driving.

### Decisions

| Decision             | Choice                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| Scope                | Both extension and desktop, starting with extension                                                   |
| Approach             | Interactive MCP verification first, then automated spec files                                         |
| Test coverage        | Comprehensive: core flows, CRUD, PIN, settings, generator, clipboard                                  |
| Desktop connection   | Tauri WebDriver via `tauri-driver` (spike required — fallback to Vite dev server if CDP doesn't work) |
| Extension connection | Chromium `--load-extension` with popup URL navigation (Chromium only for Phase 1)                     |
| Browser scope        | Chromium only for automated E2E. Firefox/Safari verified interactively via MCP, not automated.        |
| CI behavior          | Non-blocking (`continue-on-error: true`), critical tests only                                         |
| Test tagging         | `@critical`, `@crud`, `@settings` — CI runs `@critical` only                                          |

## 1. Project Structure

A new top-level `e2e/` directory spanning both apps:

```
e2e/
  playwright.config.ts        # Two projects: extension, desktop
  extension/
    setup-vault.spec.ts       # Setup → recovery key flow
    unlock.spec.ts            # Password + PIN unlock
    vault-crud.spec.ts        # Add/edit/delete credential, card, note
    search-filter.spec.ts     # Search, filter chips, empty state
    generator.spec.ts         # Password/passphrase generator
    settings.spec.ts          # Theme, auto-lock, PIN management
    clipboard.spec.ts         # Copy buttons, clipboard feedback
  desktop/
    setup-vault.spec.ts       # Same flow set, adapted for desktop UI
    unlock.spec.ts
    vault-crud.spec.ts
    search-filter.spec.ts
    generator.spec.ts
    settings.spec.ts
  fixtures/
    extension.ts              # Custom fixture: loads extension in Chromium
    desktop.ts                # Custom fixture: launches Tauri via tauri-driver + CDP
  package.json                # @playwright/test dependency
  tsconfig.json
```

The `e2e/` directory has its own `package.json` to keep Playwright dependencies isolated from the app packages.

## 2. Extension Test Setup

### Fixture

Launches Chromium with the built extension loaded:

```typescript
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
```

- `extensionPath`: `apps/extension/dist/`
- Extensions require `headless: false` (Chromium limitation)
- Global setup builds core + ui + extension before tests
- Each test gets a fresh browser context (clean storage)

### Opening the Popup

Navigate to the popup's URL directly (Playwright can't interact with extension popups natively):

```typescript
const extensionId = getExtensionId(context); // extracted from service worker URL
const popupPage = await context.newPage();
// The built popup is at dist/popup/index.html or dist/src/popup/index.html
// depending on Vite output. The fixture must verify which path exists.
await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`);
```

**Path verification:** The global setup verifies that `apps/extension/dist/popup/index.html` exists after build. If the path differs (e.g., `dist/src/popup/index.html`), the fixture adjusts accordingly. This is validated during the interactive verification phase before writing spec files.

### URL Auto-Fill Testing

For tests that verify URL auto-fill on AddItemScreen:

1. Navigate to a known URL (e.g., `https://github.com`) in the main tab
2. Open popup in a new tab
3. Click "+" to add credential
4. Verify URL field is pre-filled and name shows "github"

## 3. Desktop Test Setup

### Tauri WebDriver (requires spike)

Tauri provides `tauri-driver` which exposes a WebDriver endpoint. The plan is to connect Playwright via CDP, but **this connection method needs a proof-of-concept spike** during Phase 1 interactive verification, because `tauri-driver` exposes WebDriver protocol, not CDP directly.

**Primary approach:**

```typescript
// 1. Start tauri-driver on port 4444
// 2. Create WebDriver session (launches the Tauri app)
// 3. Connect Playwright via CDP (if tauri-driver exposes CDP)
const browser = await chromium.connectOverCDP('http://localhost:4444');
const page = browser.contexts()[0].pages()[0];
```

**Fallback approach (if CDP doesn't work):**
Test the desktop app's React frontend directly via the Vite dev server on `http://localhost:1420`. This covers all UI flows but misses Tauri-specific features (file I/O, keyring). The Vite dev server is started by `pnpm --filter @keykeykey/desktop dev`.

```typescript
// Fallback: test React frontend via Vite dev server
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:1420');
```

The spike during Phase 1 will determine which approach to use. Both are supported in the fixture code, selected via a config flag.

### Fixture

- `globalSetup`: builds all packages. For primary approach: builds Tauri binary (`cargo build` in `src-tauri/`), starts `tauri-driver` on port 4444. For fallback: starts Vite dev server on port 1420.
- `globalTeardown`: kills `tauri-driver` or Vite dev server process
- Each test gets a fresh page. For primary: launches a new WebDriver session. For fallback: navigates to `localhost:1420`.
- After each test, state is cleared (localStorage, sessionStorage)

### Prerequisites

- **Primary:** Rust toolchain, `tauri-driver` (`cargo install tauri-driver`), `libwebkit2gtk-4.1-dev` + `libappindicator3-dev` + `librsvg2-dev` on Ubuntu
- **Fallback:** None beyond Node.js (Vite dev server runs without Rust)
- Playwright config marks desktop project as optional — skipped if prerequisites unavailable
- Desktop project uses `timeout: 60000` (longer for Tauri startup)

## 4. Test Coverage Matrix

| Test File               | Tag                       | Flows                                                                                      | Key Assertions                                                                         |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `setup-vault.spec.ts`   | `@critical`               | Create vault, view recovery key, confirm, land on empty vault                              | Password validation (min 8, match), recovery key in monospace, checkbox gates continue |
| `unlock.spec.ts`        | `@critical` + `@settings` | Lock, unlock with password, wrong password error, PIN setup, PIN unlock, PIN lockout       | Status transitions, error messages, PIN dots, attempts display                         |
| `vault-crud.spec.ts`    | `@critical` + `@crud`     | Add credential (URL auto-fill on extension), add card, add note, view detail, edit, delete | Fields persist, validation, detail shows all fields, delete confirmation               |
| `search-filter.spec.ts` | `@crud`                   | Search by name/username, filter chips, empty state, clear search                           | Result count, filter highlights, empty message, clear button                           |
| `generator.spec.ts`     | `@settings`               | Random password, length slider, char toggles, passphrase, word count, copy                 | Length matches, entropy updates, strength label, copy feedback                         |
| `settings.spec.ts`      | `@settings`               | Theme toggle, auto-lock mode, lock from settings                                           | Background color changes, settings persist across lock/unlock                          |
| `clipboard.spec.ts`     | `@crud` (extension only)  | Copy username, copy password, "Copied!" feedback                                           | Feedback text appears/disappears                                                       |

### Platform Differences

- **Extension only:** clipboard tests, URL auto-fill from active tab
- **Desktop only:** no clipboard test (Tauri native clipboard not accessible via WebDriver), no URL auto-fill

## 5. Playwright Config

```typescript
// playwright.config.ts
export default defineConfig({
  timeout: 30_000, // 30s default per test
  retries: process.env.CI ? 2 : 0, // retry on CI (flaky E2E), no retry locally
  use: {
    trace: 'on-first-retry', // capture trace on retry for debugging
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'extension',
      testDir: './extension',
      use: {
        /* extension fixture */
      },
    },
    {
      name: 'desktop',
      testDir: './desktop',
      timeout: 60_000, // longer for Tauri startup
      use: {
        /* desktop fixture */
      },
    },
  ],
});
```

## 6. Interactive Verification Strategy

Before writing spec files, the Playwright MCP is used interactively to verify the extension works and capture the exact popup URL path, selectors, and timings.

### Verification checklist

- [ ] Extension builds successfully (`pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/extension build`)
- [ ] Popup URL path confirmed (check `dist/` structure for correct HTML path)
- [ ] SetupScreen renders — password fields visible, validation works
- [ ] RecoveryKeyScreen renders — key displayed in monospace, checkbox gates continue
- [ ] VaultListScreen renders — empty state shown
- [ ] Lock → UnlockScreen renders — password field, unlock succeeds
- [ ] Add credential — form renders, save works, item appears in list
- [ ] Search — typing filters items
- [ ] View detail — all fields shown, copy buttons work
- [ ] Edit — form pre-filled, save updates item
- [ ] Delete — confirmation dialog, item removed
- [ ] PIN setup — PIN pad renders, PIN is set
- [ ] PIN unlock — lock, switch to PIN mode, unlock with PIN
- [ ] Generator — random/passphrase toggle, options, entropy display
- [ ] Settings — theme toggle changes colors, lock button works
- [ ] Filter chips — All/Logins/Cards/Notes filter the list
- [ ] Desktop spike — attempt `tauri-driver` + CDP, determine primary vs fallback

After all checks pass, automated spec files are written using the exact selectors and patterns observed.

## 6. Test Tagging & CI

### Tags

- `@critical` — core vault flows (setup, unlock, add, search). Run in CI.
- `@crud` — CRUD operations (edit, delete, cards, notes, clipboard).
- `@settings` — theme, PIN, auto-lock, generator.

### Tag semantics

- `@critical` — must-pass flows for a working credential manager: setup vault, unlock, add credential, search. Time budget: <30s per test. Run on every PR.
- `@crud` — full CRUD coverage. May be slower. Run locally before pushing + nightly on main.
- `@settings` — theme, PIN, auto-lock, generator. Run locally before pushing + nightly on main.

### CI Jobs (non-blocking)

```yaml
e2e-extension:
  name: E2E Extension (critical)
  runs-on: ubuntu-latest
  continue-on-error: true
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @keykeykey/core --filter @keykeykey/ui build
    - run: pnpm --filter @keykeykey/extension build
    - run: cd e2e && npx playwright install chromium --with-deps
    - run: cd e2e && xvfb-run npx playwright test --project=extension --grep @critical
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: e2e-extension-artifacts
        path: e2e/test-results/

e2e-desktop:
  name: E2E Desktop (critical)
  runs-on: ubuntu-latest
  continue-on-error: true
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - uses: dtolnay/rust-toolchain@stable
    - run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
    - run: cargo install tauri-driver
    - run: pnpm install --frozen-lockfile
    - run: pnpm build
    - run: cd apps/desktop/src-tauri && cargo build
    - run: cd e2e && npx playwright install chromium --with-deps
    - run: cd e2e && xvfb-run npx playwright test --project=desktop --grep @critical
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: e2e-desktop-artifacts
        path: e2e/test-results/
```

Both jobs:

- Use `continue-on-error: true` — non-blocking, won't fail the pipeline
- Upload Playwright traces, screenshots, and videos as artifacts on failure
- Run only `@critical` tagged tests for speed
- Desktop job installs Rust toolchain + system deps for WebKit2GTK

### CLAUDE.md Update

Add E2E commands and the instruction to always run before pushing:

```bash
# E2E tests (always run before pushing)
pnpm --filter e2e test                          # all tests
pnpm --filter e2e test -- --grep @critical      # critical only
pnpm --filter e2e test -- --project=extension   # extension only
pnpm --filter e2e test -- --project=desktop     # desktop only
```

## 7. Execution Order

1. **Phase 1: Interactive verification** — use Playwright MCP to verify extension works e2e
2. **Phase 2: Extension spec files** — write automated tests for all extension flows
3. **Phase 3: Desktop spec files** — write automated tests for desktop flows
4. **Phase 4: CI integration** — add non-blocking E2E jobs to GitHub Actions
5. **Phase 5: CLAUDE.md update** — document E2E commands and pre-push requirement
