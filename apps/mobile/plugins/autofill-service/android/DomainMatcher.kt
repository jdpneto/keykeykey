package com.keykeykey.app

import android.content.Context
import android.net.Uri
import android.util.Log

/**
 * Domain matching utilities for autofill credential selection.
 *
 * Behavior matches the iOS credential provider
 * (`apps/mobile/targets/credential-provider/DomainMatcher.swift`):
 *  - Exact-host equality always wins.
 *  - Otherwise, two hosts match iff their registrable domain (eTLD+1, computed
 *    via the Mozilla Public Suffix List) is equal. This correctly rejects
 *    cross-tenant collisions on shared suffixes like `co.uk`, `github.io`, or
 *    `s3.amazonaws.com`, and accepts sibling subdomains (`mail.google.com` vs
 *    `accounts.google.com`).
 *
 * The PSL must be initialized once at service/activity startup via
 * [initialize]. Without initialization, matchesByDomain falls back to exact-
 * host equality only — which is safe (no false positives) but loses the
 * subdomain-equivalence semantics. Same fallback iOS uses when its bundled
 * PSL data file is missing.
 */
object DomainMatcher {

    @Volatile
    private var psl: PublicSuffixList? = null
    private val initLock = Any()

    /**
     * Idempotent. Loads `public_suffix_list.dat` from the app's assets on first
     * call. Safe to call from any thread; safe to call from multiple entry
     * points (AutofillServiceImpl.onCreate, AuthActivity.onCreate). If the
     * asset is missing or unreadable, logs a warning and continues with the
     * fallback (exact-host match only).
     */
    fun initialize(context: Context) {
        if (psl != null) return
        synchronized(initLock) {
            if (psl != null) return
            try {
                context.applicationContext.assets
                    .open("public_suffix_list.dat")
                    .use { stream ->
                        val instance = PublicSuffixList()
                        instance.loadFromStream(stream)
                        psl = instance
                    }
            } catch (e: Exception) {
                Log.w(
                    "KeyKeyKeyAutofill",
                    "PSL data missing or unreadable; falling back to exact-host matching",
                    e,
                )
            }
        }
    }

    /** Test-only injection point. Pass null to clear. */
    fun setPslForTesting(instance: PublicSuffixList?) {
        psl = instance
    }

    /** Test-only accessor — returns the loaded PSL (or null if init failed). */
    fun pslForTesting(): PublicSuffixList? = psl

    /**
     * Extract the host from a URL or bare domain string.
     *
     * Normalizes bare domains (no scheme) by prepending "https://".
     * Returns the lowercase host portion of the parsed URI.
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
     * Check if a credential's associated app identifiers match a given package
     * name. Exact equality (case-insensitive). No parent-app cross-matching —
     * matches the iOS rule documented in DomainMatcher.swift.
     */
    fun matchesByAppIdentifier(credentialAppIds: List<String>, packageName: String): Boolean {
        return credentialAppIds.any { it.equals(packageName, ignoreCase = true) }
    }

    /**
     * Check if any credential URI matches the target domain.
     *
     * Exact-host wins; otherwise PSL eTLD+1 equality. When PSL is uninitialized
     * the second check is skipped (exact-host only).
     */
    fun matchesByDomain(credentialUris: List<String>, targetDomain: String): Boolean {
        val target = extractHost(targetDomain) ?: return false
        val pslLocal = psl
        return credentialUris.any { uri ->
            val credHost = extractHost(uri) ?: return@any false
            if (credHost == target) return@any true
            if (pslLocal != null) {
                val credReg = pslLocal.registrableDomain(credHost)
                val targetReg = pslLocal.registrableDomain(target)
                if (credReg != null && targetReg != null && credReg == targetReg) {
                    return@any true
                }
            }
            false
        }
    }
}
