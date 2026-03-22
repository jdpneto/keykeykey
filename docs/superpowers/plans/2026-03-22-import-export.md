# Import & Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CSV import UI, CSV export, and encrypted vault backup/restore across desktop, extension, and mobile.

**Architecture:** Core logic in `packages/core` (CSV serializer, exporter, merge/dedup, encrypted backup). Each platform gets ImportScreen and ExportScreen wired into Settings. The encrypted backup format wraps a standard ZIP (via fflate) inside XChaCha20-Poly1305 encryption with Argon2id key derivation.

**Tech Stack:** TypeScript, Vitest, fflate (ZIP), @noble/ciphers + @noble/hashes (encryption), React Router (desktop), state-machine navigation (extension), Expo Router (mobile), Tauri dialog API, browser.downloads API, expo-document-picker.

**Spec:** `docs/superpowers/specs/2026-03-22-import-export-design.md`

---

## File Map

### Core — New Files

| File | Responsibility |
|------|---------------|
| `packages/core/src/export/csv-serializer.ts` | RFC 4180 CSV serialization (inverse of csv-parser) |
| `packages/core/src/export/csv-serializer.test.ts` | Tests for CSV serializer |
| `packages/core/src/export/exporter.ts` | `exportToCsv()` — filter credentials, map fields, call serializer |
| `packages/core/src/export/exporter.test.ts` | Tests for CSV export |
| `packages/core/src/export/index.ts` | Re-exports |
| `packages/core/src/import/merge.ts` | `findDuplicates()` — field-based dedup, URL normalization |
| `packages/core/src/import/merge.test.ts` | Tests for merge/dedup logic |
| `packages/core/src/export-import-zip/collect-vault-files.ts` | `collectVaultFiles()` — read vault.enc + items from ISyncAdapter |
| `packages/core/src/export-import-zip/collect-vault-files.test.ts` | Tests for vault file collection |
| `packages/core/src/export-import-zip/encrypted-export.ts` | `exportEncryptedBackup()` — ZIP + XChaCha20 |
| `packages/core/src/export-import-zip/encrypted-import.ts` | `importEncryptedBackup()` — decrypt + unzip |
| `packages/core/src/export-import-zip/encrypted-export.test.ts` | Tests for encrypted export |
| `packages/core/src/export-import-zip/encrypted-import.test.ts` | Tests for encrypted import |
| `packages/core/src/export-import-zip/index.ts` | Re-exports |

### Core — Modified Files

| File | Change |
|------|--------|
| `packages/core/package.json` | Add `./export`, `./import`, `./export-import-zip` exports; add `fflate` dependency |
| `packages/core/tsup.config.ts` | Add 3 new entry points |
| `packages/core/src/import/index.ts` | Re-export merge module |

### Desktop — New Files

| File | Responsibility |
|------|---------------|
| `apps/desktop/src/screens/ImportScreen.tsx` | CSV + encrypted import UI |
| `apps/desktop/src/screens/ExportScreen.tsx` | CSV + encrypted export UI |

### Desktop — Modified Files

| File | Change |
|------|--------|
| `apps/desktop/src/App.tsx` | Add `/vault/settings/import` and `/vault/settings/export` routes |
| `apps/desktop/src/screens/SettingsScreen.tsx` | Replace disabled Export row, add Import row |

### Extension — New Files

| File | Responsibility |
|------|---------------|
| `apps/extension/src/popup/screens/ImportScreen.tsx` | CSV + encrypted import UI |
| `apps/extension/src/popup/screens/ExportScreen.tsx` | CSV + encrypted export UI |

### Extension — Modified Files

| File | Change |
|------|--------|
| `apps/extension/src/popup/Popup.tsx` | Add `import` and `export` screen cases |
| `apps/extension/src/popup/screens/SettingsScreen.tsx` | Add Import and Export rows |

### Mobile — New Files

| File | Responsibility |
|------|---------------|
| `apps/mobile/app/settings/import.tsx` | CSV + encrypted import UI |
| `apps/mobile/app/settings/export.tsx` | CSV + encrypted export UI |

### Mobile — Modified Files

| File | Change |
|------|--------|
| `apps/mobile/app/_layout.tsx` | Add `settings/import` and `settings/export` stack screens |
| `apps/mobile/app/(tabs)/settings.tsx` | Replace disabled Export row, add Import row |

---

## Task 1: CSV Serializer

**Files:**
- Create: `packages/core/src/export/csv-serializer.ts`
- Create: `packages/core/src/export/csv-serializer.test.ts`

- [ ] **Step 1: Write failing tests for serializeCsv**

```typescript
// packages/core/src/export/csv-serializer.test.ts
import { describe, it, expect } from 'vitest';
import { serializeCsv } from './csv-serializer.js';

describe('CSV serializer', () => {
  it('serializes headers and rows', () => {
    const result = serializeCsv(['a', 'b', 'c'], [['1', '2', '3']]);
    expect(result).toBe('\uFEFFa,b,c\r\n1,2,3\r\n');
  });

  it('quotes fields containing commas', () => {
    const result = serializeCsv(['name'], [['Last, First']]);
    expect(result).toBe('\uFEFFname\r\n"Last, First"\r\n');
  });

  it('escapes double quotes inside fields', () => {
    const result = serializeCsv(['name'], [['say "hi"']]);
    expect(result).toBe('\uFEFFname\r\n"say ""hi"""\r\n');
  });

  it('quotes fields containing newlines', () => {
    const result = serializeCsv(['note'], [['line1\nline2']]);
    expect(result).toBe('\uFEFFnote\r\n"line1\nline2"\r\n');
  });

  it('handles empty fields', () => {
    const result = serializeCsv(['a', 'b'], [['', 'val']]);
    expect(result).toBe('\uFEFFa,b\r\n,val\r\n');
  });

  it('handles multiple rows', () => {
    const result = serializeCsv(['a'], [['1'], ['2'], ['3']]);
    expect(result).toBe('\uFEFFa\r\n1\r\n2\r\n3\r\n');
  });

  it('handles empty rows array', () => {
    const result = serializeCsv(['a', 'b'], []);
    expect(result).toBe('\uFEFFa,b\r\n');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/export/csv-serializer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement serializeCsv**

```typescript
// packages/core/src/export/csv-serializer.ts
/**
 * RFC 4180-compliant CSV serializer.
 *
 * Produces UTF-8 with BOM, CRLF line endings, and proper quoting.
 */

const BOM = '\uFEFF';

/**
 * Serialize headers and rows into an RFC 4180 CSV string.
 *
 * Fields containing commas, double quotes, or newlines are double-quoted.
 * Internal double quotes are escaped as "".
 * Output uses CRLF line endings and a UTF-8 BOM prefix.
 */
export function serializeCsv(headers: string[], rows: string[][]): string {
  const lines: string[] = [serializeRow(headers)];
  for (const row of rows) {
    lines.push(serializeRow(row));
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

function serializeRow(fields: string[]): string {
  return fields.map(quoteField).join(',');
}

function quoteField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/export/csv-serializer.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Add round-trip test with existing CSV parser**

Add to `csv-serializer.test.ts`:

```typescript
import { parseCsv } from '../import/csv-parser.js';

it('round-trips through parseCsv', () => {
  const headers = ['name', 'url', 'notes'];
  const rows = [
    ['My Site', 'https://example.com', 'has "quotes" and, commas'],
    ['Other', 'https://other.com', 'line1\nline2'],
  ];
  const csv = serializeCsv(headers, rows);
  // parseCsv expects no BOM — strip it
  const parsed = parseCsv(csv.slice(1));
  expect(parsed.headers).toEqual(headers);
  expect(parsed.rows).toEqual(rows);
});
```

- [ ] **Step 6: Run all tests to verify**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/export/csv-serializer.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/export/csv-serializer.ts packages/core/src/export/csv-serializer.test.ts
git commit -m "feat(core): add RFC 4180 CSV serializer with BOM and round-trip tests"
```

---

## Task 2: CSV Exporter

**Files:**
- Create: `packages/core/src/export/exporter.ts`
- Create: `packages/core/src/export/exporter.test.ts`
- Create: `packages/core/src/export/index.ts`

- [ ] **Step 1: Write failing tests for exportToCsv**

```typescript
// packages/core/src/export/exporter.test.ts
import { describe, it, expect } from 'vitest';
import { exportToCsv } from './exporter.js';
import { parseCsv } from '../import/csv-parser.js';
import type { VaultItem } from '../models/vault-item.js';

const credential = (overrides: Partial<VaultItem & { type: 'credential' }> = {}): VaultItem => ({
  type: 'credential',
  id: 'test-id-1',
  name: 'Example',
  username: 'user@test.com',
  password: 'secret123',
  url: 'https://example.com',
  notes: 'my note',
  totp: '',
  tags: [],
  favorite: false,
  passwordHistory: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('exportToCsv', () => {
  it('exports credentials with correct headers', () => {
    const csv = exportToCsv([credential()]);
    const parsed = parseCsv(csv.slice(1)); // strip BOM
    expect(parsed.headers).toEqual([
      'name', 'url', 'username', 'password', 'notes', 'totp', 'folder', 'favorite',
    ]);
  });

  it('maps credential fields correctly', () => {
    const csv = exportToCsv([credential()]);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.rows[0]).toEqual([
      'Example', 'https://example.com', 'user@test.com', 'secret123', 'my note', '', '', 'false',
    ]);
  });

  it('filters out non-credential items', () => {
    const items: VaultItem[] = [
      credential(),
      {
        type: 'card',
        id: 'card-1',
        name: 'Visa',
        cardholderName: 'John',
        number: '4111111111111111',
        expirationMonth: 12,
        expirationYear: 2027,
        cvv: '123',
        tags: [],
        favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        type: 'secure-note',
        id: 'note-1',
        name: 'Secret',
        content: 'hidden',
        tags: [],
        favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const csv = exportToCsv(items);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]![0]).toBe('Example');
  });

  it('serializes tags as semicolon-delimited folder', () => {
    const csv = exportToCsv([credential({ tags: ['work', 'banking'] })]);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.rows[0]![6]).toBe('work;banking');
  });

  it('serializes favorite as string', () => {
    const csv = exportToCsv([credential({ favorite: true })]);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.rows[0]![7]).toBe('true');
  });

  it('excludes passwordHistory', () => {
    const csv = exportToCsv([credential({
      passwordHistory: [{ password: 'old', changedAt: '2026-01-01T00:00:00.000Z' }],
    })]);
    expect(csv).not.toContain('old');
    expect(csv).not.toContain('passwordHistory');
  });

  it('handles empty items array', () => {
    const csv = exportToCsv([]);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.headers).toHaveLength(8);
    expect(parsed.rows).toHaveLength(0);
  });

  it('excludes appIdentifiers from output', () => {
    const csv = exportToCsv([credential({
      appIdentifiers: ['com.example.app'],
    })]);
    expect(csv).not.toContain('appIdentifiers');
    expect(csv).not.toContain('com.example.app');
  });

  it('handles undefined optional fields', () => {
    const csv = exportToCsv([credential({ url: undefined, notes: undefined, totp: undefined })]);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.rows[0]![1]).toBe(''); // url
    expect(parsed.rows[0]![4]).toBe(''); // notes
    expect(parsed.rows[0]![5]).toBe(''); // totp
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/export/exporter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement exportToCsv**

```typescript
// packages/core/src/export/exporter.ts
/**
 * CSV vault exporter — exports credential-type items to a standard CSV.
 *
 * Only credentials are exported (cards and secure notes are excluded).
 * The output format is compatible with Chrome/Firefox/iCloud CSV import.
 */

import type { VaultItem } from '../models/vault-item.js';
import { serializeCsv } from './csv-serializer.js';

const HEADERS = ['name', 'url', 'username', 'password', 'notes', 'totp', 'folder', 'favorite'];

/**
 * Export vault items to CSV string.
 *
 * Filters to credential type only. Maps tags to semicolon-delimited folder column.
 * Excludes passwordHistory and appIdentifiers.
 */
export function exportToCsv(items: VaultItem[]): string {
  const credentials = items.filter((item) => item.type === 'credential');

  const rows = credentials.map((cred) => [
    cred.name,
    cred.url ?? '',
    cred.username,
    cred.password,
    cred.notes ?? '',
    cred.totp ?? '',
    cred.tags.join(';'),
    String(cred.favorite),
  ]);

  return serializeCsv(HEADERS, rows);
}
```

- [ ] **Step 4: Create index.ts**

```typescript
// packages/core/src/export/index.ts
/**
 * CSV export module.
 *
 * @module export
 */

export { serializeCsv } from './csv-serializer.js';
export { exportToCsv } from './exporter.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/export/`
Expected: All tests PASS (serializer + exporter)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/export/
git commit -m "feat(core): add CSV exporter with credential filtering and tag serialization"
```

---

## Task 3: Duplicate Detection & Merge Logic

**Files:**
- Create: `packages/core/src/import/merge.ts`
- Create: `packages/core/src/import/merge.test.ts`
- Modify: `packages/core/src/import/index.ts`

- [ ] **Step 1: Write failing tests for URL normalization and findDuplicates**

```typescript
// packages/core/src/import/merge.test.ts
import { describe, it, expect } from 'vitest';
import { findDuplicates, normalizeUrl } from './merge.js';
import type { VaultItem } from '../models/vault-item.js';

const cred = (overrides: Record<string, unknown> = {}): VaultItem => ({
  type: 'credential',
  id: 'id-1',
  name: 'Test',
  username: 'user@test.com',
  password: 'pass123',
  url: 'https://example.com',
  tags: [],
  favorite: false,
  passwordHistory: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
} as VaultItem);

const card = (overrides: Record<string, unknown> = {}): VaultItem => ({
  type: 'card',
  id: 'card-1',
  name: 'Visa',
  cardholderName: 'John Doe',
  number: '4111111111111111',
  expirationMonth: 12,
  expirationYear: 2027,
  cvv: '123',
  tags: [],
  favorite: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
} as VaultItem);

const note = (overrides: Record<string, unknown> = {}): VaultItem => ({
  type: 'secure-note',
  id: 'note-1',
  name: 'My Note',
  content: 'secret stuff',
  tags: [],
  favorite: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
} as VaultItem);

describe('normalizeUrl', () => {
  it('lowercases hostname', () => {
    expect(normalizeUrl('https://Example.COM/path')).toBe('https://example.com/path');
  });

  it('strips trailing slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
  });

  it('strips www prefix', () => {
    expect(normalizeUrl('https://www.example.com')).toBe('https://example.com');
  });

  it('handles all normalizations together', () => {
    expect(normalizeUrl('https://WWW.Example.COM/')).toBe('https://example.com');
  });

  it('returns empty string for undefined/empty', () => {
    expect(normalizeUrl(undefined)).toBe('');
    expect(normalizeUrl('')).toBe('');
  });

  it('returns original for non-URL strings', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('findDuplicates', () => {
  it('detects credential duplicates by username + password + url', () => {
    const existing = [cred()];
    const incoming = [cred({ id: 'id-2' })];
    const result = findDuplicates(incoming, existing);
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it('imports credentials with different passwords', () => {
    const existing = [cred()];
    const incoming = [cred({ id: 'id-2', password: 'different' })];
    const result = findDuplicates(incoming, existing);
    expect(result.toImport).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it('normalizes URLs for credential matching', () => {
    const existing = [cred({ url: 'https://www.Example.com/' })];
    const incoming = [cred({ id: 'id-2', url: 'https://example.com' })];
    const result = findDuplicates(incoming, existing);
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it('detects card duplicates by cardholderName + number', () => {
    const existing = [card()];
    const incoming = [card({ id: 'card-2' })];
    const result = findDuplicates(incoming, existing);
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it('imports cards with different numbers', () => {
    const existing = [card()];
    const incoming = [card({ id: 'card-2', number: '5555555555554444' })];
    const result = findDuplicates(incoming, existing);
    expect(result.toImport).toHaveLength(1);
  });

  it('detects secure note duplicates by name + content', () => {
    const existing = [note()];
    const incoming = [note({ id: 'note-2' })];
    const result = findDuplicates(incoming, existing);
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it('imports notes with different content', () => {
    const existing = [note()];
    const incoming = [note({ id: 'note-2', content: 'different' })];
    const result = findDuplicates(incoming, existing);
    expect(result.toImport).toHaveLength(1);
  });

  it('handles mixed types correctly', () => {
    const existing = [cred()];
    const incoming = [cred({ id: 'id-2' }), card(), note()];
    const result = findDuplicates(incoming, existing);
    expect(result.toImport).toHaveLength(2); // card + note
    expect(result.skipped).toHaveLength(1); // duplicate cred
  });

  it('handles empty incoming', () => {
    const result = findDuplicates([], [cred()]);
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('handles empty existing', () => {
    const incoming = [cred(), card()];
    const result = findDuplicates(incoming, []);
    expect(result.toImport).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/import/merge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement merge.ts**

```typescript
// packages/core/src/import/merge.ts
/**
 * Field-based duplicate detection for import merging.
 *
 * Unlike sync merge (ID-based LWW), import merge compares field values
 * because items from different vaults or CSV imports have different UUIDs.
 */

import type { VaultItem } from '../models/vault-item.js';

export interface MergeResult {
  /** Items that have no duplicate in the existing vault. */
  toImport: VaultItem[];
  /** Items skipped because a duplicate was found. */
  skipped: VaultItem[];
}

/**
 * Normalize a URL for comparison: lowercase hostname, strip www., strip trailing slash.
 */
export function normalizeUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.replace(/^www\./, '');
    // Reconstruct without trailing slash
    let normalized = `${parsed.protocol}//${parsed.hostname}`;
    if (parsed.port) normalized += `:${parsed.port}`;
    const path = parsed.pathname.replace(/\/+$/, '');
    if (path) normalized += path;
    if (parsed.search) normalized += parsed.search;
    return normalized;
  } catch {
    return url;
  }
}

/**
 * Find duplicates between incoming and existing items using field-based matching.
 *
 * Matching rules:
 * - Credentials: username + password + normalized URL
 * - Cards: cardholderName + number
 * - Secure notes: name + content
 */
export function findDuplicates(incoming: VaultItem[], existing: VaultItem[]): MergeResult {
  const toImport: VaultItem[] = [];
  const skipped: VaultItem[] = [];

  // Build lookup sets for each type
  const credKeys = new Set<string>();
  const cardKeys = new Set<string>();
  const noteKeys = new Set<string>();

  for (const item of existing) {
    switch (item.type) {
      case 'credential':
        credKeys.add(`${item.username}\0${item.password}\0${normalizeUrl(item.url)}`);
        break;
      case 'card':
        cardKeys.add(`${item.cardholderName}\0${item.number}`);
        break;
      case 'secure-note':
        noteKeys.add(`${item.name}\0${item.content}`);
        break;
    }
  }

  for (const item of incoming) {
    let isDuplicate = false;

    switch (item.type) {
      case 'credential':
        isDuplicate = credKeys.has(
          `${item.username}\0${item.password}\0${normalizeUrl(item.url)}`,
        );
        break;
      case 'card':
        isDuplicate = cardKeys.has(`${item.cardholderName}\0${item.number}`);
        break;
      case 'secure-note':
        isDuplicate = noteKeys.has(`${item.name}\0${item.content}`);
        break;
    }

    if (isDuplicate) {
      skipped.push(item);
    } else {
      toImport.push(item);
    }
  }

  return { toImport, skipped };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/import/merge.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Update import/index.ts to re-export merge**

Add to `packages/core/src/import/index.ts`:

```typescript
export { findDuplicates, normalizeUrl, type MergeResult } from './merge.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/import/merge.ts packages/core/src/import/merge.test.ts packages/core/src/import/index.ts
git commit -m "feat(core): add field-based duplicate detection for import merging"
```

---

## Task 4: Build Config — Package Exports & tsup Entry Points

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/tsup.config.ts`

- [ ] **Step 1: Add new exports to package.json**

Add these three entries to the `"exports"` object in `packages/core/package.json`, after the `"./utils"` entry:

```json
    "./export": {
      "import": "./dist/export/index.js",
      "types": "./dist/export/index.d.ts"
    },
    "./import": {
      "import": "./dist/import/index.js",
      "types": "./dist/import/index.d.ts"
    },
    "./export-import-zip": {
      "import": "./dist/export-import-zip/index.js",
      "types": "./dist/export-import-zip/index.d.ts"
    }
```

- [ ] **Step 2: Add fflate dependency**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core add fflate`

- [ ] **Step 3: Add tsup entry points for export and import**

Add to the `entry` array in `packages/core/tsup.config.ts`:

```typescript
    'src/export/index.ts',
    'src/import/index.ts',
```

Note: The `src/export-import-zip/index.ts` entry point will be added in Task 6 after that module is created.

- [ ] **Step 4: Verify build succeeds**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core build`
Expected: Build succeeds with new entry points

- [ ] **Step 5: Verify all existing tests still pass**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/tsup.config.ts pnpm-lock.yaml
git commit -m "feat(core): add export, import, and encrypted backup entry points; add fflate dep"
```

---

## Task 5: Collect Vault Files Helper

**Files:**
- Create: `packages/core/src/export-import-zip/collect-vault-files.ts`
- Create: `packages/core/src/export-import-zip/collect-vault-files.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/export-import-zip/collect-vault-files.test.ts
import { describe, it, expect, vi } from 'vitest';
import { collectVaultFiles } from './collect-vault-files.js';
import type { ISyncAdapter } from '../sync/types.js';

function mockAdapter(overrides: Partial<ISyncAdapter> = {}): ISyncAdapter {
  return {
    readVaultBlob: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    writeVaultBlob: vi.fn(),
    readItem: vi.fn().mockImplementation(async (id: string) => {
      if (id === 'item-1') return new Uint8Array([10, 20]);
      if (id === 'item-2') return new Uint8Array([30, 40]);
      return null;
    }),
    writeItem: vi.fn(),
    deleteItem: vi.fn(),
    listItems: vi.fn().mockResolvedValue(['item-1', 'item-2']),
    ...overrides,
  };
}

describe('collectVaultFiles', () => {
  it('collects vault.enc and all items', async () => {
    const adapter = mockAdapter();
    const files = await collectVaultFiles(adapter);

    expect(files.size).toBe(3);
    expect(files.has('vault.enc')).toBe(true);
    expect(files.has('items/item-1')).toBe(true);
    expect(files.has('items/item-2')).toBe(true);
    expect(Buffer.from(files.get('vault.enc')!)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('throws if vault.enc is missing', async () => {
    const adapter = mockAdapter({ readVaultBlob: vi.fn().mockResolvedValue(null) });
    await expect(collectVaultFiles(adapter)).rejects.toThrow('No vault blob found');
  });

  it('skips items that return null', async () => {
    const adapter = mockAdapter({
      listItems: vi.fn().mockResolvedValue(['item-1', 'missing']),
      readItem: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'item-1') return new Uint8Array([10]);
        return null;
      }),
    });
    const files = await collectVaultFiles(adapter);
    expect(files.size).toBe(2); // vault.enc + item-1
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/export-import-zip/collect-vault-files.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement collectVaultFiles**

```typescript
// packages/core/src/export-import-zip/collect-vault-files.ts
/**
 * Collect vault files from a sync adapter into a Map for backup export.
 *
 * Reads vault.enc (the encrypted vault blob) and all individual encrypted items.
 */

import type { ISyncAdapter } from '../sync/types.js';

/**
 * Read all vault files from a sync adapter.
 *
 * @param adapter - The sync adapter to read from
 * @returns Map of relative path → file bytes ("vault.enc", "items/{id}")
 * @throws {Error} If vault.enc is not found
 */
export async function collectVaultFiles(
  adapter: ISyncAdapter,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();

  // Read vault blob
  const vaultBlob = await adapter.readVaultBlob();
  if (!vaultBlob) {
    throw new Error('No vault blob found. Is the vault synced?');
  }
  files.set('vault.enc', vaultBlob);

  // Read all items
  const itemIds = await adapter.listItems();
  for (const id of itemIds) {
    const data = await adapter.readItem(id);
    if (data) {
      files.set(`items/${id}`, data);
    }
  }

  return files;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/export-import-zip/collect-vault-files.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export-import-zip/collect-vault-files.ts packages/core/src/export-import-zip/collect-vault-files.test.ts
git commit -m "feat(core): add collectVaultFiles helper for encrypted backup export"
```

---

## Task 6: Encrypted Export

**Files:**
- Create: `packages/core/src/export-import-zip/encrypted-export.ts`
- Create: `packages/core/src/export-import-zip/encrypted-export.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/export-import-zip/encrypted-export.test.ts
import { describe, it, expect } from 'vitest';
import { exportEncryptedBackup, BACKUP_PREAMBLE_SIZE } from './encrypted-export.js';

describe('exportEncryptedBackup', () => {
  const vaultFiles = new Map<string, Uint8Array>([
    ['vault.enc', new Uint8Array([1, 2, 3, 4, 5])],
    ['items/id-1', new Uint8Array([10, 20, 30])],
    ['items/id-2', new Uint8Array([40, 50, 60])],
  ]);

  it('produces a Uint8Array with preamble', async () => {
    const result = await exportEncryptedBackup(vaultFiles, 'test-password');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(BACKUP_PREAMBLE_SIZE);
  });

  it('produces different output for different passwords', async () => {
    const a = await exportEncryptedBackup(vaultFiles, 'password-a');
    const b = await exportEncryptedBackup(vaultFiles, 'password-b');
    // Different salt → different output (overwhelmingly likely)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('produces different output each time (random salt)', async () => {
    const a = await exportEncryptedBackup(vaultFiles, 'same-password');
    const b = await exportEncryptedBackup(vaultFiles, 'same-password');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/export-import-zip/encrypted-export.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement encrypted export**

```typescript
// packages/core/src/export-import-zip/encrypted-export.ts
/**
 * Encrypted vault backup export.
 *
 * Wire format: [16-byte salt][16-byte Argon2 params (4×uint32 LE)][XChaCha20-Poly1305 ciphertext of ZIP]
 *
 * The ZIP contains the same vault directory structure used by sync:
 * vault.enc + items/{uuid}
 */

import { zipSync } from 'fflate';
import { randomBytes } from '@noble/hashes/utils';
import { encrypt } from '../crypto/encryption.js';
import { deriveKEK } from '../crypto/kdf.js';
import { SALT_SIZE } from '../crypto/constants.js';
import type { Argon2Params } from '../crypto/constants.js';

/** Backup argon2 params — lighter than vault to keep UX snappy. */
const BACKUP_ARGON2_PARAMS: Argon2Params = { t: 2, m: 19_456, p: 1, dkLen: 32 };

/** Size of the preamble: 16 (salt) + 16 (4 × uint32 params). */
export const BACKUP_PREAMBLE_SIZE = 32;

/**
 * Export vault files into an encrypted backup.
 *
 * @param vaultFiles - Map of relative path → file bytes (e.g., "vault.enc", "items/uuid")
 * @param zipPassword - Password to encrypt the backup with
 * @returns Encrypted backup bytes: [salt][params][ciphertext]
 */
export async function exportEncryptedBackup(
  vaultFiles: Map<string, Uint8Array>,
  zipPassword: string,
): Promise<Uint8Array> {
  // 1. Create ZIP from vault files
  const zipInput: Record<string, Uint8Array> = {};
  for (const [path, data] of vaultFiles) {
    zipInput[path] = data;
  }
  const zipBytes = zipSync(zipInput, { level: 0 }); // no compression — data is already encrypted

  // 2. Derive encryption key from zip password
  const salt = randomBytes(SALT_SIZE);
  const key = await deriveKEK(zipPassword, salt, BACKUP_ARGON2_PARAMS);

  // 3. Encrypt the ZIP
  const ciphertext = encrypt(zipBytes, key);

  // 4. Build preamble
  const preamble = new Uint8Array(BACKUP_PREAMBLE_SIZE);
  preamble.set(salt, 0);
  const view = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);
  view.setUint32(16, BACKUP_ARGON2_PARAMS.t, true);
  view.setUint32(20, BACKUP_ARGON2_PARAMS.m, true);
  view.setUint32(24, BACKUP_ARGON2_PARAMS.p, true);
  view.setUint32(28, BACKUP_ARGON2_PARAMS.dkLen, true);

  // 5. Concatenate: preamble + ciphertext
  const result = new Uint8Array(BACKUP_PREAMBLE_SIZE + ciphertext.length);
  result.set(preamble, 0);
  result.set(ciphertext, BACKUP_PREAMBLE_SIZE);

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/export-import-zip/encrypted-export.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/export-import-zip/encrypted-export.ts packages/core/src/export-import-zip/encrypted-export.test.ts
git commit -m "feat(core): add encrypted vault backup export with Argon2id + XChaCha20"
```

---

## Task 7: Encrypted Import

**Files:**
- Create: `packages/core/src/export-import-zip/encrypted-import.ts`
- Create: `packages/core/src/export-import-zip/encrypted-import.test.ts`
- Create: `packages/core/src/export-import-zip/index.ts`

- [ ] **Step 1: Write failing tests (including round-trip)**

```typescript
// packages/core/src/export-import-zip/encrypted-import.test.ts
import { describe, it, expect } from 'vitest';
import { importEncryptedBackup } from './encrypted-import.js';
import { exportEncryptedBackup } from './encrypted-export.js';

describe('importEncryptedBackup', () => {
  const vaultFiles = new Map<string, Uint8Array>([
    ['vault.enc', new Uint8Array([1, 2, 3, 4, 5])],
    ['items/id-1', new Uint8Array([10, 20, 30])],
    ['items/id-2', new Uint8Array([40, 50, 60])],
  ]);

  it('round-trips vault files through export → import', async () => {
    const encrypted = await exportEncryptedBackup(vaultFiles, 'my-password');
    const restored = await importEncryptedBackup(encrypted, 'my-password');

    expect(restored.size).toBe(3);
    expect(Buffer.from(restored.get('vault.enc')!)).toEqual(Buffer.from(vaultFiles.get('vault.enc')!));
    expect(Buffer.from(restored.get('items/id-1')!)).toEqual(Buffer.from(vaultFiles.get('items/id-1')!));
    expect(Buffer.from(restored.get('items/id-2')!)).toEqual(Buffer.from(vaultFiles.get('items/id-2')!));
  });

  it('throws on wrong password', async () => {
    const encrypted = await exportEncryptedBackup(vaultFiles, 'correct');
    await expect(importEncryptedBackup(encrypted, 'wrong')).rejects.toThrow();
  });

  it('throws on truncated data', async () => {
    const encrypted = await exportEncryptedBackup(vaultFiles, 'pass');
    const truncated = encrypted.slice(0, 16);
    await expect(importEncryptedBackup(truncated, 'pass')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/export-import-zip/encrypted-import.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement encrypted import**

```typescript
// packages/core/src/export-import-zip/encrypted-import.ts
/**
 * Encrypted vault backup import.
 *
 * Reads the wire format produced by encrypted-export.ts:
 * [16-byte salt][16-byte Argon2 params][XChaCha20-Poly1305 ciphertext of ZIP]
 */

import { unzipSync } from 'fflate';
import { decrypt } from '../crypto/encryption.js';
import { deriveKEK } from '../crypto/kdf.js';
import type { Argon2Params } from '../crypto/constants.js';
import { BACKUP_PREAMBLE_SIZE } from './encrypted-export.js';

/**
 * Decrypt and extract vault files from an encrypted backup.
 *
 * @param fileBytes - The encrypted backup file bytes
 * @param zipPassword - The password used to encrypt the backup
 * @returns Map of relative path → file bytes
 * @throws {Error} If the password is wrong or the data is corrupt
 */
export async function importEncryptedBackup(
  fileBytes: Uint8Array,
  zipPassword: string,
): Promise<Map<string, Uint8Array>> {
  if (fileBytes.length < BACKUP_PREAMBLE_SIZE) {
    throw new Error(
      `Backup file too short: expected at least ${BACKUP_PREAMBLE_SIZE} bytes, got ${fileBytes.length}`,
    );
  }

  // 1. Read preamble
  const salt = fileBytes.slice(0, 16);
  const view = new DataView(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  const params: Argon2Params = {
    t: view.getUint32(16, true),
    m: view.getUint32(20, true),
    p: view.getUint32(24, true),
    dkLen: view.getUint32(28, true),
  };

  // 2. Derive key
  const key = await deriveKEK(zipPassword, salt, params);

  // 3. Decrypt
  const ciphertext = fileBytes.slice(BACKUP_PREAMBLE_SIZE);
  const zipBytes = decrypt(ciphertext, key);

  // 4. Unzip
  const files = unzipSync(zipBytes);

  // 5. Convert to Map
  const result = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(files)) {
    result.set(path, data);
  }

  return result;
}
```

- [ ] **Step 4: Create index.ts**

```typescript
// packages/core/src/export-import-zip/index.ts
/**
 * Encrypted vault backup export/import.
 *
 * @module export-import-zip
 */

export { collectVaultFiles } from './collect-vault-files.js';
export { exportEncryptedBackup, BACKUP_PREAMBLE_SIZE } from './encrypted-export.js';
export { importEncryptedBackup } from './encrypted-import.js';
```

- [ ] **Step 5.5: Add export-import-zip tsup entry point**

Add to the `entry` array in `packages/core/tsup.config.ts` (this was deferred from Task 4 because the source didn't exist yet):

```typescript
    'src/export-import-zip/index.ts',
```

Also add `"./export-import-zip"` to `packages/core/package.json` exports if not already present.

- [ ] **Step 5: Run all export-import-zip tests**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core exec vitest run src/export-import-zip/`
Expected: All 9 tests PASS (3 collect + 3 export + 3 import)

- [ ] **Step 6: Run full core test suite**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/export-import-zip/
git commit -m "feat(core): add encrypted vault backup import with round-trip verification"
```

---

## Task 8: Desktop — Settings Screen & Routes

**Files:**
- Modify: `apps/desktop/src/screens/SettingsScreen.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Add Upload icon import to SettingsScreen**

In `apps/desktop/src/screens/SettingsScreen.tsx`, add `Upload` to the lucide-react import (line 1 area, alongside existing `Download`, `Cloud`, etc.):

```typescript
import { ..., Upload, Download, ... } from 'lucide-react';
```

- [ ] **Step 2: Replace disabled Export row and add Import row**

In `apps/desktop/src/screens/SettingsScreen.tsx`, replace the disabled Export Vault `SettingRow` (around line 408-413):

```typescript
        <SettingRow
          icon={<Upload size={18} />}
          label="Import Passwords"
          subtitle="Import from CSV or encrypted backup"
          onClick={() => navigate('/vault/settings/import')}
        />
        <SettingRow
          icon={<Download size={18} />}
          label="Export Vault"
          subtitle="Export as CSV or encrypted backup"
          onClick={() => navigate('/vault/settings/export')}
        />
```

- [ ] **Step 3: Add routes to App.tsx**

In `apps/desktop/src/App.tsx`, add two routes inside the `/vault` route group, after the `settings/sync` route:

```typescript
      <Route path="settings/import" element={<ImportScreen />} />
      <Route path="settings/export" element={<ExportScreen />} />
```

And add the imports at the top:

```typescript
import { ImportScreen } from './screens/ImportScreen';
import { ExportScreen } from './screens/ExportScreen';
```

- [ ] **Step 4: Create placeholder screens (to verify routing works)**

Create `apps/desktop/src/screens/ImportScreen.tsx`:

```typescript
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../lib/theme';

export function ImportScreen() {
  const { theme } = useTheme();
  const navigate = useNavigate();

  return (
    <div style={{ padding: 24, color: theme.colors.text }}>
      <button onClick={() => navigate('/vault/settings')} style={{ marginBottom: 16 }}>
        &larr; Back
      </button>
      <h1>Import Passwords</h1>
      <p>Coming soon</p>
    </div>
  );
}
```

Create `apps/desktop/src/screens/ExportScreen.tsx`:

```typescript
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../lib/theme';

export function ExportScreen() {
  const { theme } = useTheme();
  const navigate = useNavigate();

  return (
    <div style={{ padding: 24, color: theme.colors.text }}>
      <button onClick={() => navigate('/vault/settings')} style={{ marginBottom: 16 }}>
        &larr; Back
      </button>
      <h1>Export Vault</h1>
      <p>Coming soon</p>
    </div>
  );
}
```

- [ ] **Step 5: Verify desktop builds**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/desktop build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/screens/SettingsScreen.tsx apps/desktop/src/App.tsx apps/desktop/src/screens/ImportScreen.tsx apps/desktop/src/screens/ExportScreen.tsx
git commit -m "feat(desktop): add import/export routes and settings rows"
```

---

## Task 9: Desktop — Import Screen (Full Implementation)

**Files:**
- Modify: `apps/desktop/src/screens/ImportScreen.tsx`

- [ ] **Step 1: Implement the full ImportScreen**

Replace the placeholder `apps/desktop/src/screens/ImportScreen.tsx` with the full implementation. Key behaviors:

- Two tabs: "From CSV" and "From Encrypted Backup"
- CSV tab: file input (accept `.csv`), auto-detect source badge, source override dropdown, merge/replace toggle, preview summary, confirm button
- Encrypted tab: file input (accept `.keykeykey`), zip password input, merge/replace toggle, optional master password input for merge, confirm button
- Uses `useVault()` context for `addItem()` and `items` (for dedup)
- Uses `importPasswordsCsv`, `detectSource` from `@keykeykey/core/import`
- Uses `findDuplicates` from `@keykeykey/core/import`
- Uses `importEncryptedBackup` from `@keykeykey/core/export-import-zip`
- File reading via `FileReader` API (works in Tauri webview)
- Shows toast on success/error
- Back button navigates to `/vault/settings`

The screen should follow the existing SettingsScreen inline-style patterns (no CSS modules), use the `useTheme()` hook for colors, and use `useNavigate()` for routing.

Reference existing screen patterns:
- `apps/desktop/src/screens/SyncSettingsScreen.tsx` — for form layout with inputs and buttons
- `apps/desktop/src/screens/SettingsScreen.tsx` — for section headers and toggle patterns

- [ ] **Step 2: Verify it builds**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/desktop build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/screens/ImportScreen.tsx
git commit -m "feat(desktop): implement full import screen with CSV and encrypted backup"
```

---

## Task 10: Desktop — Export Screen (Full Implementation)

**Files:**
- Modify: `apps/desktop/src/screens/ExportScreen.tsx`

- [ ] **Step 1: Implement the full ExportScreen**

Replace the placeholder `apps/desktop/src/screens/ExportScreen.tsx`. Key behaviors:

- Two sections: "Export as CSV" and "Export Encrypted Backup"
- CSV section: warning text showing credential count, Export CSV button
- Encrypted section: zip password + confirm inputs, Export Backup button
- Uses `useVault()` context for `items`
- Uses `exportToCsv` from `@keykeykey/core/export`
- Uses `exportEncryptedBackup` from `@keykeykey/core/export-import-zip`
- File saving via Tauri `dialog.save()` + `fs.writeBinaryFile()` / `fs.writeTextFile()`
  - Import Tauri APIs: `import { save } from '@tauri-apps/plugin-dialog'` and `import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs'`
  - CSV default filename: `keykeykey-export-YYYY-MM-DD.csv`
  - Backup default filename: `keykeykey-backup-YYYY-MM-DD.keykeykey`
- Shows progress during Argon2id derivation for encrypted export
- Back button navigates to `/vault/settings`

Reference: check how `apps/desktop/src/screens/SyncSettingsScreen.tsx` handles form state with useState and button loading states.

- [ ] **Step 2: Verify it builds**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/desktop build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/screens/ExportScreen.tsx
git commit -m "feat(desktop): implement full export screen with CSV and encrypted backup"
```

---

## Task 11: Extension — Settings & Navigation

**Files:**
- Modify: `apps/extension/src/popup/screens/SettingsScreen.tsx`
- Modify: `apps/extension/src/popup/Popup.tsx`

- [ ] **Step 1: Add Import and Export rows to extension SettingsScreen**

In `apps/extension/src/popup/screens/SettingsScreen.tsx`, add to the Sync/Data section (look for the Cloud Sync row as reference):

Two new clickable rows with `onNavigate` callback:
- "Import Passwords" → `onNavigate('import')`
- "Export Vault" → `onNavigate('export')`

The SettingsScreen receives `onNavigate` as a prop — check the existing `onNavigate('sync-settings')` pattern.

- [ ] **Step 2: Add import/export screens to Popup.tsx navigation**

In `apps/extension/src/popup/Popup.tsx`, add screen cases for `'import'` and `'export'` in the render logic, following the existing pattern for `sync-settings`. In the `handleBack` function, add the import/export case right before the `sync-settings` case (near the top of the if/else chain, before the generic fallback):

```typescript
if (screen === 'import' || screen === 'export') setScreen('settings');
```

Import the new screens (placeholder for now):

```typescript
import { ImportScreen } from './screens/ImportScreen';
import { ExportScreen } from './screens/ExportScreen';
```

- [ ] **Step 3: Create placeholder extension screens**

Create `apps/extension/src/popup/screens/ImportScreen.tsx` and `ExportScreen.tsx` with minimal placeholder content following the extension's inline-style pattern. Both receive `onBack` and `onRefresh` props (check existing screen prop patterns in Popup.tsx).

- [ ] **Step 4: Verify extension builds**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/popup/screens/SettingsScreen.tsx apps/extension/src/popup/Popup.tsx apps/extension/src/popup/screens/ImportScreen.tsx apps/extension/src/popup/screens/ExportScreen.tsx
git commit -m "feat(extension): add import/export navigation and placeholder screens"
```

---

## Task 12: Extension — Import & Export Screens (Full Implementation)

**Files:**
- Modify: `apps/extension/src/popup/screens/ImportScreen.tsx`
- Modify: `apps/extension/src/popup/screens/ExportScreen.tsx`

- [ ] **Step 1: Implement extension ImportScreen**

Same flow as desktop but adapted to extension patterns:
- Uses `sendMessage()` IPC to communicate with background worker for vault operations
- File input via `<input type="file" accept=".csv,.keykeykey">`
- Reads files via `FileReader` API
- Uses extension theme system (`theme.spacing`, `theme.colors`, `theme.radii`)
- Container matches popup width constraints (`380px`)
- For import operations: read CSV/backup in popup, then send parsed items to background via messages

Check how the extension AddItemScreen handles form state and messages for the exact IPC pattern.

- [ ] **Step 2: Implement extension ExportScreen**

Same flow as desktop but:
- Export via `browser.downloads.download()` with a blob URL (works in Chrome, Firefox, Safari)
- `URL.createObjectURL(new Blob([csvString], { type: 'text/csv' }))` for CSV
- `URL.createObjectURL(new Blob([backupBytes], { type: 'application/octet-stream' }))` for encrypted backup
- Clean up blob URLs with `URL.revokeObjectURL()` after download starts

- [ ] **Step 3: Verify extension builds**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/popup/screens/ImportScreen.tsx apps/extension/src/popup/screens/ExportScreen.tsx
git commit -m "feat(extension): implement full import/export screens"
```

---

## Task 13: Mobile — Settings & Routes

**Files:**
- Modify: `apps/mobile/app/(tabs)/settings.tsx`
- Modify: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/settings/import.tsx`
- Create: `apps/mobile/app/settings/export.tsx`

- [ ] **Step 1: Add Import and Export rows to mobile settings**

In `apps/mobile/app/(tabs)/settings.tsx`, replace the disabled "Export Vault" row (around line 211-216) with:

```typescript
          <SettingRow
            icon="cloud-upload-outline"
            label="Import Passwords"
            subtitle="Import from CSV or encrypted backup"
            onPress={() => router.push('/settings/import')}
          />
          <SettingRow
            icon="swap-horizontal-outline"
            label="Export Vault"
            subtitle="Export as CSV or encrypted backup"
            onPress={() => router.push('/settings/export')}
          />
```

- [ ] **Step 2: Add stack screens to _layout.tsx**

In `apps/mobile/app/_layout.tsx`, add inside the `<Stack>`:

```typescript
        <Stack.Screen
          name="settings/import"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="settings/export"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
```

- [ ] **Step 3: Create placeholder mobile screens**

Create `apps/mobile/app/settings/import.tsx`:

```typescript
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/theme-provider';
import { Button } from '@/components/Button';

export default function ImportScreen() {
  const router = useRouter();
  const { theme: t } = useTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ padding: 20 }}>
        <Button title="Back" onPress={() => router.back()} />
        <Text style={{ color: t.colors.text, fontSize: 24, marginTop: 16 }}>Import Passwords</Text>
        <Text style={{ color: t.colors.textSecondary, marginTop: 8 }}>Coming soon</Text>
      </View>
    </SafeAreaView>
  );
}
```

Create `apps/mobile/app/settings/export.tsx` with equivalent placeholder.

- [ ] **Step 4: Verify mobile builds (TypeScript check)**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/mobile exec npx tsc --noEmit`
Expected: No type errors (or only pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/(tabs)/settings.tsx apps/mobile/app/_layout.tsx apps/mobile/app/settings/import.tsx apps/mobile/app/settings/export.tsx
git commit -m "feat(mobile): add import/export routes and settings rows"
```

---

## Task 14: Mobile — Import & Export Screens (Full Implementation)

**Files:**
- Modify: `apps/mobile/app/settings/import.tsx`
- Modify: `apps/mobile/app/settings/export.tsx`

- [ ] **Step 1: Implement mobile ImportScreen**

Replace placeholder with full implementation:
- File picker via `expo-document-picker`: `DocumentPicker.getDocumentAsync({ type: ['text/csv', 'application/octet-stream'] })`
- Read file via `expo-file-system`: `FileSystem.readAsStringAsync(uri)` for CSV, `FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })` for binary
- Same two-tab UI (CSV / Encrypted Backup) adapted to React Native
- Uses `useVault()` context for `addItem()` and `items`
- Uses `Alert.alert()` for confirmations and error messages
- Uses React Native `ScrollView`, `View`, `Text`, `Switch` components
- Check if `expo-document-picker` is already a dependency — if not, add it

- [ ] **Step 2: Implement mobile ExportScreen**

Replace placeholder:
- Export via `expo-sharing`: `Sharing.shareAsync(fileUri)` to open share sheet
- Or `expo-file-system`: `FileSystem.writeAsStringAsync()` to save, then share
- Same two sections (CSV / Encrypted) adapted to React Native
- Zip password input with SecureTextEntry
- Progress indicator during Argon2 derivation

- [ ] **Step 3: Verify mobile TypeScript check**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/mobile exec npx tsc --noEmit`
Expected: No new type errors

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/settings/import.tsx apps/mobile/app/settings/export.tsx
git commit -m "feat(mobile): implement full import/export screens"
```

---

## Task 15: Integration Tests & Final Verification

**Files:**
- Run existing test suites to verify nothing is broken

- [ ] **Step 1: Run full core test suite**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core test`
Expected: All tests PASS (including new export, merge, and encrypted backup tests)

- [ ] **Step 2: Run core build**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core build`
Expected: Build succeeds with all new entry points

- [ ] **Step 3: Run desktop tests and build**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/desktop test && pnpm --filter @keykeykey/desktop build`
Expected: All pass

- [ ] **Step 4: Run extension tests and build**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension test && pnpm --filter @keykeykey/extension build`
Expected: All pass

- [ ] **Step 5: Run mobile tests**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/mobile test`
Expected: All pass

- [ ] **Step 6: Run linter and formatter**

Run: `cd /Users/davidneto/keykeykey && pnpm lint && pnpm format:check`
Expected: No errors (fix any that appear)

- [ ] **Step 7: Run critical E2E tests**

Run: `cd /Users/davidneto/keykeykey/e2e && npx playwright test --grep @critical`
Expected: All critical tests pass

- [ ] **Step 8: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address lint/format issues from import/export implementation"
```
