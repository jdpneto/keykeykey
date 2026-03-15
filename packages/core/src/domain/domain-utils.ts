import { parse } from 'tldts';
import type { Credential } from '../models/credential.js';
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

    return itemDomain === queryDomain;
  });
}

/**
 * Find credentials whose stored appIdentifiers contain the given app identifier.
 * Uses case-insensitive matching. Only matches `credential` type items
 * that have a non-empty `appIdentifiers` array.
 */
export function matchCredentialsByAppIdentifier(
  appId: string,
  items: VaultItem[],
): VaultItem[] {
  const lowerAppId = appId.toLowerCase();
  return items.filter((item) => {
    if (item.type !== 'credential') return false;
    const credential = item as Credential;
    if (!credential.appIdentifiers || credential.appIdentifiers.length === 0) return false;
    return credential.appIdentifiers.some((id) => id.toLowerCase() === lowerAppId);
  });
}

/**
 * Combined credential matcher: finds items matching by app identifier and/or domain,
 * returning a deduplicated list (app ID matches first, then domain matches).
 */
export function matchCredentials(
  context: { hostname?: string; appIdentifier?: string },
  items: VaultItem[],
): VaultItem[] {
  const seen = new Set<string>();
  const results: VaultItem[] = [];

  if (context.appIdentifier) {
    for (const item of matchCredentialsByAppIdentifier(context.appIdentifier, items)) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        results.push(item);
      }
    }
  }
  if (context.hostname) {
    for (const item of matchCredentialsByDomain(context.hostname, items)) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        results.push(item);
      }
    }
  }
  return results;
}
