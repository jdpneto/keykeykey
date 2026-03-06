/**
 * Chrome password CSV importer.
 *
 * Chrome exports: name, url, username, password, note
 *
 * Strategy:
 * - Uses `name` directly as the item name
 * - Skips entries with no username AND no password (empty bookmarks)
 * - Handles Android app:// URLs by extracting the package name as readable name
 */

import { parseCsv } from '../csv-parser.js';
import type { ImportedCredential, SkippedRow } from '../types.js';

const EXPECTED_HEADERS = ['name', 'url', 'username', 'password', 'note'];

export function parseChromeCsv(csv: string): {
  items: ImportedCredential[];
  skipped: SkippedRow[];
} {
  const { headers, rows } = parseCsv(csv);
  const items: ImportedCredential[] = [];
  const skipped: SkippedRow[] = [];

  // Validate headers
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

    // Skip rows with no credentials
    if (!username && !password) {
      skipped.push({
        row: i + 2,
        reason: 'No username or password',
      });
      continue;
    }

    const rawName = col(row, 'name');
    const rawUrl = col(row, 'url');

    items.push({
      name: rawName || deriveNameFromUrl(rawUrl),
      url: normalizeUrl(rawUrl),
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
 * Extracts a human-readable name from a URL.
 * Handles Android `android://...@com.package/` URIs.
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

/**
 * Normalizes URLs — keeps valid http/https URLs, drops android:// URIs.
 */
function normalizeUrl(url: string): string {
  if (url.startsWith('android://')) return '';
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
