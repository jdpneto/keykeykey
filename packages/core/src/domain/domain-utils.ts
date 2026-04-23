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
 * Find credentials whose stored URL matches the given hostname.
 *
 * Matching rule: registrable-domain equality via tldts (PSL-aware) with a
 * first-check fallback to exact-host equality. The fallback covers IPs,
 * localhost, IDN hosts where tldts returns no domain, and any other input
 * where the PSL doesn't apply.
 *
 * Must match the semantics of the iOS appex `matchesByDomain` in
 * apps/mobile/targets/credential-provider/DomainMatcher.swift — validated
 * via the shared fixture at __fixtures__/domain-match.json.
 */
export function matchCredentialsByDomain(hostname: string, items: VaultItem[]): VaultItem[] {
  const queryHost = normalizeHost(hostname);
  if (!queryHost) return [];
  // Enable PRIVATE-domain rules so github.io, vercel.app, netlify.app, etc.
  // are treated as public suffixes — each tenant gets a distinct registrable
  // domain. Without this flag, user1.github.io and user2.github.io would
  // collapse to the shared `github.io` and cross-contaminate credentials.
  const pslOpts = { allowPrivateDomains: true } as const;
  const queryDomain = parse(queryHost, pslOpts).domain?.toLowerCase() ?? null;

  return items.filter((item) => {
    if (item.type !== 'credential' || !item.url) return false;

    const itemHost = normalizeHost(item.url);
    if (!itemHost) return false;

    // Exact-host equality first — covers IPs, localhost, bare-port hosts,
    // and IDN cases where tldts returns no registrable domain.
    if (itemHost === queryHost) return true;

    const itemDomain = parse(itemHost, pslOpts).domain?.toLowerCase() ?? null;
    if (!itemDomain || !queryDomain) return false;
    return itemDomain === queryDomain;
  });
}

/**
 * Extract a lowercase ASCII hostname from a URL or bare hostname, stripping
 * scheme, userinfo, port, path. Returns null for unparseable input.
 *
 * Uses the platform URL parser: prepends `https://` for bare hostnames
 * (`URL(string:)` returns nil-host without a scheme), and relies on the
 * parser's built-in IDN handling — the WHATWG URL spec returns Punycode
 * for `hostname` by default on both Node and browsers.
 */
function normalizeHost(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const withScheme = s.includes('://') ? s : `https://${s}`;
  try {
    return new URL(withScheme).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Find credentials whose stored appIdentifiers contain the given app identifier.
 * Uses case-insensitive matching. Only matches `credential` type items
 * that have a non-empty `appIdentifiers` array.
 */
export function matchCredentialsByAppIdentifier(appId: string, items: VaultItem[]): VaultItem[] {
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
