# CSV Import: Route URIs to `url` vs `appIdentifiers`

**Date:** 2026-04-14
**Status:** Approved — ready for implementation planning
**Scope:** `packages/core/src/import/*` and `apps/desktop/src/screens/ImportScreen.tsx`

---

## Problem

When importing a Bitwarden (or any other) CSV, the `login_uri` column can contain either a web URL or an app identifier. The current import pipeline always shoves the string into `Credential.url`, which has two consequences:

1. App identifiers (`androidapp://com.tesla.TeslaApp/`) are misclassified as URLs. Semantically wrong — they should live in `Credential.appIdentifiers`, which is what the extension and mobile autofill resolve against.
2. Schemeless web URLs (`foo.com`) fail `z.string().url()` inside `VaultItemSchema.parse` during `addItems`. The resulting `ZodError`'s `.message` is a JSON dump of `.issues`, which the UI renders raw: `[{ "validation": "url", "code": "invalid_string", "message": "Invalid url", "path": [ "url" ] }]`. One bad row aborts the entire batch of 489.

This spec fixes both: split each raw URI on intent, route to the correct field, drop what we can't classify, and render any future `ZodError` as a friendly message.

## Non-goals

- Inferring a web URL from an app package name (e.g. `com.tesla.TeslaApp` → `https://tesla.com`). Guessy and error-prone.
- Supporting Bitwarden's multi-URI JSON export column. CSV exports collapse to one `login_uri`; that's what we handle.
- Schema changes to `Credential`. The existing fields `url` and `appIdentifiers` are sufficient.

---

## Design

### 1. New shared helper — `classifyUri`

**File:** `packages/core/src/import/classify-uri.ts`

```ts
export type UriClassification =
  | { kind: 'url'; value: string }
  | { kind: 'appIdentifier'; value: string }
  | { kind: 'drop' };

export function classifyUri(raw: string): UriClassification;
```

Rules, evaluated in order:

| #   | Input                                         | Result                                                                                           |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `''`, whitespace-only                         | `drop`                                                                                           |
| 2   | `androidapp://<pkg>/…`                        | extract `<pkg>`, lowercase, validate regex → `appIdentifier` / `drop`                            |
| 3   | `android://<hash>@<pkg>/…` (Chrome sync form) | extract `<pkg>` from after `@`, validate → `appIdentifier` / `drop`                              |
| 4   | `iosapp://<bundle>/…` or `ios://<bundle>/…`   | extract `<bundle>`, validate → `appIdentifier` / `drop`                                          |
| 5   | Any other scheme not in {`http`, `https`}     | `drop` (unknown custom scheme — ambiguous)                                                       |
| 6   | `http://…` or `https://…`                     | parse, emit `${proto}//${hostname}${pathname !== '/' ? pathname : ''}`, strip query/hash → `url` |
| 7   | No scheme (e.g. `foo.com`, `foo.com/path`)    | prepend `https://`, re-run rule 6. If `new URL()` fails → `drop`                                 |

Validation regex mirrors the schema's `appIdentifierString`:
`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$` (after lowercasing).

This helper replaces the five near-duplicate `normalizeUrl()` functions currently living in each source parser.

### 2. IR extension

**File:** `packages/core/src/import/types.ts`

Add one field:

```ts
export interface ImportedCredential {
  name: string;
  url: string;
  appIdentifiers: string[]; // NEW — always present, empty array if none
  username: string;
  password: string;
  notes: string;
  totp: string;
  folder: string;
  favorite: boolean;
}
```

This is a type-only addition within a module that has no external consumers outside `packages/core/src/import/*`. Safe.

### 3. Parser integration

Each source parser calls `classifyUri(rawUri)` for its URI-ish column and routes the result:

```ts
const cls = classifyUri(rawUri);
const url = cls.kind === 'url' ? cls.value : '';
const appIdentifiers = cls.kind === 'appIdentifier' ? [cls.value] : [];
```

Per-parser notes:

- **Bitwarden (`bitwarden.ts`)** — routes `login_uri`. Remove local `normalizeUrl()`.
- **Chrome (`chrome.ts`)** — routes `url`. Keep the existing `deriveNameFromUrl()` behavior that pulls a readable name out of `android://<hash>@<pkg>/` so app-identifier credentials still get sensible names. Remove local `normalizeUrl()`.
- **Firefox (`firefox.ts`)** — routes `url`. Remove local `normalizeUrl()`.
- **iCloud (`icloud.ts`)** — routes `url`. Remove local `normalizeUrl()`.
- **1Password (`onepassword.ts`)** — routes whichever column it already picks (after the existing `isUrl` gate). Remove local `normalizeUrl()`.
- **KeyKeyKey (`keykeykey.ts`)** — run `classifyUri` on the `url` column for defense-in-depth, in case a user hand-edited the export. Our own export produces clean `https://` URLs so this is a no-op in the happy path.

All parsers initialize `appIdentifiers: []` in the IR object they push.

### 4. `toVaultItems` mapping

**File:** `packages/core/src/import/importer.ts`

```ts
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
```

Empty arrays collapse to `undefined` so we don't persist `[]` on every credential.

### 5. UI error formatting

**File:** `apps/desktop/src/screens/ImportScreen.tsx`

Add a local helper that duck-types `ZodError` (no direct `zod` import — it's not in this package's deps and need not be):

```ts
function isZodErrorLike(err: unknown): err is {
  issues: Array<{ code?: string; message?: string; path?: ReadonlyArray<string | number> }>;
} {
  return (
    typeof err === 'object' &&
    err !== null &&
    Array.isArray((err as any).issues) &&
    (err as any).issues.every(
      (i: any) => i && typeof i === 'object' && 'code' in i && 'message' in i,
    )
  );
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
  return err instanceof Error ? err.message : fallback;
}
```

Replace every `err instanceof Error ? err.message : '…'` in the four catch blocks (`handleCsvFileChange`, `handleSourceOverride`, `handleCsvImport`, `handleEncryptedImport`) with `formatImportError(err, '…')`.

Post-fix, the primary Zod-URL path shouldn't trip anymore — this is the safety net for unforeseen schema violations.

---

## Testing

### New tests

- **`packages/core/src/import/classify-uri.test.ts`** — exhaustive per-rule cases:
  - empty / whitespace → `drop`
  - `androidapp://com.tesla.TeslaApp/` → `appIdentifier: 'com.tesla.teslaapp'` (lowercased)
  - `android://abcdef...@com.example.app/` → `appIdentifier: 'com.example.app'`
  - `iosapp://com.example.app` → `appIdentifier: 'com.example.app'`
  - `ios://com.example.app` → `appIdentifier: 'com.example.app'`
  - `androidapp://invalid-pkg-has-hyphens/` → `drop` (regex-reject)
  - `chrome-extension://abc/` → `drop` (unknown scheme)
  - `https://foo.com/path?q=1#f` → `url: 'https://foo.com/path'`
  - `http://foo.com/` → `url: 'http://foo.com'`
  - `foo.com` → `url: 'https://foo.com'`
  - `foo.com/login` → `url: 'https://foo.com/login'`
  - `not a url` → `drop`

### Extended tests

- **`bitwarden.test.ts`** — add rows:
  - `androidapp://com.tesla.TeslaApp/` → assert `appIdentifiers: ['com.tesla.teslaapp']`, `url: ''`.
  - `iosapp://com.apple.notes` → assert `appIdentifiers: ['com.apple.notes']`, `url: ''`.
  - schemeless `foo.example.com` → assert `url: 'https://foo.example.com'`, `appIdentifiers: []`.
  - Update the existing `items.length` count.

- **`chrome.test.ts`** — add a row with `android://<hash>@com.example.app/`; assert routed to `appIdentifiers`, not dropped.

- **`importer.test.ts`** — two new assertions:
  - `toVaultItems` puts the identifier in `appIdentifiers` and leaves `url` undefined for the Bitwarden app-URI row.
  - End-to-end: run `importPasswordsCsv` on each source's test CSV, then `VaultItemSchema.parse` every resulting item. **No exceptions.** This is the regression guard for the original bug.

### Desktop smoke

After tests pass, rebuild the desktop app so the user can verify the Bitwarden import of the 489-row CSV completes without a ZodError.

---

## Risk & rollback

- **Risk:** An older Bitwarden or other source we haven't sampled uses a URI scheme we've listed as `drop`. Mitigation: log at the parser level? No — the `skipped[]` array returned by each parser is the existing reporting channel. For cleanliness, we do **not** add app-URI drops to `skipped` (they're not skipped rows, the credential still imports without a URL/appId); this is a conscious UX call and documented in the parser comments.
- **Rollback:** Revert the module. No persisted state, no migration.

## Out-of-scope follow-ups (noted, not planned here)

- Detecting plain reverse-DNS strings without a scheme (e.g. a user pasting `com.example.app` into Bitwarden's URI field). Schema regex can't disambiguate these from 2-label domains like `foo.com`; needs a heuristic and a different spec.
- Multi-URI Bitwarden entries. Require the JSON export path, not CSV.
