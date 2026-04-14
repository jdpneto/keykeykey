/**
 * iCloud Keychain / Apple Passwords CSV importer.
 *
 * iCloud exports:
 * Title,URL,Username,Password,Notes,OTPAuth
 *
 * Strategy:
 * - Uses Title directly as the item name
 * - Title often includes the username in parentheses, e.g. "site.com (user@email.com)"
 *   — we keep the full title as the name for context
 * - Preserves OTPAuth URIs as TOTP seeds
 * - Notes are preserved
 */

import { parseCsv } from '../csv-parser.js';
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

    // Skip rows with no credentials
    if (!username && !password) {
      skipped.push({ row: i + 2, reason: 'No username or password' });
      continue;
    }

    const rawUrl = col(row, 'url');
    const title = col(row, 'title');

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

function normalizeUrl(url: string): string {
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
