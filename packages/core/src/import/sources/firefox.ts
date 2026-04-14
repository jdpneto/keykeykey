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
    const appIdentifiers =
      classification.kind === 'appIdentifier' ? [classification.value] : [];

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
