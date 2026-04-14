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
    const appIdentifiers =
      classification.kind === 'appIdentifier' ? [classification.value] : [];

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
