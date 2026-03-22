/**
 * CSV vault exporter — exports credential-type items to a standard CSV.
 *
 * Only credentials are exported (cards and secure notes are excluded).
 * The output format is compatible with Chrome/Firefox/iCloud CSV import.
 */

import type { VaultItem } from '../models/vault-item.js';
import type { Credential } from '../models/credential.js';
import { serializeCsv } from './csv-serializer.js';

const HEADERS = ['name', 'url', 'username', 'password', 'notes', 'totp', 'folder', 'favorite'];

function isCredential(item: VaultItem): item is Credential {
  return item.type === 'credential';
}

/**
 * Export vault items to CSV string.
 *
 * Filters to credential type only. Maps tags to semicolon-delimited folder column.
 * Excludes passwordHistory and appIdentifiers.
 */
export function exportToCsv(items: VaultItem[]): string {
  const credentials = items.filter(isCredential);

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
