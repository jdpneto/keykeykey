/**
 * 1Password CSV importer (headerless format).
 *
 * 1Password can export without headers. Based on observed exports, the columns are:
 *   [0]: (empty)
 *   [1]: URL or notes/description
 *   [2]: (empty)
 *   [3]: Title (often the URL again for logins)
 *   [4]: Type ("Login", "Identity", "Credit Card", "Secure Note", etc.)
 *   [5]: Username
 *   [6]: Password
 *   [7]: (empty — trailing comma)
 *
 * Strategy:
 * - No header row — uses positional column indices
 * - Only imports rows with type "Login" (skips Identity, Credit Card, etc.)
 * - Derives name from column 3 (Title), falling back to column 1 (URL)
 * - Extracts hostname from URL for a cleaner name
 */

import { parseCsv } from '../csv-parser.js';
import type { ImportedCredential, SkippedRow } from '../types.js';

/** Column indices for the headerless 1Password format. */
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

    // Need at least 7 columns for the expected format
    if (row.length < 7) {
      skipped.push({ row: i + 1, reason: 'Too few columns' });
      continue;
    }

    const type = row[COL.TYPE]?.trim() ?? '';

    // Only import Login entries
    if (type !== 'Login') {
      skipped.push({
        row: i + 1,
        reason: `Non-login type: "${type}"`,
      });
      continue;
    }

    const username = row[COL.USERNAME]?.trim() ?? '';
    const password = row[COL.PASSWORD]?.trim() ?? '';

    // Skip rows with no credentials
    if (!username && !password) {
      skipped.push({ row: i + 1, reason: 'No username or password' });
      continue;
    }

    const title = row[COL.TITLE]?.trim() ?? '';
    const urlOrNotes = row[COL.NOTES_OR_URL]?.trim() ?? '';
    const url = isUrl(title) ? title : isUrl(urlOrNotes) ? urlOrNotes : '';

    items.push({
      name: deriveNameFromUrl(title) || deriveNameFromUrl(urlOrNotes),
      url: normalizeUrl(url),
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

function normalizeUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    }
  } catch {
    // Not a valid URL
  }
  return url;
}
