# Playwright E2E Testing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright E2E tests for the browser extension and desktop app, with test tagging (@critical, @crud, @settings), non-blocking CI jobs, and CLAUDE.md documentation.

**Architecture:** A top-level `e2e/` directory with its own `package.json` for `@playwright/test`. Extension tests use Chromium's `--load-extension` flag to load the built extension, then navigate to `chrome-extension://<id>/src/popup/index.html`. Desktop tests connect to the Vite dev server at `localhost:1420`. Both projects share a Playwright config with retries on CI and trace/screenshot capture on failure.

**Tech Stack:** `@playwright/test`, Chromium (extension loading), Vite dev server (desktop fallback)

**Spec:** `docs/superpowers/specs/2026-03-14-playwright-e2e-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `e2e/package.json` | @playwright/test dependency |
| `e2e/tsconfig.json` | TypeScript config for E2E |
| `e2e/playwright.config.ts` | Two projects: extension + desktop |
| `e2e/fixtures/extension.ts` | Custom fixture: load extension in Chromium, get popup page |
| `e2e/fixtures/desktop.ts` | Custom fixture: connect to Vite dev server |
| `e2e/extension/setup-vault.spec.ts` | Setup → recovery key flow |
| `e2e/extension/unlock.spec.ts` | Password + PIN unlock |
| `e2e/extension/vault-crud.spec.ts` | Add/edit/delete credential, card, note |
| `e2e/extension/search-filter.spec.ts` | Search, filter chips |
| `e2e/extension/generator.spec.ts` | Password generator |
| `e2e/extension/settings.spec.ts` | Theme, lock from settings |
| `e2e/desktop/setup-vault.spec.ts` | Desktop setup flow |
| `e2e/desktop/unlock.spec.ts` | Desktop unlock flow |
| `e2e/desktop/vault-crud.spec.ts` | Desktop CRUD |

### Modified files

| File | Changes |
|------|---------|
| `apps/extension/vite.config.ts` | Add vite-plugin-static-copy to copy manifest.json to dist |
| `CLAUDE.md` | Add E2E commands and pre-push instruction |
| `.github/workflows/ci.yml` | Add non-blocking E2E CI jobs |

---

## Chunk 1: E2E Infrastructure

### Task 1: Set up e2e package and Playwright config

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/tsconfig.json`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/fixtures/extension.ts`
- Create: `e2e/fixtures/desktop.ts`

- [ ] **Step 1: Create e2e/package.json**

```json
{
  "name": "e2e",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:extension": "playwright test --project=extension",
    "test:desktop": "playwright test --project=desktop",
    "test:critical": "playwright test --grep @critical"
  },
  "devDependencies": {
    "@playwright/test": "^1.50.0"
  }
}
```

- [ ] **Step 2: Create e2e/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Create extension fixture**

Create `e2e/fixtures/extension.ts`:

```typescript
import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../apps/extension/dist');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  popup: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    // Wait for service worker to register
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }
    const extensionId = serviceWorker.url().split('/')[2]!;
    await use(extensionId);
  },
  popup: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await page.waitForLoadState('networkidle');
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
```

- [ ] **Step 4: Create desktop fixture**

Create `e2e/fixtures/desktop.ts`:

```typescript
import { test as base, type Page } from '@playwright/test';

const DESKTOP_URL = 'http://localhost:1420';

export const test = base.extend<{
  app: Page;
}>({
  app: async ({ page }, use) => {
    await page.goto(DESKTOP_URL);
    await page.waitForLoadState('networkidle');
    await use(page);
  },
});

export { expect } from '@playwright/test';
```

- [ ] **Step 5: Create Playwright config**

Create `e2e/playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'extension',
      testDir: './extension',
    },
    {
      name: 'desktop',
      testDir: './desktop',
      timeout: 60_000,
    },
  ],
});
```

- [ ] **Step 6: Fix extension build — copy manifest.json to dist**

The Vite build doesn't copy `manifest.json` to `dist/`. Add a Vite plugin to `apps/extension/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// Plugin to copy manifest.json and handle static files
const copyManifest = () => ({
  name: 'copy-manifest',
  closeBundle() {
    copyFileSync(
      resolve(__dirname, 'manifest.json'),
      resolve(__dirname, 'dist/manifest.json'),
    );
  },
});

export default defineConfig({
  plugins: [react(), copyManifest()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: 'src/popup/index.html',
        background: 'src/background/index.ts',
        offscreen: 'src/offscreen/clipboard-clear.html',
      },
      output: {
        entryFileNames: '[name]/index.js',
      },
    },
  },
});
```

- [ ] **Step 7: Install dependencies and verify**

```bash
cd /Users/davidneto/keykeykey/e2e && npm install
cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core --filter @keykeykey/ui build
pnpm --filter @keykeykey/extension build
ls apps/extension/dist/manifest.json  # should exist now
```

- [ ] **Step 8: Commit**

```bash
git add e2e/ apps/extension/vite.config.ts
git commit -m "feat(e2e): set up Playwright infrastructure with extension and desktop fixtures"
```

---

## Chunk 2: Extension E2E Tests

### Task 2: Write extension E2E test specs

**Files:**
- Create: `e2e/extension/setup-vault.spec.ts`
- Create: `e2e/extension/unlock.spec.ts`
- Create: `e2e/extension/vault-crud.spec.ts`
- Create: `e2e/extension/search-filter.spec.ts`
- Create: `e2e/extension/generator.spec.ts`
- Create: `e2e/extension/settings.spec.ts`

All tests import from `../fixtures/extension.ts` and use the `popup` fixture page.

Key patterns:
- Tests are tagged with `@critical`, `@crud`, or `@settings` in their title
- Each test file has a `test.describe` block
- Setup flow is extracted into a helper (`setupVault(popup, password)`) reused across files
- Assertions use Playwright's `expect(locator).toBeVisible()`, `toHaveText()`, etc.
- Use `popup.getByRole()`, `popup.getByPlaceholder()`, `popup.getByText()` for resilient selectors

Example setup-vault.spec.ts:

```typescript
import { test, expect } from '../fixtures/extension.js';

test.describe('Setup Vault', () => {
  test('should create a vault and show recovery key @critical', async ({ popup }) => {
    // Should start on setup screen
    await expect(popup.getByText('Create New Vault')).toBeVisible();

    // Fill password fields
    await popup.getByPlaceholder('Master password').fill('TestPassword123!');
    await popup.getByPlaceholder('Confirm password').fill('TestPassword123!');

    // Create vault
    await popup.getByRole('button', { name: /create vault/i }).click();

    // Should show recovery key screen
    await expect(popup.getByText(/recovery key/i)).toBeVisible({ timeout: 15000 });

    // Check the confirmation checkbox and continue
    await popup.getByRole('checkbox').check();
    await popup.getByRole('button', { name: /continue/i }).click();

    // Should land on vault list (empty state)
    await expect(popup.getByText(/no items/i)).toBeVisible();
  });

  test('should validate password length @critical', async ({ popup }) => {
    await popup.getByPlaceholder('Master password').fill('short');
    await popup.getByPlaceholder('Confirm password').fill('short');
    const createButton = popup.getByRole('button', { name: /create vault/i });
    await expect(createButton).toBeDisabled();
  });
});
```

The implementer should write similar specs for:
- **unlock.spec.ts**: Lock → unlock with password, wrong password error, PIN setup + unlock (tagged @critical + @settings)
- **vault-crud.spec.ts**: Add credential, view detail, edit, delete with confirmation (tagged @critical + @crud)
- **search-filter.spec.ts**: Search by name, filter chips (tagged @crud)
- **generator.spec.ts**: Random/passphrase toggle, copy (tagged @settings)
- **settings.spec.ts**: Theme toggle, lock from settings (tagged @settings)

Each spec reuses a `setupAndUnlock(popup)` helper that creates a vault with a known password and returns to the list screen.

- [ ] **Step 1: Write all 6 extension spec files**
- [ ] **Step 2: Run extension tests**

```bash
cd /Users/davidneto/keykeykey/e2e && npx playwright test --project=extension
```

- [ ] **Step 3: Fix any failing tests and iterate**
- [ ] **Step 4: Commit**

```bash
git add e2e/extension/
git commit -m "feat(e2e): add extension E2E tests for all vault flows"
```

---

## Chunk 3: Desktop E2E Tests

### Task 3: Write desktop E2E test specs

**Files:**
- Create: `e2e/desktop/setup-vault.spec.ts`
- Create: `e2e/desktop/unlock.spec.ts`
- Create: `e2e/desktop/vault-crud.spec.ts`

Desktop tests use the `app` fixture page (connected to `localhost:1420`). They test the same core flows but with the desktop UI layout (sidebar navigation, different screen structure).

**Prerequisite:** Desktop Vite dev server must be running: `pnpm --filter @keykeykey/desktop dev`

Desktop tests follow the same pattern but:
- Navigation uses sidebar links instead of popup state machine
- Setup/unlock screens are the same React components
- Assertions adapt to desktop layout (wider screens, sidebar)

- [ ] **Step 1: Write 3 desktop spec files**
- [ ] **Step 2: Start desktop dev server and run tests**

```bash
# Terminal 1:
pnpm --filter @keykeykey/desktop dev

# Terminal 2:
cd e2e && npx playwright test --project=desktop
```

- [ ] **Step 3: Commit**

```bash
git add e2e/desktop/
git commit -m "feat(e2e): add desktop E2E tests for setup, unlock, and CRUD"
```

---

## Chunk 4: CI Integration & CLAUDE.md

### Task 4: Add CI jobs and documentation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add E2E CI jobs to ci.yml**

Add two new jobs after the existing test jobs, both with `continue-on-error: true`:

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
      - run: cd e2e && npm ci && npx playwright install chromium --with-deps
      - run: cd e2e && xvfb-run npx playwright test --project=extension --grep @critical
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-extension-results
          path: e2e/test-results/
```

- [ ] **Step 2: Update CLAUDE.md**

Add to the Commands section:

```markdown
## E2E Tests

**Important:** Always run E2E critical tests before pushing.

```bash
# Run all E2E tests (requires extension build + desktop dev server)
cd e2e && npx playwright test

# Run critical tests only (CI runs these)
cd e2e && npx playwright test --grep @critical

# Run extension tests only
cd e2e && npx playwright test --project=extension

# Run desktop tests only (requires: pnpm --filter @keykeykey/desktop dev)
cd e2e && npx playwright test --project=desktop
```
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml CLAUDE.md
git commit -m "feat(e2e): add non-blocking CI jobs and update CLAUDE.md with E2E instructions"
```
