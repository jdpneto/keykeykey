import { parse } from 'tldts';
import type { VaultItem } from '../models/vault-item.js';

/**
 * Normalize a URL by ensuring it has a protocol.
 * Used before saving to vault (Zod's z.string().url() requires protocol).
 */
export function normalizeUrl(url: string): string {
  if (!url) return url;
  if (!url.includes('://')) return `https://${url}`;
  return url;
}

/**
 * Extract the "brand" name from a URL for use as a credential name.
 *
 * Examples:
 * - `https://login.github.com/oauth` → `github`
 * - `https://www.bbc.co.uk` → `bbc`
 * - `http://localhost:3000` → `localhost`
 */
export function extractDomainBrand(url: string): string {
  if (!url) return '';

  const normalized = normalizeUrl(url);

  let hostname: string;
  try {
    hostname = new URL(normalized).hostname;
  } catch {
    return '';
  }

  // Handle IP addresses and localhost
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname === 'localhost') {
    return hostname;
  }

  const parsed = parse(hostname);
  if (!parsed.domain) return hostname;

  return parsed.domainWithoutSuffix ?? hostname;
}

/**
 * Find credentials whose stored URL domain matches the given hostname.
 * Uses contains-based matching on the domainWithoutSuffix.
 * Only matches `credential` type items that have a `url` field.
 */
export function matchCredentialsByDomain(hostname: string, items: VaultItem[]): VaultItem[] {
  const queryParsed = parse(hostname);
  const queryDomain = queryParsed.domainWithoutSuffix?.toLowerCase();
  if (!queryDomain) return [];

  return items.filter((item) => {
    if (item.type !== 'credential' || !item.url) return false;

    let itemHostname: string;
    try {
      const norm = item.url.includes('://') ? item.url : `https://${item.url}`;
      itemHostname = new URL(norm).hostname;
    } catch {
      return false;
    }

    const itemParsed = parse(itemHostname);
    const itemDomain = itemParsed.domainWithoutSuffix?.toLowerCase();
    if (!itemDomain) return false;

    return itemDomain.includes(queryDomain) || queryDomain.includes(itemDomain);
  });
}
