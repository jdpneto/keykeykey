/**
 * Types for the password import system.
 *
 * Defines the common intermediate representation that all source-specific
 * importers produce. This IR is then converted into VaultItem objects.
 */

/**
 * Supported import sources.
 */
export type ImportSource = 'chrome' | 'firefox' | 'bitwarden' | 'icloud' | '1password';

/**
 * A single imported credential in intermediate representation.
 *
 * This is the normalized form that all importers produce before
 * conversion into VaultItem. Fields may be empty strings if not
 * provided by the source format.
 */
export interface ImportedCredential {
  name: string;
  url: string;
  username: string;
  password: string;
  notes: string;
  totp: string;
  /** Original folder/group from the source, if available. */
  folder: string;
  /** Whether the item was marked as favorite in the source. */
  favorite: boolean;
}

/**
 * Result of an import operation.
 */
export interface ImportResult {
  /** Successfully parsed credentials. */
  items: ImportedCredential[];
  /** Rows that were skipped (with reason). */
  skipped: SkippedRow[];
  /** The detected or specified source. */
  source: ImportSource;
}

/**
 * A row that was skipped during import.
 */
export interface SkippedRow {
  /** 1-based row number in the original CSV. */
  row: number;
  /** Why the row was skipped. */
  reason: string;
}
