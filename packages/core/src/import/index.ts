/**
 * Password import module — parse CSV exports from popular password managers.
 *
 * Supported sources: Chrome, Firefox, Bitwarden, iCloud/Apple Passwords, 1Password.
 *
 * @module import
 */

export { importFromCsv, importPasswordsCsv, toVaultItems, detectSource } from './importer.js';

export { parseCsv } from './csv-parser.js';

export { parseChromeCsv } from './sources/chrome.js';
export { parseFirefoxCsv } from './sources/firefox.js';
export { parseBitwardenCsv } from './sources/bitwarden.js';
export { parseICloudCsv } from './sources/icloud.js';
export { parseOnePasswordCsv } from './sources/onepassword.js';

export type { ImportSource, ImportResult, ImportedCredential, SkippedRow } from './types.js';
