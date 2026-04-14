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
