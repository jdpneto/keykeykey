package com.keykeykey.app

import android.util.Log

// To run: build with Android, execute via adb or call
// PendingLinkStoreTest.runAll() from a debug build helper.
// Pattern matches DomainMatcherTest / CryptoBridgeTest in this directory.

/**
 * Vectors for the pure parts of [PendingLinkStore]: JSON round-trip and the
 * match-overlay predicate. SharedPreferences persistence is intentionally
 * not covered here (needs a device Context); it is exercised end-to-end by
 * the picker link flow.
 */
object PendingLinkStoreTest {

    private const val TAG = "PendingLinkStoreTest"

    fun runAll(): Boolean {
        var pass = true

        // ── encode/decode round-trip ────────────────────────────────────
        val links = listOf(
            PendingLink("item-1", "com.spotify.music", null),
            PendingLink("item-2", null, "login.example.com"),
        )
        val decoded = PendingLinkStore.decode(PendingLinkStore.encode(links))
        pass = check("round-trip", decoded == links) && pass

        // ── decode robustness ───────────────────────────────────────────
        pass = check("decode garbage", PendingLinkStore.decode("not json").isEmpty()) && pass
        pass = check("decode empty array", PendingLinkStore.decode("[]").isEmpty()) && pass
        pass = check(
            "decode drops entries without itemId",
            PendingLinkStore.decode("""[{"appIdentifier":"com.a.b"}]""").isEmpty(),
        ) && pass

        // ── matches() overlay predicate ─────────────────────────────────
        pass = check(
            "app link matches its package",
            PendingLinkStore.matches(links, "item-1", "com.spotify.music", null),
        ) && pass
        pass = check(
            "app link does not match another package",
            !PendingLinkStore.matches(links, "item-1", "com.other.app", null),
        ) && pass
        pass = check(
            "app link does not match another item",
            !PendingLinkStore.matches(links, "item-2", "com.spotify.music", null),
        ) && pass
        pass = check(
            "domain link matches its domain",
            PendingLinkStore.matches(links, "item-2", null, "login.example.com"),
        ) && pass
        pass = check(
            "domain link does not match null domain",
            !PendingLinkStore.matches(links, "item-2", "com.android.chrome", null),
        ) && pass
        pass = check(
            "empty links match nothing",
            !PendingLinkStore.matches(emptyList(), "item-1", "com.spotify.music", "x.com"),
        ) && pass

        Log.i(TAG, if (pass) "ALL PASS" else "FAILURES — see log above")
        return pass
    }

    private fun check(name: String, ok: Boolean): Boolean {
        Log.i(TAG, "${if (ok) "PASS" else "FAIL"}: $name")
        return ok
    }
}
