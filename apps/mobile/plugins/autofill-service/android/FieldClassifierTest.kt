package com.keykeykey.app

import android.text.InputType
import com.keykeykey.app.FieldClassifier.Kind

/**
 * FieldClassifier test scaffold.
 *
 * Mirrors `TotpEngineTest.kt`'s shape: not auto-run; intended for manual
 * `connectedAndroidTest` execution or import into a JUnit test target.
 *
 * The Chrome vectors are the node metadata Chrome 15x reported for
 * github.com/login (captured with `log.tag.KeyKeyKeyAutofill VERBOSE`).
 */
object FieldClassifierTest {

    private data class Case(
        val name: String,
        val hints: Array<String>? = null,
        val inputType: Int = 0,
        val html: List<Pair<String, String>>? = null,
        val idEntry: String? = null,
        val expected: Kind?,
    )

    private val TEXT_PASSWORD = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
    private val TEXT_WEB_EMAIL = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS
    private val PHONE = InputType.TYPE_CLASS_PHONE

    private val CASES = listOf(
        // Chrome / github.com/login
        Case(
            "chrome username",
            hints = arrayOf("username"),
            html = listOf("name" to "login", "type" to "text", "id" to "login_field"),
            expected = Kind.USERNAME,
        ),
        Case(
            "chrome current-password (inputType 0, no idEntry)",
            hints = arrayOf("current-password"),
            html = listOf("name" to "password", "type" to "password", "id" to "password"),
            expected = Kind.PASSWORD,
        ),
        Case(
            "chrome invisible honeypot",
            html = listOf("name" to "required_field_1d36", "type" to "text", "visibility" to "invisible"),
            expected = null,
        ),
        // Raw autocomplete tokens
        Case("new-password", hints = arrayOf("new-password"), expected = Kind.PASSWORD),
        Case("email token", hints = arrayOf("email"), expected = Kind.USERNAME),
        Case("multi-token hint", hints = arrayOf("username webauthn"), expected = Kind.USERNAME),
        Case("one-time-code", hints = arrayOf("one-time-code"), expected = Kind.OTP),
        // Framework constants (View.AUTOFILL_HINT_*) from native apps
        Case("AUTOFILL_HINT_PASSWORD", hints = arrayOf("password"), expected = Kind.PASSWORD),
        Case("AUTOFILL_HINT_EMAIL_ADDRESS", hints = arrayOf("emailAddress"), expected = Kind.USERNAME),
        Case("otpCode", hints = arrayOf("otpCode"), expected = Kind.OTP),
        // Unknown hint falls through to the next signal
        Case("unknown hint + password inputType", hints = arrayOf("nickname"), inputType = TEXT_PASSWORD, expected = Kind.PASSWORD),
        // Fallbacks
        Case("inputType web email", inputType = TEXT_WEB_EMAIL, expected = Kind.USERNAME),
        Case("html type=password", html = listOf("type" to "password"), expected = Kind.PASSWORD),
        Case("hidden html type=password", html = listOf("type" to "password", "visibility" to "invisible"), expected = null),
        Case("idEntry heuristic", idEntry = "et_Password", expected = Kind.PASSWORD),
        // Never inferred
        Case("phone number is not OTP", inputType = PHONE, expected = null),
        Case("plain text field", inputType = InputType.TYPE_CLASS_TEXT, idEntry = "search", expected = null),
    )

    /** Run all assertions; throws if any case mismatches. */
    fun runAll() {
        for (c in CASES) {
            val actual = FieldClassifier.classify(c.hints, c.inputType, c.html, c.idEntry)
            require(actual == c.expected) { "${c.name}: expected ${c.expected}, got $actual" }
        }
    }
}
