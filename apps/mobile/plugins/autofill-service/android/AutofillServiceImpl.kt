package com.keykeykey.app

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.text.InputType
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.Arrays

private const val TAG = "KeyKeyKeyAutofill"

/**
 * Parsed fields extracted from an AssistStructure.
 */
data class ParsedStructure(
    val usernameFields: MutableList<AutofillId> = mutableListOf(),
    val passwordFields: MutableList<AutofillId> = mutableListOf(),
    val otpFields: MutableList<AutofillId> = mutableListOf(),
    var webDomain: String? = null,
    var packageName: String? = null,
)

/**
 * A decrypted credential ready for autofill display.
 */
private data class DecryptedCredential(
    val name: String,
    val username: String,
    val password: String,
    val url: String?,
    val appIdentifiers: List<String>,
    /** Raw `otpauth://` URI when the credential carries a TOTP secret. */
    val totp: String?,
)

/**
 * Android AutofillService implementation for KeyKeyKey.
 *
 * This service is registered in the manifest via the Expo config plugin and handles
 * autofill requests from the system. It reads encrypted credentials from the vault
 * database, decrypts them using the cached DEK, and presents matching suggestions.
 */
class AutofillServiceImpl : AutofillService() {

    private val scope = CoroutineScope(Dispatchers.IO + Job())

    override fun onCreate() {
        super.onCreate()
        // Idempotent: also called from AuthActivity.onCreate(). Loads PSL from
        // assets on first invocation so DomainMatcher.matchesByDomain has
        // eTLD+1 parity with the iOS credential provider.
        DomainMatcher.initialize(applicationContext)
    }

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback,
    ) {
        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) {
            callback.onSuccess(null)
            return
        }

        val parsed = parseStructure(structure)

        // Never offer autofill inside KeyKeyKey itself. Our own unlock
        // screens (RN app and the autofill AuthActivity) contain password
        // fields, and suggesting "Unlock KeyKeyKey" to fill the master
        // password that unlocks those very suggestions is a nonsensical
        // loop — and tapping the chip from AuthActivity would recurse.
        if (parsed.packageName == packageName) {
            Log.d(TAG, "Fill request from our own package — ignoring")
            callback.onSuccess(null)
            return
        }

        if (parsed.usernameFields.isEmpty() && parsed.passwordFields.isEmpty() &&
            parsed.otpFields.isEmpty()
        ) {
            Log.d(TAG, "No autofillable fields found")
            callback.onSuccess(null)
            return
        }

        Log.d(
            TAG,
            "Found ${parsed.usernameFields.size} username, ${parsed.passwordFields.size} password," +
                " ${parsed.otpFields.size} OTP fields" +
                " for domain=${parsed.webDomain} package=${parsed.packageName}",
        )

        val cachedDEK = AutofillDEKCache.get()

        if (cachedDEK != null) {
            // DEK is cached — build response directly
            val job = scope.launch {
                try {
                    val response = buildFillResponse(parsed, cachedDEK)
                    callback.onSuccess(response)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to build fill response", e)
                    callback.onSuccess(null)
                } finally {
                    Arrays.fill(cachedDEK, 0.toByte())
                }
            }

            cancellationSignal.setOnCancelListener {
                job.cancel()
            }
        } else {
            // No cached DEK — return an "Unlock KeyKeyKey" Dataset with
            // Dataset-level authentication. Dataset-level auth lets
            // AuthActivity return a single replacement Dataset that Android
            // applies directly (no extra chip-tap). FillResponse-level auth
            // would need a FillResponse back — which shows a second chip
            // before filling.
            try {
                val response = FillResponse.Builder()
                    .addDataset(buildUnlockDataset(parsed))
                    .build()
                callback.onSuccess(response)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to build auth fill response", e)
                callback.onSuccess(null)
            }
        }
    }

    /**
     * Build the placeholder Dataset that shows the "Unlock KeyKeyKey" chip.
     * Tapping it fires the AuthActivity intent, which returns a replacement
     * Dataset via [AutofillManager.EXTRA_AUTHENTICATION_RESULT].
     */
    private fun buildUnlockDataset(parsed: ParsedStructure): Dataset {
        val pendingIntent = PendingIntent.getActivity(
            this,
            /* requestCode = */ 0,
            buildAuthActivityIntent(parsed),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
            setTextViewText(android.R.id.text1, "Unlock KeyKeyKey")
        }
        // Dataset.Builder requires at least one setValue — give every field
        // an empty placeholder. These values are discarded when the
        // authentication intent returns a replacement Dataset.
        val builder = Dataset.Builder(presentation)
        val placeholder = AutofillValue.forText("")
        for (id in parsed.usernameFields + parsed.passwordFields + parsed.otpFields) {
            builder.setValue(id, placeholder)
        }
        builder.setAuthentication(pendingIntent.intentSender)
        return builder.build()
    }

    /**
     * Build the Intent that launches [AuthActivity] carrying the parsed form
     * context — the autofill IDs and web / package identifiers the picker
     * needs to build the resulting [Dataset].
     */
    private fun buildAuthActivityIntent(parsed: ParsedStructure): Intent =
        Intent(this, AuthActivity::class.java).apply {
            putParcelableArrayListExtra(
                AuthActivity.EXTRA_USERNAME_IDS,
                ArrayList(parsed.usernameFields),
            )
            putParcelableArrayListExtra(
                AuthActivity.EXTRA_PASSWORD_IDS,
                ArrayList(parsed.passwordFields),
            )
            putParcelableArrayListExtra(
                AuthActivity.EXTRA_OTP_IDS,
                ArrayList(parsed.otpFields),
            )
            parsed.webDomain?.let { putExtra(AuthActivity.EXTRA_WEB_DOMAIN, it) }
            parsed.packageName?.let { putExtra(AuthActivity.EXTRA_PACKAGE_NAME, it) }
        }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        Log.d(TAG, "onSaveRequest received")

        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) {
            callback.onSuccess()
            return
        }

        val parsed = parseStructure(structure)

        // Mirror onFillRequest: never offer to save KeyKeyKey's own fields
        // (the master password typed on our unlock screens is not a
        // credential to store in the vault it unlocks).
        if (parsed.packageName == packageName) {
            Log.d(TAG, "Save request from our own package — ignoring")
            callback.onSuccess()
            return
        }

        // Extract the actual values from the fields
        var username: String? = null
        var password: String? = null

        for (i in 0 until structure.windowNodeCount) {
            val windowNode = structure.getWindowNodeAt(i)
            val rootViewNode = windowNode.rootViewNode ?: continue
            extractSaveValues(rootViewNode, parsed, { username = it }, { password = it })
        }

        if (username == null && password == null) {
            Log.d(TAG, "No values to save")
            callback.onSuccess()
            return
        }

        AutofillSaveData.setPending(
            PendingCredential(
                username = username ?: "",
                password = password ?: "",
                domain = parsed.webDomain,
                packageName = parsed.packageName,
            ),
        )

        // Launch main app so the user can review and save the credential
        val launchIntent = packageManager.getLaunchIntentForPackage(getPackageName())
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(launchIntent)
        }

        callback.onSuccess()
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    // ── Fill response building ──────────────────────────────────────────

    private suspend fun buildFillResponse(parsed: ParsedStructure, dek: ByteArray): FillResponse? {
        val items = withContext(Dispatchers.IO) {
            DatabaseReader.readCredentials(this@AutofillServiceImpl)
        }

        // Decrypt every vault entry and keep only those matching the
        // requesting domain/app. Non-matches are deliberately NOT surfaced
        // here — the "Search all credentials…" fallback handles discovery
        // of other creds via the full-screen picker. Showing the whole
        // vault as native chips would defeat domain-scoped autofill and
        // leaked creds for unrelated sites into every form.
        val matches = mutableListOf<DecryptedCredential>()

        // Picker-made link decisions the main app hasn't persisted into the
        // credentials yet — overlay them so they match immediately.
        val pendingLinks = PendingLinkStore.all(this)

        for (item in items) {
            var decryptedBytes: ByteArray? = null
            try {
                val ciphertext = Base64.decode(item.encryptedDataBase64, Base64.DEFAULT)
                decryptedBytes = CryptoBridge.decrypt(ciphertext, dek)
                val json = JSONObject(String(decryptedBytes, Charsets.UTF_8))

                val url = json.optString("url", "").ifEmpty { null }

                val appIdentifiers = mutableListOf<String>()
                json.optJSONArray("appIdentifiers")?.let { arr ->
                    for (j in 0 until arr.length()) {
                        arr.optString(j)?.let { appIdentifiers.add(it) }
                    }
                }

                val matchesApp = parsed.packageName != null &&
                    DomainMatcher.matchesByAppIdentifier(appIdentifiers, parsed.packageName!!)
                val urlList = if (url != null) listOf(url) else emptyList()
                val matchesDomain = parsed.webDomain != null &&
                    DomainMatcher.matchesByDomain(urlList, parsed.webDomain!!)
                val matchesPending = PendingLinkStore.matches(
                    pendingLinks,
                    item.id,
                    parsed.packageName,
                    parsed.webDomain,
                )

                val cred = DecryptedCredential(
                    name = json.optString("name", ""),
                    username = json.optString("username", ""),
                    password = json.optString("password", ""),
                    url = url,
                    appIdentifiers = appIdentifiers,
                    totp = json.optString("totp", "").ifEmpty { null },
                )

                if (matchesApp || matchesDomain || matchesPending) {
                    matches.add(cred)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to decrypt/match item ${item.id}", e)
            } finally {
                decryptedBytes?.let { Arrays.fill(it, 0.toByte()) }
            }
        }

        val responseBuilder = FillResponse.Builder()

        // Matches only — "Search all credentials…" below handles the rest.
        for (credential in matches) {
            responseBuilder.addDataset(buildCredentialDataset(parsed, credential, badge = "★"))
        }

        // Always append a fallback "Open KeyKeyKey" dataset so the picker
        // never renders as empty. Selecting it launches the main app so the
        // user can create a new credential or search manually. This is the
        // only dataset when the vault is empty — avoids the "authenticate →
        // nothing visible → picker vanishes" dead-end the user reported.
        addOpenAppFallback(responseBuilder, parsed)

        // SaveInfo lets Android offer to save submitted form values as a new
        // credential. Omit OTP fields — TOTP codes are single-use and saving
        // them would surface bogus "credential changed" prompts.
        val saveIds = mutableListOf<AutofillId>()
        saveIds.addAll(parsed.usernameFields)
        saveIds.addAll(parsed.passwordFields)
        if (saveIds.isNotEmpty()) {
            responseBuilder.setSaveInfo(
                SaveInfo.Builder(
                    SaveInfo.SAVE_DATA_TYPE_USERNAME or SaveInfo.SAVE_DATA_TYPE_PASSWORD,
                    saveIds.toTypedArray(),
                ).build(),
            )
        }

        return responseBuilder.build()
    }

    private fun buildCredentialDataset(
        parsed: ParsedStructure,
        credential: DecryptedCredential,
        badge: String?,
    ): Dataset {
        val otpCode = if (parsed.otpFields.isNotEmpty() && credential.totp != null) {
            runCatching {
                val params = OtpAuthParser.parse(credential.totp)
                TotpEngine.generateTotpCode(params)
            }.onFailure { Log.w(TAG, "Failed to derive TOTP code", it) }.getOrNull()
        } else {
            null
        }

        val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
            val base = if (credential.username.isNotEmpty()) {
                "${credential.name} (${credential.username})"
            } else {
                credential.name
            }
            val prefixed = if (badge != null) "$badge $base" else base
            val displayText = if (otpCode != null) "$prefixed · 2FA $otpCode" else prefixed
            setTextViewText(android.R.id.text1, displayText)
        }

        val datasetBuilder = Dataset.Builder(presentation)
        for (usernameId in parsed.usernameFields) {
            datasetBuilder.setValue(usernameId, AutofillValue.forText(credential.username))
        }
        for (passwordId in parsed.passwordFields) {
            datasetBuilder.setValue(passwordId, AutofillValue.forText(credential.password))
        }
        if (otpCode != null) {
            for (otpId in parsed.otpFields) {
                datasetBuilder.setValue(otpId, AutofillValue.forText(otpCode))
            }
        }
        return datasetBuilder.build()
    }

    private fun addOpenAppFallback(responseBuilder: FillResponse.Builder, parsed: ParsedStructure) {
        // Launch the full-screen picker (via AuthActivity — it skips auth
        // when the DEK is cached). Gives the user a search bar and full
        // credential list instead of trapping them in the native chip picker
        // with only the matches for this exact domain/app.
        val pendingIntent = PendingIntent.getActivity(
            this,
            /* requestCode = */ 0,
            buildAuthActivityIntent(parsed),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
            setTextViewText(android.R.id.text1, "Search all credentials…")
        }

        // Dataset needs at least one setValue to be built; give each field a
        // placeholder that Android discards when the authentication intent
        // fires. Without this Dataset.Builder.build() throws because it
        // thinks the dataset wouldn't fill anything.
        val datasetBuilder = Dataset.Builder(presentation)
        val placeholder = AutofillValue.forText("")
        val ids = (parsed.usernameFields + parsed.passwordFields + parsed.otpFields)
        for (id in ids) {
            datasetBuilder.setValue(id, placeholder)
        }
        // setAuthentication launches the intent when this dataset is tapped;
        // the placeholder values are replaced by whatever the activity
        // returns (or nothing, in which case no fill happens and the user
        // just ends up in the app).
        datasetBuilder.setAuthentication(pendingIntent.intentSender)
        responseBuilder.addDataset(datasetBuilder.build())
    }

    // ── Save value extraction ───────────────────────────────────────────

    private fun extractSaveValues(
        node: AssistStructure.ViewNode,
        parsed: ParsedStructure,
        setUsername: (String) -> Unit,
        setPassword: (String) -> Unit,
    ) {
        val autofillId = node.autofillId
        val value = node.autofillValue?.textValue?.toString()

        if (autofillId != null && value != null) {
            if (parsed.usernameFields.contains(autofillId)) {
                setUsername(value)
            } else if (parsed.passwordFields.contains(autofillId)) {
                setPassword(value)
            }
        }

        for (i in 0 until node.childCount) {
            extractSaveValues(node.getChildAt(i), parsed, setUsername, setPassword)
        }
    }

    // ── Structure parsing ───────────────────────────────────────────────

    /**
     * Parses an [AssistStructure] to extract autofillable fields and metadata.
     */
    private fun parseStructure(structure: AssistStructure): ParsedStructure {
        val result = ParsedStructure()
        for (i in 0 until structure.windowNodeCount) {
            val windowNode = structure.getWindowNodeAt(i)
            val rootViewNode = windowNode.rootViewNode ?: continue
            traverseNode(rootViewNode, result)
        }
        return result
    }

    /**
     * Recursively traverses the view node tree to find username/password fields
     * and extract the web domain or package name.
     */
    private fun traverseNode(node: AssistStructure.ViewNode, result: ParsedStructure) {
        // Extract web domain if available
        node.webDomain?.let { domain ->
            if (domain.isNotEmpty() && result.webDomain == null) {
                result.webDomain = domain
            }
        }

        // Extract package name from idPackage
        node.idPackage?.let { pkg ->
            if (pkg.isNotEmpty() && result.packageName == null) {
                result.packageName = pkg
            }
        }

        // Respect the app's autofill opt-out. Apps mark fields (or whole
        // subtrees) IMPORTANT_FOR_AUTOFILL_NO when autofill is unwanted —
        // e.g. master-password fields in password managers (including our
        // own RN unlock screen, which sets autoComplete="off"). Our
        // inputType/idEntry fallbacks would otherwise classify them anyway.
        // ViewNode.getImportantForAutofill() exists since API 28.
        val importance = if (android.os.Build.VERSION.SDK_INT >= 28) node.importantForAutofill else null
        if (importance == View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS) {
            // Domain/package were already recorded above; skip the subtree
            // for field classification.
            return
        }
        val optedOut = importance == View.IMPORTANT_FOR_AUTOFILL_NO

        val autofillId = node.autofillId
        val hints = node.autofillHints

        if (autofillId != null && !optedOut) {
            var classified = false
            if (hints != null) {
                // Classify by autofill hints (preferred)
                for (hint in hints) {
                    when (hint) {
                        View.AUTOFILL_HINT_USERNAME,
                        View.AUTOFILL_HINT_EMAIL_ADDRESS,
                        -> { result.usernameFields.add(autofillId); classified = true }

                        View.AUTOFILL_HINT_PASSWORD -> { result.passwordFields.add(autofillId); classified = true }

                        // 2FA / one-time-code. Conservative — explicit hint
                        // only; we don't try to infer OTP fields from
                        // inputType/maxLength to avoid false positives on
                        // phone numbers and CVVs.
                        // Multiple string values exist in the wild: Chrome
                        // bridges `autocomplete="one-time-code"` to
                        // "smsOTPCode" / "oneTimeCode"; the framework
                        // constant added in API 33+ is "otpCode".
                        "otpCode", "oneTimeCode", "smsOTPCode", "otp", "2faCode",
                        -> { result.otpFields.add(autofillId); classified = true }
                    }
                }
            }
            if (!classified) {
                // Fallback: classify by input type
                classified = classifyByInputType(node.inputType, autofillId, result)
            }
            if (!classified) {
                // Heuristic: classify by view id when no hints or input type matched
                classifyByIdEntry(node.idEntry, autofillId, result)
            }
        }

        // Recurse into children
        for (i in 0 until node.childCount) {
            traverseNode(node.getChildAt(i), result)
        }
    }

    /**
     * Fallback classification using Android input type flags when no autofill hints are set.
     */
    private fun classifyByInputType(inputType: Int, autofillId: AutofillId, result: ParsedStructure): Boolean {
        val variation = inputType and InputType.TYPE_MASK_VARIATION

        when {
            inputType and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_TEXT -> {
                when (variation) {
                    InputType.TYPE_TEXT_VARIATION_PASSWORD,
                    InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
                    InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
                    -> { result.passwordFields.add(autofillId); return true }

                    InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
                    InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS,
                    -> { result.usernameFields.add(autofillId); return true }
                }
            }
        }
        return false
    }

    private fun classifyByIdEntry(idEntry: String?, autofillId: AutofillId, result: ParsedStructure) {
        val id = idEntry?.lowercase() ?: return
        when {
            id.contains("user") || id.contains("login") ||
            id.contains("email") || id.contains("account") ->
                result.usernameFields.add(autofillId)
            id.contains("pass") || id.contains("secret") ->
                result.passwordFields.add(autofillId)
        }
    }
}
