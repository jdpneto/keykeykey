package com.keykeykey.app

import android.net.Uri

/**
 * Domain matching utilities for autofill credential selection.
 *
 * Extracts hosts from URIs and matches credentials
 * by domain or Android app package identifier.
 */
object DomainMatcher {

    /**
     * Extract the host from a URL or bare domain string.
     *
     * Normalizes bare domains (no scheme) by prepending "https://".
     * Returns the host portion of the parsed URI.
     *
     * @param input A URL or bare domain (e.g., "https://example.com/path" or "example.com")
     * @return The host/domain, or null if parsing fails
     */
    fun extractHost(input: String): String? {
        val normalized = if (!input.contains("://")) "https://$input" else input
        return try {
            Uri.parse(normalized)?.host?.lowercase()
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Check if a credential's associated app identifiers match a given package name.
     *
     * @param credentialAppIds List of app identifiers associated with a credential
     * @param packageName The requesting app's package name
     * @return true if any identifier matches
     */
    fun matchesByAppIdentifier(credentialAppIds: List<String>, packageName: String): Boolean {
        return credentialAppIds.any { it.equals(packageName, ignoreCase = true) }
    }

    /**
     * Check if a credential's associated domains match a given domain.
     *
     * Compares extracted hosts for both the credential URIs
     * and the target domain.
     *
     * @param credentialUris List of URIs/domains associated with a credential
     * @param targetDomain The domain to match against (from autofill request)
     * @return true if any credential URI matches the target domain
     */
    fun matchesByDomain(credentialUris: List<String>, targetDomain: String): Boolean {
        val target = extractHost(targetDomain) ?: return false
        return credentialUris.any { uri ->
            extractHost(uri) == target
        }
    }
}
