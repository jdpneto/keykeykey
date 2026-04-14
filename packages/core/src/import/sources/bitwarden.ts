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
    const appIdentifiers =
      classification.kind === 'appIdentifier' ? [classification.value] : [];

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
