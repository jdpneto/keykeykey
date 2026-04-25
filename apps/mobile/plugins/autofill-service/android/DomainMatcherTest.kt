package com.keykeykey.app

import android.content.Context

// To run: build with Android, execute via adb or connectedAndroidTest.
//   adb shell am instrument ... or call DomainMatcherTest.runAll(context)
//   from a debug build helper.

/**
 * Scaffold for cross-platform DomainMatcher / PSL parity tests.
 *
 * Mirrors the iOS DomainMatcherRunner harness (apps/mobile/ios-tests/
 * DomainMatcherRunner). Cases here are a representative subset of the shared
 * fixture at packages/core/src/domain/__fixtures__/domain-match.json — when
 * adding/removing cases, keep all three (TS / Swift / Kotlin) in sync.
 *
 * Pattern matches CryptoBridgeTest / TotpEngineTest in this directory: an
 * object with hardcoded vectors, runnable via adb.
 */
object DomainMatcherTest {

    data class DomainCase(
        val id: String,
        val storedUrl: String,
        val queryHost: String,
        val shouldMatch: Boolean,
    )

    private val DOMAIN_CASES =
        listOf(
            // Sibling subdomains share registrable domain.
            DomainCase("sibling_subdomain_match", "https://accounts.google.com/signin", "mail.google.com", true),
            // Apex matches subdomain.
            DomainCase("parent_subdomain_match", "https://github.com", "gist.github.com", true),
            // www and apex are the same site.
            DomainCase("www_apex_match", "https://www.example.com", "example.com", true),
            // ccTLD: two sites on `co.uk` are NOT the same.
            DomainCase("cctld_cross_tenant", "https://bob.co.uk", "alice.co.uk", false),
            // PSL entry: github.io is a public suffix; users do NOT cross-match.
            DomainCase("github_io_cross_tenant", "https://user1.github.io", "user2.github.io", false),
            // Different registrable domains never match.
            DomainCase("unrelated", "https://example.com", "example.org", false),
            // Exact host match.
            DomainCase("exact_host", "https://example.com", "example.com", true),
            // IDN parity with iOS / TS: stored Punycode, query Unicode and
            // vice versa must converge to the same registrable domain.
            DomainCase(
                "idn_punycode_stored_unicode_query",
                "https://xn--mnchen-3ya.de",
                "münchen.de",
                true,
            ),
            DomainCase(
                "idn_unicode_stored_punycode_query",
                "https://münchen.de",
                "xn--mnchen-3ya.de",
                true,
            ),
            // Empty/malformed inputs must not collapse to a shared "" host.
            DomainCase("empty_credential_url", "https:///", "example.com", false),
        )

    data class PslCase(val host: String, val expectedEtldPlusOne: String?)

    private val PSL_CASES =
        listOf(
            PslCase("login.example.com", "example.com"),
            PslCase("example.com", "example.com"),
            PslCase("bob.co.uk", "bob.co.uk"),
            PslCase("login.bob.co.uk", "bob.co.uk"),
            PslCase("user.github.io", "user.github.io"),
            PslCase("co.uk", null),
            PslCase("github.io", null),
        )

    data class Result(val pass: Int, val fail: Int, val failures: List<String>)

    /**
     * Run the full suite. Returns a `Result` summary; logs each failure to
     * the Android log under tag "DomainMatcherTest".
     */
    fun runAll(context: Context): Result {
        DomainMatcher.initialize(context.applicationContext)

        val failures = mutableListOf<String>()
        var pass = 0
        var fail = 0

        for (c in DOMAIN_CASES) {
            val got = DomainMatcher.matchesByDomain(listOf(c.storedUrl), c.queryHost)
            if (got == c.shouldMatch) {
                pass++
            } else {
                fail++
                val msg =
                    "DOMAIN ${c.id}: matchesByDomain('${c.storedUrl}', '${c.queryHost}')" +
                        " expected=${c.shouldMatch} got=$got"
                failures.add(msg)
                android.util.Log.e("DomainMatcherTest", msg)
            }
        }

        // PSL eTLD+1 spot-checks. Bypass DomainMatcher and exercise PSL directly.
        val psl = DomainMatcher.pslForTesting()
        if (psl == null) {
            failures.add("PSL not loaded — public_suffix_list.dat missing from assets?")
            fail++
        } else {
            for (c in PSL_CASES) {
                val got = psl.registrableDomain(c.host)
                if (got == c.expectedEtldPlusOne) {
                    pass++
                } else {
                    fail++
                    val msg =
                        "PSL ${c.host}: registrableDomain expected=${c.expectedEtldPlusOne} got=$got"
                    failures.add(msg)
                    android.util.Log.e("DomainMatcherTest", msg)
                }
            }
        }

        return Result(pass = pass, fail = fail, failures = failures)
    }
}
