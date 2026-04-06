/**
 * KeyKeyKey CSV importer.
 *
 * KeyKeyKey exports: name, url, username, password, notes, totp, folder, favorite
 *
 * Strategy:
 * - Direct column mapping — all fields are present
 * - Skips entries with no username AND no password
 * - Parses `favorite` as boolean string ("true"/"false")
 */

import { parseCsv } from '../csv-parser.js';
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

    items.push({
      name: col(row, 'name') || 'Unnamed',
      url: col(row, 'url'),
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
