package com.keykeykey.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * A user's decision in the autofill picker to associate a credential with the
 * requesting app (or web domain) it did not previously match.
 */
data class PendingLink(
    val itemId: String,
    /** Android package name of the requesting app, when the fill target was an app. */
    val appIdentifier: String?,
    /** Web domain of the requesting page, when the fill target was a browser form. */
    val webDomain: String?,
)

/**
 * Durable store for "link this credential to this app" decisions made in the
 * autofill picker.
 *
 * The autofill process cannot write vault items itself (CryptoBridge is
 * decrypt-only and DatabaseReader is read-only — vault writes must go through
 * the TS core so sync metadata stays correct). So link decisions are parked
 * here, in SharedPreferences:
 *
 *  1. [AutofillPicker] records a decision via [add] and the matchers consult
 *     [matches] so the link takes effect immediately for subsequent fills.
 *  2. The main app drains the store after unlock (AutofillSaveDataModule
 *     `consumePendingLinks` / `clearPendingLinks`) and applies each link to
 *     the credential's `appIdentifiers` / `url` through the core store,
 *     which persists and syncs it properly.
 *
 * SharedPreferences (not the in-memory [AutofillSaveData] pattern) because a
 * link must survive process death — the user may not open the main app for
 * days while still expecting the linked credential to be suggested.
 */
object PendingLinkStore {

    private const val PREFS = "kkk_autofill_pending_links"
    private const val KEY_LINKS = "links"

    @Synchronized
    fun add(context: Context, link: PendingLink) {
        val links = all(context)
        if (links.any { it == link }) return
        val updated = links + link
        prefs(context).edit().putString(KEY_LINKS, encode(updated)).apply()
    }

    @Synchronized
    fun all(context: Context): List<PendingLink> {
        val json = prefs(context).getString(KEY_LINKS, null) ?: return emptyList()
        return decode(json)
    }

    @Synchronized
    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_LINKS).apply()
    }

    /**
     * Whether a pending link associates [itemId] with the given fill target.
     * Used by the matchers as an overlay until the main app has folded the
     * link into the credential itself.
     */
    fun matches(
        links: List<PendingLink>,
        itemId: String,
        packageName: String?,
        webDomain: String?,
    ): Boolean = links.any { link ->
        link.itemId == itemId &&
            (
                (link.appIdentifier != null && link.appIdentifier == packageName) ||
                    (link.webDomain != null && link.webDomain == webDomain)
                )
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ── JSON (de)serialization — pure, JVM-testable ────────────────────

    fun encode(links: List<PendingLink>): String {
        val arr = JSONArray()
        for (link in links) {
            arr.put(
                JSONObject().apply {
                    put("itemId", link.itemId)
                    link.appIdentifier?.let { put("appIdentifier", it) }
                    link.webDomain?.let { put("webDomain", it) }
                },
            )
        }
        return arr.toString()
    }

    fun decode(json: String): List<PendingLink> = try {
        val arr = JSONArray(json)
        (0 until arr.length()).mapNotNull { i ->
            val obj = arr.optJSONObject(i) ?: return@mapNotNull null
            val itemId = obj.optString("itemId", "")
            if (itemId.isEmpty()) return@mapNotNull null
            PendingLink(
                itemId = itemId,
                appIdentifier = obj.optString("appIdentifier", "").ifEmpty { null },
                webDomain = obj.optString("webDomain", "").ifEmpty { null },
            )
        }
    } catch (_: Exception) {
        emptyList()
    }
}
