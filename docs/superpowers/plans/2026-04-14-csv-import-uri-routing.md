# CSV Import: Route URIs to `url` vs `appIdentifiers` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When importing a CSV, split each raw URI field on intent — real URLs go to `Credential.url`, app identifiers (Android/iOS) go to `Credential.appIdentifiers`, unclassifiable strings are dropped so the parent credential still imports. Fix the user-visible bug where one schemeless URL in a Bitwarden export produces a raw Zod `.issues` JSON dump and aborts the whole 489-row import.

**Architecture:** Introduce a single `classifyUri()` helper in `packages/core/src/import/classify-uri.ts` that returns a tagged union `{ kind: 'url' | 'appIdentifier' | 'drop', value? }`. Each of the six source parsers calls it and routes the result into the IR's `url: string` or the new `appIdentifiers: string[]` field. The `toVaultItems` mapper forwards both fields. `ImportScreen.tsx` gets a `formatImportError()` helper that duck-types `ZodError` and renders a friendly message instead of the raw issues JSON.

**Tech Stack:** TypeScript 5.7, Vitest 3.x for tests, Zod for schema validation. Node 22+. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-04-14-csv-import-uri-routing-design.md`

---

## File structure

**Create:**

- `packages/core/src/import/classify-uri.ts` — the helper
- `packages/core/src/import/classify-uri.test.ts` — helper tests

**Modify:**

- `packages/core/src/import/types.ts` — add `appIdentifiers: string[]` to `ImportedCredential`
- `packages/core/src/import/sources/bitwarden.ts` — wire `classifyUri`, remove local `normalizeUrl`
- `packages/core/src/import/sources/chrome.ts` — same
- `packages/core/src/import/sources/firefox.ts` — same
- `packages/core/src/import/sources/icloud.ts` — same
- `packages/core/src/import/sources/onepassword.ts` — same
- `packages/core/src/import/sources/keykeykey.ts` — call `classifyUri` on the `url` column (no local `normalizeUrl` existed)
- `packages/core/src/import/importer.ts` — forward `appIdentifiers` in `toVaultItems`
- `packages/core/src/import/sources/bitwarden.test.ts` — add androidapp://, iosapp://, schemeless rows
- `packages/core/src/import/sources/chrome.test.ts` — update the android:// assertion
- `packages/core/src/import/importer.test.ts` — add end-to-end Zod-parse regression test
- `apps/desktop/src/screens/ImportScreen.tsx` — add `formatImportError`, wire into 4 catch blocks

---

## Task 1: Add `classifyUri` helper (TDD)

**Files:**

- Create: `packages/core/src/import/classify-uri.ts`
- Create: `packages/core/src/import/classify-uri.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/core/src/import/classify-uri.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyUri } from './classify-uri.js';

describe('classifyUri', () => {
  describe('drop', () => {
    it('drops empty string', () => {
      expect(classifyUri('')).toEqual({ kind: 'drop' });
    });

    it('drops whitespace-only string', () => {
      expect(classifyUri('   \t\n  ')).toEqual({ kind: 'drop' });
    });

    it('drops unknown custom schemes', () => {
      expect(classifyUri('chrome-extension://abcdef/')).toEqual({ kind: 'drop' });
      expect(classifyUri('file:///etc/passwd')).toEqual({ kind: 'drop' });
      expect(classifyUri('javascript:alert(1)')).toEqual({ kind: 'drop' });
    });

    it('drops strings that cannot be parsed as a URL even with https:// prefix', () => {
      expect(classifyUri('not a url at all')).toEqual({ kind: 'drop' });
    });

    it('drops app URIs whose extracted id fails the reverse-DNS regex', () => {
      expect(classifyUri('androidapp://has-hyphens/')).toEqual({ kind: 'drop' });
      expect(classifyUri('androidapp://singleword/')).toEqual({ kind: 'drop' });
    });
  });

  describe('appIdentifier', () => {
    it('extracts the package from androidapp:// (Bitwarden mobile)', () => {
      expect(classifyUri('androidapp://com.tesla.TeslaApp/')).toEqual({
        kind: 'appIdentifier',
        value: 'com.tesla.teslaapp',
      });
    });

    it('handles androidapp:// without trailing slash', () => {
      expect(classifyUri('androidapp://com.example.app')).toEqual({
        kind: 'appIdentifier',
        value: 'com.example.app',
      });
    });

    it('extracts the package from android://<hash>@<pkg>/ (Chrome sync format)', () => {
      expect(classifyUri('android://RkThcH70DgO3VqLlhDCC7x@net.skyscanner.android.main/')).toEqual({
        kind: 'appIdentifier',
        value: 'net.skyscanner.android.main',
      });
    });

    it('extracts the bundle id from iosapp://', () => {
      expect(classifyUri('iosapp://com.apple.mobilesafari')).toEqual({
        kind: 'appIdentifier',
        value: 'com.apple.mobilesafari',
      });
    });

    it('extracts the bundle id from ios://', () => {
      expect(classifyUri('ios://com.example.notes')).toEqual({
        kind: 'appIdentifier',
        value: 'com.example.notes',
      });
    });

    it('lowercases extracted identifiers (schema stores them lowercased)', () => {
      expect(classifyUri('androidapp://Com.Example.App/')).toEqual({
        kind: 'appIdentifier',
        value: 'com.example.app',
      });
    });
  });

  describe('url', () => {
    it('keeps https URLs and strips query/hash', () => {
      expect(classifyUri('https://foo.com/path?q=1#frag')).toEqual({
        kind: 'url',
        value: 'https://foo.com/path',
      });
    });

    it('keeps http URLs and drops a bare trailing slash', () => {
      expect(classifyUri('http://foo.com/')).toEqual({ kind: 'url', value: 'http://foo.com' });
    });

    it('preserves paths other than bare /', () => {
      expect(classifyUri('https://foo.com/login')).toEqual({
        kind: 'url',
        value: 'https://foo.com/login',
      });
    });

    it('prepends https:// to schemeless hostnames (regression: bug fix)', () => {
      expect(classifyUri('foo.com')).toEqual({ kind: 'url', value: 'https://foo.com' });
    });

    it('prepends https:// to schemeless hostnames with paths', () => {
      expect(classifyUri('foo.com/login')).toEqual({
        kind: 'url',
        value: 'https://foo.com/login',
      });
    });

    it('handles IP addresses with http:// scheme', () => {
      expect(classifyUri('http://192.168.1.1')).toEqual({
        kind: 'url',
        value: 'http://192.168.1.1',
      });
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @keykeykey/core test -- --run classify-uri`

Expected: FAIL — "Cannot find module './classify-uri.js'" or similar.

- [ ] **Step 3: Implement `classifyUri`**

Create `packages/core/src/import/classify-uri.ts`:

```ts
/**
 * Tagged union describing how an imported URI should be stored on a credential.
 */
export type UriClassification =
  | { kind: 'url'; value: string }
  | { kind: 'appIdentifier'; value: string }
  | { kind: 'drop' };

/**
 * Route a raw URI string from a CSV import into one of three buckets:
 *  - `url`           — a normalized http/https URL suitable for `Credential.url`
 *  - `appIdentifier` — a lowercased reverse-DNS string suitable for
 *                      `Credential.appIdentifiers`, extracted from app URIs
 *                      like `androidapp://com.example.app/`,
 *                      `android://<hash>@com.example.app/`,
 *                      `iosapp://com.example.app`, or `ios://com.example.app`
 *  - `drop`          — empty, unparseable, or uses an unrecognized scheme
 *
 * Detection is scheme-based: we do NOT try to guess whether a schemeless
 * string like `com.example.app` is a package name or a 2-label domain —
 * the reverse-DNS regex cannot distinguish them (`foo.com` matches too).
 * Schemeless inputs are always treated as URLs and get `https://` prepended.
 */
export function classifyUri(raw: string): UriClassification {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'drop' };

  const appId = extractAppIdentifier(trimmed);
  if (appId !== null) {
    return APP_ID_REGEX.test(appId) ? { kind: 'appIdentifier', value: appId } : { kind: 'drop' };
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const path = parsed.pathname === '/' ? '' : parsed.pathname;
      return { kind: 'url', value: `${parsed.protocol}//${parsed.hostname}${path}` };
    }
    return { kind: 'drop' };
  } catch {
    return { kind: 'drop' };
  }
}

/** Schema stores appIdentifiers lowercased and validated against this regex. */
const APP_ID_REGEX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** Return the (lowercased) package/bundle id from a recognized app URI, or null. */
function extractAppIdentifier(uri: string): string | null {
  const android = uri.match(/^androidapp:\/\/([^/]+)\/?.*$/i);
  if (android?.[1]) return android[1].toLowerCase();

  // Chrome sync format: android://<base64ish-hash>@<package>/...
  const chromeAndroid = uri.match(/^android:\/\/[^@]+@([^/]+)\/?.*$/i);
  if (chromeAndroid?.[1]) return chromeAndroid[1].toLowerCase();

  const ios = uri.match(/^(?:iosapp|ios):\/\/([^/?#]+)\/?.*$/i);
  if (ios?.[1]) return ios[1].toLowerCase();

  return null;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @keykeykey/core test -- --run classify-uri`

Expected: PASS — all 17 tests in `classify-uri.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/import/classify-uri.ts packages/core/src/import/classify-uri.test.ts
git commit -m "feat(core/import): add classifyUri helper for URI routing"
```

---

## Task 2: Extend `ImportedCredential` IR

**Files:**

- Modify: `packages/core/src/import/types.ts`
- Modify: `packages/core/src/import/sources/{bitwarden,chrome,firefox,icloud,onepassword,keykeykey}.ts`
- Modify: `packages/core/src/import/importer.test.ts`

- [ ] **Step 1: Add the new field to the IR**

In `packages/core/src/import/types.ts`, replace the `ImportedCredential` interface:

```ts
export interface ImportedCredential {
  name: string;
  url: string;
  /**
   * Reverse-DNS app identifiers extracted from app URIs
   * (androidapp://…, iosapp://…). Always present; empty when none.
   */
  appIdentifiers: string[];
  username: string;
  password: string;
  notes: string;
  totp: string;
  /** Original folder/group from the source, if available. */
  folder: string;
  /** Whether the item was marked as favorite in the source. */
  favorite: boolean;
}
```

- [ ] **Step 2: Add `appIdentifiers: []` to every `items.push({...})` in every parser**

This is a purely structural change — no routing yet. Each parser keeps its existing URL logic for this task; we just satisfy the new required field with an empty array.

In `packages/core/src/import/sources/bitwarden.ts` — find the `items.push({...})` call and add `appIdentifiers: [],` after `url: normalizeUrl(rawUri),`:

```ts
items.push({
  name: col(row, 'name') || deriveNameFromUrl(rawUri),
  url: normalizeUrl(rawUri),
  appIdentifiers: [],
  username,
  password,
  notes: col(row, 'notes'),
  totp: col(row, 'login_totp'),
  folder: col(row, 'folder'),
  favorite,
});
```

In `packages/core/src/import/sources/chrome.ts` — same pattern:

```ts
items.push({
  name: rawName || deriveNameFromUrl(rawUrl),
  url: normalizeUrl(rawUrl),
  appIdentifiers: [],
  username,
  password,
  notes: col(row, 'note'),
  totp: '',
  folder: '',
  favorite: false,
});
```

In `packages/core/src/import/sources/firefox.ts`:

```ts
items.push({
  name: deriveNameFromUrl(url),
  url: normalizeUrl(url),
  appIdentifiers: [],
  username,
  password,
  notes: '',
  totp: '',
  folder: '',
  favorite: false,
});
```

In `packages/core/src/import/sources/icloud.ts`:

```ts
items.push({
  name: title || deriveNameFromUrl(rawUrl),
  url: normalizeUrl(rawUrl),
  appIdentifiers: [],
  username,
  password,
  notes: col(row, 'notes'),
  totp: col(row, 'otpauth'),
  folder: '',
  favorite: false,
});
```

In `packages/core/src/import/sources/onepassword.ts`:

```ts
items.push({
  name: deriveNameFromUrl(title) || deriveNameFromUrl(urlOrNotes),
  url: normalizeUrl(url),
  appIdentifiers: [],
  username,
  password,
  notes: '',
  totp: '',
  folder: '',
  favorite: false,
});
```

In `packages/core/src/import/sources/keykeykey.ts`:

```ts
items.push({
  name: col(row, 'name') || 'Unnamed',
  url: col(row, 'url'),
  appIdentifiers: [],
  username,
  password,
  notes: col(row, 'notes'),
  totp: col(row, 'totp'),
  folder: col(row, 'folder'),
  favorite: col(row, 'favorite').toLowerCase() === 'true',
});
```

- [ ] **Step 3: Also update the inline `ImportedCredential[]` literals used in `importer.test.ts`**

Open `packages/core/src/import/importer.test.ts` and add `appIdentifiers: [],` to each of the five inline `ImportedCredential` test fixtures inside `describe('toVaultItems', ...)`. Search for `folder: ''` or `folder: 'Work'` to find them; each fixture becomes, for example:

```ts
const creds: ImportedCredential[] = [
  {
    name: 'Test Site',
    url: 'https://test.com',
    appIdentifiers: [],
    username: 'user',
    password: 'pass',
    notes: 'A note',
    totp: 'otpauth://totp/Test',
    folder: '',
    favorite: false,
  },
];
```

- [ ] **Step 4: Run the core test suite — everything should still pass**

Run: `pnpm --filter @keykeykey/core test -- --run import`

Expected: PASS — all existing import tests still pass. No behavior change yet, just a structural field addition.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/import/types.ts packages/core/src/import/sources packages/core/src/import/importer.test.ts
git commit -m "refactor(core/import): add appIdentifiers field to ImportedCredential IR"
```

---

## Task 3: Route Bitwarden URIs via `classifyUri` (TDD)

**Files:**

- Modify: `packages/core/src/import/sources/bitwarden.ts`
- Modify: `packages/core/src/import/sources/bitwarden.test.ts`

- [ ] **Step 1: Extend the Bitwarden test CSV with rows that exercise the new routing**

In `packages/core/src/import/sources/bitwarden.test.ts`, replace the `BITWARDEN_CSV` constant with the extended version below (three new rows added before the `note`/`card` rows):

```ts
const BITWARDEN_CSV = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
,,login,1password,A3-RECOVERY-KEY,,0,,user@email.com,pass1,
,,login,9gag.com,,,0,https://9gag.com/,user@email.com,pass2,
,,login,account.acer.com,,,0,https://account.acer.com/sso/signin,user@email.com,pass3,
,,login,account.dji.com,,,0,https://account.dji.com/login?appId=my-store-be&backUrl=https%3A%2F%2Fmy.dji.com%2F&locale=en_US,user@email.com,pass4,
MIC,,login,account.jetbrains.com,,,0,https://account.jetbrains.com/licenses,mic-user,pass5,
,,login,account.jetbrains.com,,,0,https://account.jetbrains.com/login,other-user,pass6,
,,login,with-totp,,,0,https://totp-site.com,totpuser,totppass,otpauth://totp/Example:user?secret=JBSWY3DPEHPK3PXP
,1,login,favorite-item,,,0,https://fav.com,favuser,favpass,
,,login,schemeless-host,,,0,schemeless.example.com,schemeless-user,schemeless-pass,
,,login,android-app,,,0,androidapp://com.tesla.TeslaApp/,app-user,app-pass,
,,login,ios-app,,,0,iosapp://com.apple.notes,ios-user,ios-pass,
,,note,My Secure Note,This is secret,,0,,,,
,,card,My Credit Card,,,0,,,,
`;
```

Then update the existing count assertion and add three new assertions. In the `describe('Bitwarden CSV importer', ...)` block:

Replace:

```ts
it('imports only login type entries', () => {
  const { items } = parseBitwardenCsv(BITWARDEN_CSV);
  // 8 login rows in total
  expect(items.length).toBe(8);
});
```

With:

```ts
it('imports only login type entries', () => {
  const { items } = parseBitwardenCsv(BITWARDEN_CSV);
  // 11 login rows in total (8 original + 3 routing-regression rows)
  expect(items.length).toBe(11);
});

it('normalizes schemeless hostnames by prepending https:// (regression)', () => {
  const { items } = parseBitwardenCsv(BITWARDEN_CSV);
  const row = items.find((i) => i.name === 'schemeless-host');
  expect(row?.url).toBe('https://schemeless.example.com');
  expect(row?.appIdentifiers).toEqual([]);
});

it('routes androidapp:// URIs to appIdentifiers (not url)', () => {
  const { items } = parseBitwardenCsv(BITWARDEN_CSV);
  const row = items.find((i) => i.name === 'android-app');
  expect(row?.url).toBe('');
  expect(row?.appIdentifiers).toEqual(['com.tesla.teslaapp']);
});

it('routes iosapp:// URIs to appIdentifiers (not url)', () => {
  const { items } = parseBitwardenCsv(BITWARDEN_CSV);
  const row = items.find((i) => i.name === 'ios-app');
  expect(row?.url).toBe('');
  expect(row?.appIdentifiers).toEqual(['com.apple.notes']);
});
```

- [ ] **Step 2: Run the Bitwarden tests to confirm they fail**

Run: `pnpm --filter @keykeykey/core test -- --run bitwarden`

Expected: FAIL on the three new assertions. The old `normalizeUrl` returns `'schemeless.example.com'` unchanged (invalid) and keeps `androidapp://…` in `url`. Also the existing `items.length` assertion now passes at 11.

- [ ] **Step 3: Wire `classifyUri` into the Bitwarden parser**

Replace the contents of `packages/core/src/import/sources/bitwarden.ts` with:

```ts
/**
 * Bitwarden password CSV importer.
 *
 * Bitwarden exports:
 * folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
 *
 * Strategy:
 * - Only imports rows with type "login" (skips cards, notes, identity, etc.)
 * - Preserves folder names as tags
 * - Preserves favorite flag (Bitwarden uses 1/0)
 * - Preserves TOTP seeds
 * - Routes `login_uri` via `classifyUri`: real URLs → `url`,
 *   app URIs (androidapp://, iosapp://) → `appIdentifiers`, junk → dropped
 */

import { parseCsv } from '../csv-parser.js';
import { classifyUri } from '../classify-uri.js';
import type { ImportedCredential, SkippedRow } from '../types.js';

const EXPECTED_HEADERS = ['type', 'name', 'login_username', 'login_password'];

export function parseBitwardenCsv(csv: string): {
  items: ImportedCredential[];
  skipped: SkippedRow[];
} {
  const { headers, rows } = parseCsv(csv);
  const items: ImportedCredential[] = [];
  const skipped: SkippedRow[] = [];

  const headerLower = headers.map((h) => h.toLowerCase().trim());
  for (const expected of EXPECTED_HEADERS) {
    if (!headerLower.includes(expected)) {
      throw new Error(
        `Invalid Bitwarden CSV: missing "${expected}" column. Found: ${headers.join(', ')}`,
      );
    }
  }

  const col = (row: string[], name: string) => {
    const idx = headerLower.indexOf(name);
    return idx >= 0 ? (row[idx]?.trim() ?? '') : '';
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const type = col(row, 'type');

    if (type !== 'login') {
      skipped.push({ row: i + 2, reason: `Non-login type: "${type}"` });
      continue;
    }

    const username = col(row, 'login_username');
    const password = col(row, 'login_password');

    if (!username && !password) {
      skipped.push({ row: i + 2, reason: 'No username or password' });
      continue;
    }

    const rawUri = col(row, 'login_uri');
    const classification = classifyUri(rawUri);
    const url = classification.kind === 'url' ? classification.value : '';
    const appIdentifiers = classification.kind === 'appIdentifier' ? [classification.value] : [];

    const favorite = col(row, 'favorite') === '1';

    items.push({
      name: col(row, 'name') || deriveNameFromUrl(rawUri),
      url,
      appIdentifiers,
      username,
      password,
      notes: col(row, 'notes'),
      totp: col(row, 'login_totp'),
      folder: col(row, 'folder'),
      favorite,
    });
  }

  return { items, skipped };
}

function deriveNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url || 'Unnamed';
  }
}
```

- [ ] **Step 4: Run the Bitwarden tests to confirm they pass**

Run: `pnpm --filter @keykeykey/core test -- --run bitwarden`

Expected: PASS — all original tests plus the three new routing assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/import/sources/bitwarden.ts packages/core/src/import/sources/bitwarden.test.ts
git commit -m "fix(core/import): route Bitwarden URIs via classifyUri (fixes schemeless URL bug)"
```

---

## Task 4: Route Chrome URIs via `classifyUri` (TDD)

**Files:**

- Modify: `packages/core/src/import/sources/chrome.ts`
- Modify: `packages/core/src/import/sources/chrome.test.ts`

- [ ] **Step 1: Update the Chrome test — `android://` rows now go to `appIdentifiers`, not to empty string**

In `packages/core/src/import/sources/chrome.test.ts`, replace the `it('strips android:// URLs to empty string', …)` test with a routing assertion:

```ts
it('routes android://<hash>@<pkg>/ to appIdentifiers (not url)', () => {
  const { items } = parseChromeCsv(CHROME_CSV);
  const booking = items.find((i) => i.name === 'Booking.com: Hotels & Travel');
  expect(booking?.url).toBe('');
  expect(booking?.appIdentifiers).toEqual(['com.booking']);

  const insta = items.find((i) => i.name === 'Instagram');
  expect(insta?.url).toBe('');
  expect(insta?.appIdentifiers).toEqual(['com.instagram.android']);

  const sky = items.find((i) => i.name === 'Skyscanner');
  expect(sky?.url).toBe('');
  expect(sky?.appIdentifiers).toEqual(['net.skyscanner.android.main']);
});
```

- [ ] **Step 2: Run the Chrome tests to confirm they fail**

Run: `pnpm --filter @keykeykey/core test -- --run chrome`

Expected: FAIL — the new assertions expect non-empty `appIdentifiers`, but the current parser always returns `[]`.

- [ ] **Step 3: Wire `classifyUri` into the Chrome parser**

Replace the contents of `packages/core/src/import/sources/chrome.ts` with:

```ts
/**
 * Chrome password CSV importer.
 *
 * Chrome exports: name, url, username, password, note
 *
 * Strategy:
 * - Uses `name` directly as the item name (the Chrome export already provides
 *   a friendly name for android:// entries, so we don't need to derive it)
 * - Skips entries with no username AND no password (empty bookmarks)
 * - Routes `url` via `classifyUri`: real URLs → `url`,
 *   `android://<hash>@<pkg>/` → `appIdentifiers`, junk → dropped
 */

import { parseCsv } from '../csv-parser.js';
import { classifyUri } from '../classify-uri.js';
import type { ImportedCredential, SkippedRow } from '../types.js';

const EXPECTED_HEADERS = ['name', 'url', 'username', 'password', 'note'];

export function parseChromeCsv(csv: string): {
  items: ImportedCredential[];
  skipped: SkippedRow[];
} {
  const { headers, rows } = parseCsv(csv);
  const items: ImportedCredential[] = [];
  const skipped: SkippedRow[] = [];

  const headerLower = headers.map((h) => h.toLowerCase().trim());
  for (const expected of EXPECTED_HEADERS) {
    if (!headerLower.includes(expected)) {
      throw new Error(
        `Invalid Chrome CSV: missing "${expected}" column. Found: ${headers.join(', ')}`,
      );
    }
  }

  const col = (row: string[], name: string) => row[headerLower.indexOf(name)]?.trim() ?? '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const username = col(row, 'username');
    const password = col(row, 'password');

    if (!username && !password) {
      skipped.push({ row: i + 2, reason: 'No username or password' });
      continue;
    }

    const rawName = col(row, 'name');
    const rawUrl = col(row, 'url');
    const classification = classifyUri(rawUrl);
    const url = classification.kind === 'url' ? classification.value : '';
    const appIdentifiers = classification.kind === 'appIdentifier' ? [classification.value] : [];

    items.push({
      name: rawName || deriveNameFromUrl(rawUrl),
      url,
      appIdentifiers,
      username,
      password,
      notes: col(row, 'note'),
      totp: '',
      folder: '',
      favorite: false,
    });
  }

  return { items, skipped };
}

/**
 * Extracts a human-readable name from a URL or android:// URI
 * (only used when the CSV `name` column is empty).
 */
function deriveNameFromUrl(url: string): string {
  if (url.startsWith('android://')) {
    const match = url.match(/@([^/]+)/);
    if (match?.[1]) return match[1];
  }
  try {
    return new URL(url).hostname || url;
  } catch {
    return url || 'Unnamed';
  }
}
```

- [ ] **Step 4: Run the Chrome tests to confirm they pass**

Run: `pnpm --filter @keykeykey/core test -- --run chrome`

Expected: PASS — all Chrome tests including the new routing assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/import/sources/chrome.ts packages/core/src/import/sources/chrome.test.ts
git commit -m "fix(core/import): route Chrome android URIs to appIdentifiers"
```

---

## Task 5: Route Firefox / iCloud / 1Password / KeyKeyKey URIs via `classifyUri`

These four parsers currently have no test cases exercising app URIs or schemeless hostnames, and the change is mechanical: replace the local `normalizeUrl` call (or, for KeyKeyKey, the raw `col(row, 'url')`) with `classifyUri` and route. Existing tests must continue to pass.

**Files:**

- Modify: `packages/core/src/import/sources/firefox.ts`
- Modify: `packages/core/src/import/sources/icloud.ts`
- Modify: `packages/core/src/import/sources/onepassword.ts`
- Modify: `packages/core/src/import/sources/keykeykey.ts`

- [ ] **Step 1: Rewrite `firefox.ts`**

Replace the contents of `packages/core/src/import/sources/firefox.ts` with:

```ts
/**
 * Firefox password CSV importer.
 *
 * Firefox exports (quoted fields):
 * "url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"
 *
 * Strategy:
 * - Derives item name from URL hostname
 * - Skips internal Firefox Accounts entries (chrome://FirefoxAccounts)
 * - Skips rows where password looks like a JSON sync blob (Firefox internal)
 * - Routes `url` via `classifyUri`
 */

import { parseCsv } from '../csv-parser.js';
import { classifyUri } from '../classify-uri.js';
import type { ImportedCredential, SkippedRow } from '../types.js';

const EXPECTED_HEADERS = ['url', 'username', 'password'];

export function parseFirefoxCsv(csv: string): {
  items: ImportedCredential[];
  skipped: SkippedRow[];
} {
  const { headers, rows } = parseCsv(csv);
  const items: ImportedCredential[] = [];
  const skipped: SkippedRow[] = [];

  const headerLower = headers.map((h) => h.toLowerCase().trim());
  for (const expected of EXPECTED_HEADERS) {
    if (!headerLower.includes(expected)) {
      throw new Error(
        `Invalid Firefox CSV: missing "${expected}" column. Found: ${headers.join(', ')}`,
      );
    }
  }

  const col = (row: string[], name: string) => row[headerLower.indexOf(name)]?.trim() ?? '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const url = col(row, 'url');
    const username = col(row, 'username');
    const password = col(row, 'password');

    if (url.startsWith('chrome://')) {
      skipped.push({ row: i + 2, reason: 'Internal Firefox entry (chrome:// URL)' });
      continue;
    }

    if (password.startsWith('{') && password.includes('"version"')) {
      skipped.push({ row: i + 2, reason: 'Firefox sync metadata (JSON password)' });
      continue;
    }

    if (!username && !password) {
      skipped.push({ row: i + 2, reason: 'No username or password' });
      continue;
    }

    const classification = classifyUri(url);
    const routedUrl = classification.kind === 'url' ? classification.value : '';
    const appIdentifiers = classification.kind === 'appIdentifier' ? [classification.value] : [];

    items.push({
      name: deriveNameFromUrl(url),
      url: routedUrl,
      appIdentifiers,
      username,
      password,
      notes: '',
      totp: '',
      folder: '',
      favorite: false,
    });
  }

  return { items, skipped };
}

function deriveNameFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname || url;
  } catch {
    return url || 'Unnamed';
  }
}
```

- [ ] **Step 2: Rewrite `icloud.ts`**

Replace the contents of `packages/core/src/import/sources/icloud.ts` with:

```ts
/**
 * iCloud Keychain / Apple Passwords CSV importer.
 *
 * iCloud exports: Title,URL,Username,Password,Notes,OTPAuth
 *
 * Strategy:
 * - Uses Title directly as the item name
 * - Preserves OTPAuth URIs as TOTP seeds
 * - Routes `URL` via `classifyUri`
 */

import { parseCsv } from '../csv-parser.js';
import { classifyUri } from '../classify-uri.js';
import type { ImportedCredential, SkippedRow } from '../types.js';

const EXPECTED_HEADERS = ['title', 'url', 'username', 'password'];

export function parseICloudCsv(csv: string): {
  items: ImportedCredential[];
  skipped: SkippedRow[];
} {
  const { headers, rows } = parseCsv(csv);
  const items: ImportedCredential[] = [];
  const skipped: SkippedRow[] = [];

  const headerLower = headers.map((h) => h.toLowerCase().trim());
  for (const expected of EXPECTED_HEADERS) {
    if (!headerLower.includes(expected)) {
      throw new Error(
        `Invalid iCloud CSV: missing "${expected}" column. Found: ${headers.join(', ')}`,
      );
    }
  }

  const col = (row: string[], name: string) => {
    const idx = headerLower.indexOf(name);
    return idx >= 0 ? (row[idx]?.trim() ?? '') : '';
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const username = col(row, 'username');
    const password = col(row, 'password');

    if (!username && !password) {
      skipped.push({ row: i + 2, reason: 'No username or password' });
      continue;
    }

    const rawUrl = col(row, 'url');
    const title = col(row, 'title');
    const classification = classifyUri(rawUrl);
    const url = classification.kind === 'url' ? classification.value : '';
    const appIdentifiers = classification.kind === 'appIdentifier' ? [classification.value] : [];

    items.push({
      name: title || deriveNameFromUrl(rawUrl),
      url,
      appIdentifiers,
      username,
      password,
      notes: col(row, 'notes'),
      totp: col(row, 'otpauth'),
      folder: '',
      favorite: false,
    });
  }

  return { items, skipped };
}

function deriveNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url || 'Unnamed';
  }
}
```

- [ ] **Step 3: Rewrite `onepassword.ts`**

Replace the contents of `packages/core/src/import/sources/onepassword.ts` with:

```ts
/**
 * 1Password CSV importer (headerless format).
 *
 * 1Password can export without headers. Columns:
 *   [1]: URL or notes/description
 *   [3]: Title (often the URL again for logins)
 *   [4]: Type ("Login", "Identity", …)
 *   [5]: Username
 *   [6]: Password
 *
 * Strategy:
 * - No header row — uses positional column indices
 * - Only imports rows with type "Login" (skips Identity, Credit Card, etc.)
 * - Picks the URL from column 3 (Title) or column 1 (Notes/URL)
 * - Routes via `classifyUri`
 */

import { parseCsv } from '../csv-parser.js';
import { classifyUri } from '../classify-uri.js';
import type { ImportedCredential, SkippedRow } from '../types.js';

const COL = {
  NOTES_OR_URL: 1,
  TITLE: 3,
  TYPE: 4,
  USERNAME: 5,
  PASSWORD: 6,
} as const;

export function parseOnePasswordCsv(csv: string): {
  items: ImportedCredential[];
  skipped: SkippedRow[];
} {
  const { rows } = parseCsv(csv, { hasHeader: false });
  const items: ImportedCredential[] = [];
  const skipped: SkippedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    if (row.length < 7) {
      skipped.push({ row: i + 1, reason: 'Too few columns' });
      continue;
    }

    const type = row[COL.TYPE]?.trim() ?? '';

    if (type !== 'Login') {
      skipped.push({ row: i + 1, reason: `Non-login type: "${type}"` });
      continue;
    }

    const username = row[COL.USERNAME]?.trim() ?? '';
    const password = row[COL.PASSWORD]?.trim() ?? '';

    if (!username && !password) {
      skipped.push({ row: i + 1, reason: 'No username or password' });
      continue;
    }

    const title = row[COL.TITLE]?.trim() ?? '';
    const urlOrNotes = row[COL.NOTES_OR_URL]?.trim() ?? '';
    const raw = isUrl(title) ? title : isUrl(urlOrNotes) ? urlOrNotes : '';

    const classification = classifyUri(raw);
    const url = classification.kind === 'url' ? classification.value : '';
    const appIdentifiers = classification.kind === 'appIdentifier' ? [classification.value] : [];

    items.push({
      name: deriveNameFromUrl(title) || deriveNameFromUrl(urlOrNotes),
      url,
      appIdentifiers,
      username,
      password,
      notes: '',
      totp: '',
      folder: '',
      favorite: false,
    });
  }

  return { items, skipped };
}

function isUrl(s: string): boolean {
  try {
    const parsed = new URL(s);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function deriveNameFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname || url;
  } catch {
    return url || '';
  }
}
```

- [ ] **Step 4: Rewrite `keykeykey.ts`**

Replace the contents of `packages/core/src/import/sources/keykeykey.ts` with:

```ts
/**
 * KeyKeyKey CSV importer.
 *
 * KeyKeyKey exports: name, url, username, password, notes, totp, folder, favorite
 *
 * Strategy:
 * - Direct column mapping — all fields are present
 * - Skips entries with no username AND no password
 * - Parses `favorite` as boolean string ("true"/"false")
 * - Routes `url` via `classifyUri` as a defense-in-depth measure for hand-edited exports
 */

import { parseCsv } from '../csv-parser.js';
import { classifyUri } from '../classify-uri.js';
import type { ImportedCredential, SkippedRow } from '../types.js';

const EXPECTED_HEADERS = [
  'name',
  'url',
  'username',
  'password',
  'notes',
  'totp',
  'folder',
  'favorite',
];

export function parseKeykeykeyCsv(csv: string): {
  items: ImportedCredential[];
  skipped: SkippedRow[];
} {
  const { headers, rows } = parseCsv(csv);
  const items: ImportedCredential[] = [];
  const skipped: SkippedRow[] = [];

  const headerLower = headers.map((h) => h.toLowerCase().trim());
  for (const expected of EXPECTED_HEADERS) {
    if (!headerLower.includes(expected)) {
      throw new Error(
        `Invalid KeyKeyKey CSV: missing "${expected}" column. Found: ${headers.join(', ')}`,
      );
    }
  }

  const col = (row: string[], name: string) => row[headerLower.indexOf(name)]?.trim() ?? '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const username = col(row, 'username');
    const password = col(row, 'password');

    if (!username && !password) {
      skipped.push({ row: i + 2, reason: 'No username or password' });
      continue;
    }

    const classification = classifyUri(col(row, 'url'));
    const url = classification.kind === 'url' ? classification.value : '';
    const appIdentifiers = classification.kind === 'appIdentifier' ? [classification.value] : [];

    items.push({
      name: col(row, 'name') || 'Unnamed',
      url,
      appIdentifiers,
      username,
      password,
      notes: col(row, 'notes'),
      totp: col(row, 'totp'),
      folder: col(row, 'folder'),
      favorite: col(row, 'favorite').toLowerCase() === 'true',
    });
  }

  return { items, skipped };
}
```

- [ ] **Step 5: Run all import tests**

Run: `pnpm --filter @keykeykey/core test -- --run import`

Expected: PASS — every parser test plus `classify-uri.test.ts` plus the importer tests. The existing Firefox assertion `expect(router?.url).toBe('http://192.168.1.2')` continues to pass because `classifyUri` produces the same value from `http://192.168.1.2` (trailing slash removed).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/import/sources/firefox.ts packages/core/src/import/sources/icloud.ts packages/core/src/import/sources/onepassword.ts packages/core/src/import/sources/keykeykey.ts
git commit -m "refactor(core/import): route Firefox/iCloud/1Password/KeyKeyKey URIs via classifyUri"
```

---

## Task 6: Forward `appIdentifiers` in `toVaultItems` (TDD)

**Files:**

- Modify: `packages/core/src/import/importer.ts`
- Modify: `packages/core/src/import/importer.test.ts`

- [ ] **Step 1: Add failing assertions to `toVaultItems` tests**

In `packages/core/src/import/importer.test.ts`, add a new test inside the `describe('toVaultItems', ...)` block (after the existing `'uses undefined for empty optional fields'` test):

```ts
it('forwards non-empty appIdentifiers from the IR', () => {
  const creds: ImportedCredential[] = [
    {
      name: 'App',
      url: '',
      appIdentifiers: ['com.example.app'],
      username: 'user',
      password: 'pass',
      notes: '',
      totp: '',
      folder: '',
      favorite: false,
    },
  ];

  const items = toVaultItems(creds);
  expect(items[0]).toMatchObject({
    type: 'credential',
    name: 'App',
    url: undefined,
    appIdentifiers: ['com.example.app'],
  });
});

it('collapses empty appIdentifiers to undefined', () => {
  const creds: ImportedCredential[] = [
    {
      name: 'Site',
      url: 'https://site.com',
      appIdentifiers: [],
      username: 'user',
      password: 'pass',
      notes: '',
      totp: '',
      folder: '',
      favorite: false,
    },
  ];

  const items = toVaultItems(creds);
  expect(items[0].appIdentifiers).toBeUndefined();
});
```

- [ ] **Step 2: Run the importer tests to confirm they fail**

Run: `pnpm --filter @keykeykey/core test -- --run importer`

Expected: FAIL — `items[0].appIdentifiers` is currently always undefined.

- [ ] **Step 3: Update `toVaultItems` to forward the field**

In `packages/core/src/import/importer.ts`, replace the `toVaultItems` function body:

```ts
export function toVaultItems(
  credentials: ImportedCredential[],
): Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[] {
  return credentials.map((cred) => {
    const tags: string[] = [];
    if (cred.folder) {
      tags.push(cred.folder);
    }

    return {
      type: 'credential' as const,
      name: cred.name || 'Unnamed',
      username: cred.username || '',
      password: cred.password || '',
      url: cred.url || undefined,
      appIdentifiers: cred.appIdentifiers.length > 0 ? cred.appIdentifiers : undefined,
      notes: cred.notes || undefined,
      totp: cred.totp || undefined,
      tags,
      favorite: cred.favorite,
    };
  });
}
```

- [ ] **Step 4: Run the importer tests to confirm they pass**

Run: `pnpm --filter @keykeykey/core test -- --run importer`

Expected: PASS — all existing tests plus the two new assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/import/importer.ts packages/core/src/import/importer.test.ts
git commit -m "feat(core/import): forward appIdentifiers through toVaultItems"
```

---

## Task 7: End-to-end regression test — every source CSV parses under `VaultItemSchema`

This is the guard against the original bug: take the toy CSV literals already used in `importer.test.ts`, extend the Bitwarden one to include the problematic rows, and assert that every resulting item passes `VaultItemSchema.parse` after adding id/timestamps.

**Files:**

- Modify: `packages/core/src/import/importer.test.ts`

- [ ] **Step 1: Add the end-to-end test**

At the bottom of `packages/core/src/import/importer.test.ts`, add:

```ts
import { VaultItemSchema } from '../models/vault-item.js';
import { randomUUID } from 'node:crypto';

describe('regression: every source CSV produces VaultItemSchema-valid items', () => {
  // Bitwarden CSV extended with rows that previously broke the import:
  //  - schemeless hostnames (would fail z.string().url())
  //  - androidapp:// app URIs (should route to appIdentifiers)
  //  - iosapp:// app URIs (should route to appIdentifiers)
  const BITWARDEN_REGRESSION_CSV = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
,,login,ok,,,0,https://ok.com/,u,p,
,,login,schemeless,,,0,schemeless.example.com,u,p,
,,login,android,,,0,androidapp://com.tesla.TeslaApp/,u,p,
,,login,ios,,,0,iosapp://com.apple.notes,u,p,
`;

  const CSVS: Array<[string, string]> = [
    ['keykeykey', KEYKEYKEY_CSV],
    ['chrome', CHROME_CSV],
    ['firefox', FIREFOX_CSV],
    ['bitwarden', BITWARDEN_REGRESSION_CSV],
    ['icloud', ICLOUD_CSV],
    ['1password', ONEPASSWORD_CSV],
  ];

  const now = new Date().toISOString();

  it.each(CSVS)('every item from %s CSV passes VaultItemSchema.parse', (source, csv) => {
    const result = importPasswordsCsv(csv, source as Parameters<typeof importPasswordsCsv>[1]);

    expect(result.items.length).toBeGreaterThan(0);

    for (const item of result.items) {
      const withMeta = { ...item, id: randomUUID(), createdAt: now, updatedAt: now };
      expect(() => VaultItemSchema.parse(withMeta)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run the importer tests to confirm the new regression test passes**

Run: `pnpm --filter @keykeykey/core test -- --run importer`

Expected: PASS — six parameterized cases, all green. The Bitwarden case now includes a schemeless URL that would have thrown the original ZodError.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/import/importer.test.ts
git commit -m "test(core/import): end-to-end VaultItemSchema regression across all sources"
```

---

## Task 8: Format Zod errors in `ImportScreen.tsx`

**Files:**

- Modify: `apps/desktop/src/screens/ImportScreen.tsx`

- [ ] **Step 1: Add the `formatImportError` helper**

In `apps/desktop/src/screens/ImportScreen.tsx`, just below the final `import { … } from '@keykeykey/core';` line (around line 16 in the current file), insert:

```ts
/**
 * Translate errors thrown during import into a human-readable message.
 * ZodError.message is a JSON dump of `.issues`, which renders as noise in the UI.
 * Duck-type the ZodError shape so this file does not take a direct zod dep.
 */
interface ZodIssueLike {
  code?: string;
  message?: string;
  path?: ReadonlyArray<string | number>;
}

function isZodErrorLike(err: unknown): err is { issues: ZodIssueLike[] } {
  if (typeof err !== 'object' || err === null) return false;
  const issues = (err as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return false;
  return issues.every((i) => typeof i === 'object' && i !== null && 'code' in i && 'message' in i);
}

function formatImportError(err: unknown, fallback: string): string {
  if (isZodErrorLike(err)) {
    const first = err.issues[0];
    if (!first) return fallback;
    const path = (first.path ?? [])
      .filter((p) => p !== undefined && p !== '')
      .map(String)
      .join('.');
    const where = path ? ` (field: ${path})` : '';
    return `Some items had invalid data${where}: ${first.message ?? 'validation failed'}. The import has been aborted.`;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
```

- [ ] **Step 2: Wire the helper into the four catch blocks**

Replace these four lines in the same file:

Line ~98 (in `handleCsvFileChange`):

```ts
setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV');
```

Becomes:

```ts
setCsvError(formatImportError(err, 'Failed to parse CSV'));
```

Line ~115 (in `handleSourceOverride`):

```ts
setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV with selected source');
```

Becomes:

```ts
setCsvError(formatImportError(err, 'Failed to parse CSV with selected source'));
```

Line ~150 (in `handleCsvImport`):

```ts
setCsvError(err instanceof Error ? err.message : 'Import failed');
```

Becomes:

```ts
setCsvError(formatImportError(err, 'Import failed'));
```

Line ~237–238 (in `handleEncryptedImport`):

```ts
const msg = err instanceof Error ? err.message : 'Import failed';
setEncError(msg);
```

Becomes:

```ts
setEncError(formatImportError(err, 'Import failed'));
```

- [ ] **Step 3: Typecheck the desktop app**

Run: `pnpm --filter @keykeykey/desktop typecheck`

Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/screens/ImportScreen.tsx
git commit -m "fix(desktop/import): render Zod errors as friendly messages instead of raw JSON"
```

---

## Task 9: Final verification — full test suite + desktop rebuild

**Files:** none — this task verifies everything.

- [ ] **Step 1: Run the full core test suite**

Run: `pnpm --filter @keykeykey/core test -- --run`

Expected: PASS — all test files, all tests green. Pay particular attention to the new `classify-uri.test.ts`, extended `bitwarden.test.ts`, updated `chrome.test.ts`, and the end-to-end regression in `importer.test.ts`.

- [ ] **Step 2: Typecheck + build the core package**

Run: `pnpm --filter @keykeykey/core build`

Expected: PASS — tsup produces dist/ without errors.

- [ ] **Step 3: Build the desktop app**

Run: `pnpm --filter @keykeykey/core --filter @keykeykey/ui --filter @keykeykey/desktop build`

Expected: PASS — Vite produces `apps/desktop/dist/` without errors. This satisfies the CLAUDE.md directive to rebuild after development so the user can run/install it.

- [ ] **Step 4: Smoke summary**

Report to the user:

1. Test totals (X passed / Y total) from Step 1.
2. Confirm both builds succeeded.
3. Suggest they retry the 489-row Bitwarden import — the schemeless URL that previously aborted the batch should now import with `https://` prepended, and any app URIs are now stored in `appIdentifiers`.
