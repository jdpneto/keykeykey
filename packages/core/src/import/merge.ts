/**
 * Field-based duplicate detection for import merging.
 *
 * Unlike sync merge (ID-based LWW), import merge compares field values
 * because items from different vaults or CSV imports have different UUIDs.
 */

import type { VaultItem } from '../models/vault-item.js';

export interface MergeResult {
  toImport: VaultItem[];
  skipped: VaultItem[];
}

export function normalizeUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.replace(/^www\./, '');
    let normalized = `${parsed.protocol}//${parsed.hostname}`;
    if (parsed.port) normalized += `:${parsed.port}`;
    const path = parsed.pathname.replace(/\/+$/, '');
    if (path) normalized += path;
    if (parsed.search) normalized += parsed.search;
    return normalized;
  } catch {
    return url;
  }
}

export function findDuplicates(incoming: VaultItem[], existing: VaultItem[]): MergeResult {
  const toImport: VaultItem[] = [];
  const skipped: VaultItem[] = [];

  const credKeys = new Set<string>();
  const cardKeys = new Set<string>();
  const noteKeys = new Set<string>();

  for (const item of existing) {
    switch (item.type) {
      case 'credential':
        credKeys.add(`${item.username}\0${item.password}\0${normalizeUrl(item.url)}`);
        break;
      case 'card':
        cardKeys.add(`${item.cardholderName}\0${item.number}`);
        break;
      case 'secure-note':
        noteKeys.add(`${item.name}\0${item.content}`);
        break;
    }
  }

  for (const item of incoming) {
    let isDuplicate = false;
    switch (item.type) {
      case 'credential':
        isDuplicate = credKeys.has(`${item.username}\0${item.password}\0${normalizeUrl(item.url)}`);
        break;
      case 'card':
        isDuplicate = cardKeys.has(`${item.cardholderName}\0${item.number}`);
        break;
      case 'secure-note':
        isDuplicate = noteKeys.has(`${item.name}\0${item.content}`);
        break;
    }
    if (isDuplicate) {
      skipped.push(item);
    } else {
      toImport.push(item);
    }
  }

  return { toImport, skipped };
}

/** Strip id and timestamps from a VaultItem for re-insertion via addItem. */
export function stripItemMeta(item: VaultItem): Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdAt, updatedAt, ...rest } = item;
  return rest;
}
