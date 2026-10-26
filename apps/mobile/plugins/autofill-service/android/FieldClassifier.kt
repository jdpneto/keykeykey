package com.keykeykey.app

import android.text.InputType

/**
 * Classifies one autofill field from the metadata an [android.app.assist.AssistStructure.ViewNode]
 * exposes. Pure (no framework objects) so [FieldClassifierTest] can exercise it with plain values.
 *
 * Signals are tried strongest-first: autofill hints, Android input type, the HTML `type`
 * attribute (web content), then a view-id heuristic.
 */
object FieldClassifier {

    enum class Kind { USERNAME, PASSWORD, OTP }

    // Hints arrive in two vocabularies: the framework constants (View.AUTOFILL_HINT_*) from native
    // apps, and raw HTML `autocomplete` tokens from browsers — Chrome forwards e.g.
    // `autocomplete="current-password"` verbatim, with inputType 0 and no idEntry, so an
    // unmapped token leaves the field unclassified. Compared lowercase.
    private val USERNAME_HINTS = setOf("username", "emailaddress", "email")
    private val PASSWORD_HINTS = setOf("password", "current-password", "new-password")

    // 2FA / one-time-code. Explicit hints only; OTP fields are never inferred from
    // inputType/maxLength to avoid false positives on phone numbers and CVVs. Chrome bridges
    // `autocomplete="one-time-code"` as "smsOTPCode" / "oneTimeCode" or the raw token; the
    // framework constant added in API 33 is "otpCode".
    private val OTP_HINTS = setOf("otpcode", "onetimecode", "smsotpcode", "otp", "2facode", "one-time-code")

    fun classify(
        hints: Array<String>?,
        inputType: Int,
        htmlAttributes: List<Pair<String, String>>?,
        idEntry: String?,
    ): Kind? =
        byHints(hints) ?: byInputType(inputType) ?: byHtmlType(htmlAttributes) ?: byIdEntry(idEntry)

    private fun byHints(hints: Array<String>?): Kind? {
        // A hint may carry several tokens ("username webauthn").
        val tokens = hints?.flatMap { it.lowercase().split(' ') } ?: return null
        return when {
            tokens.any { it in PASSWORD_HINTS } -> Kind.PASSWORD
            tokens.any { it in USERNAME_HINTS } -> Kind.USERNAME
            tokens.any { it in OTP_HINTS } -> Kind.OTP
            else -> null
        }
    }

    private fun byInputType(inputType: Int): Kind? {
        if (inputType and InputType.TYPE_MASK_CLASS != InputType.TYPE_CLASS_TEXT) return null
        return when (inputType and InputType.TYPE_MASK_VARIATION) {
            InputType.TYPE_TEXT_VARIATION_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
            -> Kind.PASSWORD

            InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
            InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS,
            -> Kind.USERNAME

            else -> null
        }
    }

    private fun byHtmlType(attributes: List<Pair<String, String>>?): Kind? {
        val attrs = attributes ?: return null
        // Chrome reports CSS visibility; hidden inputs are a classic honeypot.
        if (attrs.any { it.first == "visibility" && it.second == "invisible" }) return null
        return when (attrs.firstOrNull { it.first == "type" }?.second?.lowercase()) {
            "password" -> Kind.PASSWORD
            "email" -> Kind.USERNAME
            else -> null
        }
    }

    private fun byIdEntry(idEntry: String?): Kind? {
        val id = idEntry?.lowercase() ?: return null
        return when {
            id.contains("user") || id.contains("login") ||
                id.contains("email") || id.contains("account") -> Kind.USERNAME
            id.contains("pass") || id.contains("secret") -> Kind.PASSWORD
            else -> null
        }
    }
}
