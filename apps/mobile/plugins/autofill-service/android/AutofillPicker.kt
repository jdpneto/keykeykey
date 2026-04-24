package com.keykeykey.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.service.autofill.Dataset
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.Base64
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.RemoteViews
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.Arrays

private const val TAG = "AutofillPicker"

/**
 * Two-screen credential picker shown inside [AuthActivity] after unlock.
 *
 * Screen 1 ("matches"): the default, shown right after unlock. Lists only
 * credentials matching the requesting domain/app, plus "Search all
 * credentials", "Create new", and "Cancel" actions. With the vast majority
 * of autofill requests matching one or two creds, this keeps the list
 * short and the tap count low.
 *
 * Screen 2 ("search"): opened from the matches screen. A full searchable
 * list over the whole vault, for when the user saved the credential under
 * a slightly different domain or wants to use one from another site.
 *
 * When the user picks a credential we return a bare [Dataset] via
 * [AutofillManager.EXTRA_AUTHENTICATION_RESULT]; Android applies it in
 * place with no extra chip-tap. Wrapping it in a [FillResponse] would
 * force a second chip tap — tested + confirmed in the field.
 */
object AutofillPicker {

    /**
     * Data passed from [AutofillServiceImpl] via Intent extras describing
     * the target form. Parcel-read by [AuthActivity] and forwarded here.
     */
    data class TargetContext(
        val usernameIds: List<AutofillId>,
        val passwordIds: List<AutofillId>,
        val otpIds: List<AutofillId>,
        val webDomain: String?,
        val packageName: String?,
    )

    private data class PickerItem(
        val name: String,
        val username: String,
        val password: String,
        val url: String?,
        val totp: String?,
        val isMatch: Boolean,
    ) {
        val searchHaystack: String =
            (name + "\n" + username + "\n" + (url ?: "")).lowercase()

        fun subtitle(): String = when {
            username.isNotEmpty() && !url.isNullOrEmpty() -> "$username · $url"
            username.isNotEmpty() -> username
            !url.isNullOrEmpty() -> url
            else -> ""
        }
    }

    /**
     * Result of trying to decrypt the vault with the DEK we were handed.
     * `DekMismatch` means every encrypted item failed AEAD decryption — the
     * DEK is stale (typically a PIN/biometric wrap that pre-dates a cloud
     * restore). The picker renders a distinct error view in that case so the
     * user knows to re-enable quick-unlock, instead of a misleading "Your
     * vault is empty".
     */
    private sealed class LoadResult {
        data class Ok(val items: List<PickerItem>) : LoadResult()
        object DekMismatch : LoadResult()
    }

    /**
     * Render the picker. Expects the DEK to be valid; caches it and zeroes
     * the caller's copy on return.
     */
    fun render(activity: FragmentActivity, scope: CoroutineScope, dek: ByteArray, target: TargetContext) {
        AutofillDEKCache.set(dek)
        Arrays.fill(dek, 0.toByte())

        activity.setContentView(buildLoadingView(activity))

        scope.launch {
            when (val result = withContext(Dispatchers.IO) { loadItems(activity, target) }) {
                is LoadResult.Ok -> renderMatchesView(activity, scope, target, result.items)
                LoadResult.DekMismatch -> renderDekMismatchView(activity)
            }
        }
    }

    private fun loadItems(context: Context, target: TargetContext): LoadResult {
        val dek = AutofillDEKCache.get() ?: return LoadResult.Ok(emptyList())
        val out = mutableListOf<PickerItem>()
        var attempts = 0
        var failures = 0
        try {
            for (encrypted in DatabaseReader.readCredentials(context)) {
                var plaintext: ByteArray? = null
                attempts++
                try {
                    val ct = Base64.decode(encrypted.encryptedDataBase64, Base64.DEFAULT)
                    plaintext = CryptoBridge.decrypt(ct, dek)
                    val json = JSONObject(String(plaintext, Charsets.UTF_8))
                    val url = json.optString("url", "").ifEmpty { null }
                    val appIds = mutableListOf<String>()
                    json.optJSONArray("appIdentifiers")?.let { arr ->
                        for (j in 0 until arr.length()) {
                            val v = arr.optString(j)
                            if (v != null && v.isNotEmpty()) appIds.add(v)
                        }
                    }
                    val matchesApp = target.packageName?.let {
                        DomainMatcher.matchesByAppIdentifier(appIds, it)
                    } ?: false
                    val matchesDomain = target.webDomain?.let {
                        val urlList = if (url != null) listOf(url) else emptyList()
                        DomainMatcher.matchesByDomain(urlList, it)
                    } ?: false
                    out.add(
                        PickerItem(
                            name = json.optString("name", ""),
                            username = json.optString("username", ""),
                            password = json.optString("password", ""),
                            url = url,
                            totp = json.optString("totp", "").ifEmpty { null },
                            isMatch = matchesApp || matchesDomain,
                        ),
                    )
                } catch (e: Exception) {
                    failures++
                    Log.w(TAG, "Failed to decrypt item ${encrypted.id}", e)
                } finally {
                    plaintext?.let { Arrays.fill(it, 0.toByte()) }
                }
            }
        } finally {
            Arrays.fill(dek, 0.toByte())
        }

        // Every encrypted row on disk failed AEAD decryption with the DEK we
        // were given. On iOS this is surfaced as `VaultAccessError.dekMismatch`;
        // mirror the same UX here. The rest of the Android side only invokes
        // this with a DEK that passed its own KEK unwrap, so there's no
        // "empty DB vs wrong DEK" ambiguity — attempts > 0 implies real items
        // exist that we couldn't decrypt.
        if (attempts > 0 && failures == attempts) {
            return LoadResult.DekMismatch
        }

        return LoadResult.Ok(
            out.sortedWith(
                compareByDescending<PickerItem> { it.isMatch }
                    .thenBy { it.name.lowercase() }
                    .thenBy { it.username.lowercase() },
            ),
        )
    }

    // ── Matches screen ─────────────────────────────────────────────────

    private fun renderMatchesView(
        activity: FragmentActivity,
        scope: CoroutineScope,
        target: TargetContext,
        items: List<PickerItem>,
    ) {
        val ctx = activity
        val dp = ctx.resources.displayMetrics.density
        fun px(value: Float): Int = (value * dp).toInt()

        val matches = items.filter { it.isMatch }
        val siteLabel = target.webDomain ?: target.packageName ?: "this site"

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(px(20f), px(24f), px(20f), px(16f))
        }

        val title = TextView(ctx).apply {
            text = "Passwords for $siteLabel"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.BLACK)
        }
        root.addView(title)

        val listContainer = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f,
            ).apply { topMargin = px(12f) }
        }
        root.addView(listContainer)

        if (matches.isEmpty()) {
            listContainer.gravity = Gravity.CENTER
            val empty = TextView(ctx).apply {
                text = "No saved passwords for $siteLabel."
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                setTextColor(0xFF666666.toInt())
                gravity = Gravity.CENTER
            }
            listContainer.addView(empty)
        } else {
            val adapter = CredentialAdapter(ctx)
            adapter.replace(matches)
            val listView = ListView(ctx).apply {
                this.adapter = adapter
                dividerHeight = px(1f)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.MATCH_PARENT,
                )
                setOnItemClickListener { _, _, position, _ ->
                    val item = adapter.getItem(position) ?: return@setOnItemClickListener
                    fillWithCredential(activity, target, item)
                }
            }
            listContainer.addView(listView)
        }

        // Actions below the list: search / create / cancel.
        root.addView(
            actionButton(ctx, "🔍 Search all credentials") {
                renderSearchView(activity, scope, target, items)
            },
        )
        root.addView(
            actionButton(ctx, "+ Create new for $siteLabel") {
                launchCreateFlow(activity, target)
            },
        )
        root.addView(
            actionButton(ctx, "Cancel", primary = false) {
                activity.setResult(Activity.RESULT_CANCELED)
                activity.finish()
            },
        )

        activity.setContentView(root)
    }

    // ── Search screen ─────────────────────────────────────────────────

    private fun renderSearchView(
        activity: FragmentActivity,
        scope: CoroutineScope,
        target: TargetContext,
        items: List<PickerItem>,
    ) {
        val ctx = activity
        val dp = ctx.resources.displayMetrics.density
        fun px(value: Float): Int = (value * dp).toInt()

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(px(20f), px(24f), px(20f), px(16f))
        }

        val headerRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val backBtn = Button(ctx).apply {
            text = "‹ Back"
            setOnClickListener {
                renderMatchesView(activity, scope, target, items)
            }
        }
        headerRow.addView(backBtn)
        val title = TextView(ctx).apply {
            text = "Search all credentials"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.BLACK)
            layoutParams = LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f,
            ).apply { leftMargin = px(8f) }
        }
        headerRow.addView(title)
        root.addView(headerRow)

        val search = EditText(ctx).apply {
            hint = "Search by name, username, URL…"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_FILTER
            setSingleLine(true)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = px(12f) }
        }
        root.addView(search)
        // Auto-focus search so the keyboard comes up immediately — the
        // whole reason the user opened this screen is to type a query.
        search.requestFocus()

        val empty = TextView(ctx).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(0xFF888888.toInt())
            gravity = Gravity.CENTER
            visibility = View.GONE
            setPadding(0, px(32f), 0, px(32f))
        }
        root.addView(empty)

        val adapter = CredentialAdapter(ctx)
        val listView = ListView(ctx).apply {
            this.adapter = adapter
            dividerHeight = px(1f)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f,
            ).apply { topMargin = px(8f) }
            setOnItemClickListener { _, _, position, _ ->
                val item = adapter.getItem(position) ?: return@setOnItemClickListener
                fillWithCredential(activity, target, item)
            }
        }
        root.addView(listView)

        root.addView(
            actionButton(ctx, "Cancel", primary = false) {
                activity.setResult(Activity.RESULT_CANCELED)
                activity.finish()
            },
        )

        fun applyFilter(query: String) {
            val q = query.trim().lowercase()
            val visible = if (q.isEmpty()) emptyList() else items.filter { it.searchHaystack.contains(q) }
            adapter.replace(visible)
            empty.text = when {
                items.isEmpty() -> "Your vault is empty."
                q.isEmpty() -> "Start typing to search your credentials."
                visible.isEmpty() -> "No credentials matching \"$query\"."
                else -> ""
            }
            empty.visibility = if (adapter.count == 0) View.VISIBLE else View.GONE
        }
        applyFilter("")

        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) { applyFilter(s?.toString() ?: "") }
        })

        activity.setContentView(root)
    }

    // ── Result handling ───────────────────────────────────────────────

    private fun fillWithCredential(
        activity: FragmentActivity,
        target: TargetContext,
        item: PickerItem,
    ) {
        val dataset = buildDataset(activity, target, item)
        if (dataset == null) {
            Log.w(TAG, "Could not build dataset — no autofill IDs")
            activity.setResult(Activity.RESULT_CANCELED)
            activity.finish()
            return
        }
        // Dataset-level authentication (set up in AutofillServiceImpl's
        // buildUnlockDataset) expects a replacement Dataset back in
        // EXTRA_AUTHENTICATION_RESULT. Android then applies it directly
        // into the form — no second chip-tap. Wrapping in a FillResponse
        // would make Android re-show it as a chip first.
        val result = Intent().apply {
            putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset)
        }
        Log.i(
            TAG,
            "fillWithCredential: credential='${item.name}' user='${item.username}' " +
                "usernameIds=${target.usernameIds.size} passwordIds=${target.passwordIds.size} " +
                "otpIds=${target.otpIds.size}",
        )
        activity.setResult(Activity.RESULT_OK, result)
        activity.finish()
    }

    private fun buildDataset(
        context: Context,
        target: TargetContext,
        item: PickerItem,
    ): Dataset? {
        if (target.usernameIds.isEmpty() && target.passwordIds.isEmpty() && target.otpIds.isEmpty()) {
            return null
        }

        val otpCode = if (target.otpIds.isNotEmpty() && item.totp != null) {
            runCatching {
                val params = OtpAuthParser.parse(item.totp)
                TotpEngine.generateTotpCode(params)
            }.onFailure { Log.w(TAG, "Failed to derive TOTP code", it) }.getOrNull()
        } else {
            null
        }

        val presentation = RemoteViews(context.packageName, android.R.layout.simple_list_item_1).apply {
            val base = if (item.username.isNotEmpty()) "${item.name} (${item.username})" else item.name
            val text = if (otpCode != null) "$base · 2FA $otpCode" else base
            setTextViewText(android.R.id.text1, text)
        }

        val builder = Dataset.Builder(presentation)
        for (id in target.usernameIds) {
            builder.setValue(id, AutofillValue.forText(item.username))
        }
        for (id in target.passwordIds) {
            builder.setValue(id, AutofillValue.forText(item.password))
        }
        if (otpCode != null) {
            for (id in target.otpIds) {
                builder.setValue(id, AutofillValue.forText(otpCode))
            }
        }
        return builder.build()
    }

    private fun launchCreateFlow(activity: FragmentActivity, target: TargetContext) {
        // Deep-link into the add-item screen with the requesting site's
        // domain / package as query params. The RN add-item screen reads
        // `domain` and `appId` via useLocalSearchParams and pre-fills URL /
        // brand / app-ids.
        val uri = Uri.Builder().apply {
            scheme("keykeykey")
            authority("item")
            appendPath("add")
            target.webDomain?.let { appendQueryParameter("domain", it) }
            target.packageName?.let { appendQueryParameter("appId", it) }
        }.build()

        val deepLink = Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP,
            )
            setPackage(activity.packageName)
        }

        val started = runCatching { activity.startActivity(deepLink) }.isSuccess
        if (!started) {
            activity.packageManager.getLaunchIntentForPackage(activity.packageName)?.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }?.let { activity.startActivity(it) }
        }
        activity.setResult(Activity.RESULT_CANCELED)
        activity.finish()
    }

    // ── DEK-mismatch error screen ─────────────────────────────────────

    /**
     * Rendered when every encrypted item on disk failed to decrypt with the
     * DEK we just unwrapped via PIN or biometric. On iOS the equivalent alert
     * lives in the credential-provider appex (see `VaultAccessError.dekMismatch`
     * handling in CredentialProviderViewController.swift). Same message, same
     * "open main app and re-enable quick unlock" instruction. Without this,
     * the picker falls back to its generic empty-vault state and the user
     * thinks their credentials are gone.
     */
    private fun renderDekMismatchView(activity: FragmentActivity) {
        val ctx = activity
        val dp = ctx.resources.displayMetrics.density
        fun px(value: Float): Int = (value * dp).toInt()

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(px(24f), px(32f), px(24f), px(24f))
        }

        val title = TextView(ctx).apply {
            text = "Quick-unlock out of sync"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.BLACK)
        }
        root.addView(title)

        val body = TextView(ctx).apply {
            text =
                "Your PIN or biometric unlock is out of sync with the vault " +
                "— this usually happens after restoring from cloud sync. " +
                "Open the KeyKeyKey app, unlock with your master password, " +
                "and re-enable PIN or biometric unlock from Settings. Your " +
                "saved passwords are safe."
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(0xFF333333.toInt())
            setPadding(0, px(12f), 0, px(24f))
        }
        root.addView(body)

        root.addView(actionButton(ctx, "OK") {
            activity.setResult(Activity.RESULT_CANCELED)
            activity.finish()
        })

        activity.setContentView(root)
    }

    // ── Shared widgets ────────────────────────────────────────────────

    private fun buildLoadingView(ctx: Context): View {
        val dp = ctx.resources.displayMetrics.density
        val layout = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.WHITE)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        val label = TextView(ctx).apply {
            text = "Loading credentials…"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(0xFF444444.toInt())
            gravity = Gravity.CENTER
            setPadding((dp * 24).toInt(), 0, (dp * 24).toInt(), 0)
        }
        layout.addView(label)
        return layout
    }

    private fun actionButton(
        ctx: Context,
        label: String,
        primary: Boolean = true,
        onClick: () -> Unit,
    ): Button {
        val dp = ctx.resources.displayMetrics.density
        val btn = Button(ctx).apply {
            text = label
            setAllCaps(false)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = (dp * 8).toInt() }
            setOnClickListener { onClick() }
        }
        if (!primary) {
            btn.setTextColor(0xFF555555.toInt())
            val bg = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                setColor(Color.TRANSPARENT)
                cornerRadius = 8f * dp
            }
            btn.background = bg
        }
        return btn
    }

    private class CredentialAdapter(context: Context) : ArrayAdapter<PickerItem>(
        context,
        android.R.layout.simple_list_item_2,
        android.R.id.text1,
    ) {
        fun replace(items: List<PickerItem>) {
            setNotifyOnChange(false)
            clear()
            addAll(items)
            notifyDataSetChanged()
        }

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = super.getView(position, convertView, parent)
            val item = getItem(position)
            val text1 = view.findViewById<TextView>(android.R.id.text1)
            val text2 = view.findViewById<TextView>(android.R.id.text2)
            if (item != null) {
                text1.text = if (item.isMatch) "★ ${item.name}" else item.name
                text2.text = item.subtitle()
            }
            return view
        }
    }
}
