/**
 * Password import orchestrator.
 *
 * Provides auto-detection of CSV format and conversion from
 * ImportedCredential intermediate representation to VaultItem.
 *
 * @module import
 */

import { parseChromeCsv } from './sources/chrome.js';
import { parseFirefoxCsv } from './sources/firefox.js';
import { parseBitwardenCsv } from './sources/bitwarden.js';
import { parseICloudCsv } from './sources/icloud.js';
import { parseOnePasswordCsv } from './sources/onepassword.js';
import type { ImportSource, ImportResult, ImportedCredential } from './types.js';
import type { VaultItem } from '../models/vault-item.js';

/**
 * Import passwords from a CSV string.
 *
 * @param csv - Raw CSV content
 * @param source - The password manager source. If omitted, auto-detection is attempted.
 * @returns Import result with parsed items and skipped rows
 * @throws {Error} If the source cannot be detected or the CSV is malformed
 */
export function importFromCsv(csv: string, source?: ImportSource): ImportResult {
  const detectedSource = source ?? detectSource(csv);
  const { items, skipped } = parseBySource(csv, detectedSource);

  return {
    items,
    skipped,
    source: detectedSource,
  };
}

/**
 * Convert imported credentials to VaultItem objects ready for vault insertion.
 *
 * Generates UUIDs and timestamps. Items with folders get the folder as a tag.
 *
 * @param credentials - Parsed credentials from importFromCsv
 * @returns Array of VaultItem objects (without id/timestamps, ready for addItem)
 */
export function toVaultItems(
  credentials: ImportedCredential[],
): Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[] {
  return credentials.map((cred) => {
    const tags: string[] = [];
    if (cred.folder) {
      tags.push(cred.folder);
    }

    return {
      type: 'credential' as const,
      name: cred.name || 'Unnamed',
      username: cred.username || '',
      password: cred.password || '',
      url: cred.url || undefined,
      notes: cred.notes || undefined,
      totp: cred.totp || undefined,
      tags,
      favorite: cred.favorite,
    };
  });
}

/**
 * Full import pipeline: parse CSV → convert to VaultItems.
 *
 * @param csv - Raw CSV content
 * @param source - The password manager source (auto-detected if omitted)
 * @returns VaultItem-ready objects and import metadata
 */
export function importPasswordsCsv(
  csv: string,
  source?: ImportSource,
): {
  items: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[];
  skipped: ImportResult['skipped'];
  source: ImportSource;
  totalParsed: number;
} {
  const result = importFromCsv(csv, source);
  const vaultItems = toVaultItems(result.items);

  return {
    items: vaultItems,
    skipped: result.skipped,
    source: result.source,
    totalParsed: result.items.length,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseBySource(
  csv: string,
  source: ImportSource,
): { items: ImportedCredential[]; skipped: ImportResult['skipped'] } {
  switch (source) {
    case 'chrome':
      return parseChromeCsv(csv);
    case 'firefox':
      return parseFirefoxCsv(csv);
    case 'bitwarden':
      return parseBitwardenCsv(csv);
    case 'icloud':
      return parseICloudCsv(csv);
    case '1password':
      return parseOnePasswordCsv(csv);
    default:
      throw new Error(`Unsupported import source: ${source}`);
  }
}

/**
 * Auto-detect the CSV source based on header columns.
 *
 * Detection rules (in order):
 * 1. Bitwarden: has "login_uri" and "login_username" columns
 * 2. Firefox: has "httpRealm" or "formActionOrigin" columns
 * 3. iCloud: has "Title" and "OTPAuth" columns
 * 4. Chrome: has "name", "url", "username", "password" columns
 * 5. 1Password: no header row (first row has no recognizable header pattern)
 */
export function detectSource(csv: string): ImportSource {
  // Get the first line
  const firstLineEnd = csv.indexOf('\n');
  const firstLine = (firstLineEnd >= 0 ? csv.slice(0, firstLineEnd) : csv).trim();

  const lowerLine = firstLine.toLowerCase();

  // Bitwarden — most distinctive headers
  if (lowerLine.includes('login_uri') && lowerLine.includes('login_username')) {
    return 'bitwarden';
  }

  // Firefox — unique columns
  if (lowerLine.includes('httprealm') || lowerLine.includes('formactionorigin')) {
    return 'firefox';
  }

  // iCloud — has Title and OTPAuth
  if (lowerLine.includes('title') && lowerLine.includes('otpauth')) {
    return 'icloud';
  }

  // Chrome — has name, url, username, password, note
  if (
    lowerLine.includes('name') &&
    lowerLine.includes('url') &&
    lowerLine.includes('username') &&
    lowerLine.includes('password')
  ) {
    return 'chrome';
  }

  // 1Password — headerless format (first field is typically empty, contains commas)
  // Heuristic: first row starts with a comma or has no recognizable header keywords
  if (firstLine.startsWith(',') || !looksLikeHeaders(firstLine)) {
    return '1password';
  }

  throw new Error('Could not auto-detect CSV source. Please specify the source explicitly.');
}

function looksLikeHeaders(line: string): boolean {
  const headerKeywords = ['url', 'username', 'password', 'name', 'title', 'login', 'note'];
  const lower = line.toLowerCase();
  let matches = 0;
  for (const kw of headerKeywords) {
    if (lower.includes(kw)) matches++;
  }
  // Need at least 3 header-like keywords to consider it a header row
  return matches >= 3;
}
