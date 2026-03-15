package com.keykeykey.app

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.text.InputType
import android.util.Log
import android.view.View
import android.view.autofill.AutofillId

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
 * Android AutofillService implementation for KeyKeyKey.
 *
 * This service is registered in the manifest via the Expo config plugin and handles
 * autofill requests from the system. Currently returns null (no suggestions) — vault
 * integration will be added in a future task.
 */
class AutofillServiceImpl : AutofillService() {

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

        // TODO: Integrate with vault store to build FillResponse with matching credentials
        callback.onSuccess(null)
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        // TODO: Extract credentials from save request and pass to add-credential screen
        //       via in-memory singleton bridge
        Log.d(TAG, "onSaveRequest received (not yet implemented)")
        callback.onSuccess()
    }

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
