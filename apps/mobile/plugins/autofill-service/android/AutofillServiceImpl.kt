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

        if (parsed.usernameFields.isEmpty() && parsed.passwordFields.isEmpty()) {
            Log.d(TAG, "No autofillable fields found")
            callback.onSuccess(null)
            return
        }

        Log.d(
            TAG,
            "Found ${parsed.usernameFields.size} username and ${parsed.passwordFields.size} password fields" +
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
            // No cached DEK — return authentication response
            val authIntent = Intent(this, AuthActivity::class.java)
            val pendingIntent = PendingIntent.getActivity(
                this,
                0,
                authIntent,
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )

            val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
                setTextViewText(android.R.id.text1, "Unlock KeyKeyKey")
            }

            // Collect all autofill IDs for the authentication dataset
            val allIds = (parsed.usernameFields + parsed.passwordFields).toTypedArray()

            try {
                val response = FillResponse.Builder()
                    .setAuthentication(allIds, pendingIntent.intentSender, presentation)
                    .build()
                callback.onSuccess(response)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to build auth fill response", e)
                callback.onSuccess(null)
            }
        }
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        Log.d(TAG, "onSaveRequest received")

        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) {
            callback.onSuccess()
            return
        }

        val parsed = parseStructure(structure)

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

        if (items.isEmpty()) return null

        val matches = mutableListOf<DecryptedCredential>()

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

                // Match by app identifier or domain
                val matchesApp = parsed.packageName != null &&
                    DomainMatcher.matchesByAppIdentifier(appIdentifiers, parsed.packageName!!)
                val urlList = if (url != null) listOf(url) else emptyList()
                val matchesDomain = parsed.webDomain != null &&
                    DomainMatcher.matchesByDomain(urlList, parsed.webDomain!!)

                if (matchesApp || matchesDomain) {
                    matches.add(
                        DecryptedCredential(
                            name = json.optString("name", ""),
                            username = json.optString("username", ""),
                            password = json.optString("password", ""),
                            url = url,
                            appIdentifiers = appIdentifiers,
                        ),
                    )
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to decrypt/match item ${item.id}", e)
            } finally {
                decryptedBytes?.let { Arrays.fill(it, 0.toByte()) }
            }
        }

        if (matches.isEmpty()) return null

        val responseBuilder = FillResponse.Builder()

        for (credential in matches) {
            val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
                val displayText = if (credential.username.isNotEmpty()) {
                    "${credential.name} (${credential.username})"
                } else {
                    credential.name
                }
                setTextViewText(android.R.id.text1, displayText)
            }

            val datasetBuilder = Dataset.Builder(presentation)

            for (usernameId in parsed.usernameFields) {
                datasetBuilder.setValue(usernameId, AutofillValue.forText(credential.username))
            }
            for (passwordId in parsed.passwordFields) {
                datasetBuilder.setValue(passwordId, AutofillValue.forText(credential.password))
            }

            responseBuilder.addDataset(datasetBuilder.build())
        }

        // Add SaveInfo so the system offers to save new/updated credentials
        val saveIds = mutableListOf<AutofillId>()
        saveIds.addAll(parsed.usernameFields)
        saveIds.addAll(parsed.passwordFields)

        if (saveIds.isNotEmpty()) {
            val saveInfoBuilder = SaveInfo.Builder(
                SaveInfo.SAVE_DATA_TYPE_USERNAME or SaveInfo.SAVE_DATA_TYPE_PASSWORD,
                saveIds.toTypedArray(),
            )
            responseBuilder.setSaveInfo(saveInfoBuilder.build())
        }

        return responseBuilder.build()
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

        val autofillId = node.autofillId
        val hints = node.autofillHints

        if (autofillId != null) {
            var classified = false
            if (hints != null) {
                // Classify by autofill hints (preferred)
                for (hint in hints) {
                    when (hint) {
                        View.AUTOFILL_HINT_USERNAME,
                        View.AUTOFILL_HINT_EMAIL_ADDRESS,
                        -> { result.usernameFields.add(autofillId); classified = true }

                        View.AUTOFILL_HINT_PASSWORD -> { result.passwordFields.add(autofillId); classified = true }
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
