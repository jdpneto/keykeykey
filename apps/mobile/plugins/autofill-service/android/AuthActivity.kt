package com.keykeykey.app

import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.util.Base64
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.autofill.AutofillId
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.Arrays
import java.util.concurrent.TimeUnit

private const val TAG = "AuthActivity"

/** Maximum failed PIN attempts before lockout. */
private const val MAX_PIN_ATTEMPTS = 5

/** Biometric DEK expiry in days. */
private const val BIOMETRIC_DEK_EXPIRY_DAYS = 14L

/** PIN Argon2id presets matching @keykeykey/core. */
private val PIN_ARGON2_PARAMS = Argon2Params(t = 2, m = 19456, p = 1, dkLen = 32)

/**
 * Authentication Activity for the autofill service.
 *
 * Handles biometric, PIN, and master password unlock flows.
 * On successful authentication, caches the DEK in [AutofillDEKCache]
 * and finishes with RESULT_OK so the autofill service can proceed.
 */
class AuthActivity : FragmentActivity() {

    companion object {
        const val EXTRA_USERNAME_IDS = "com.keykeykey.app.autofill.USERNAME_IDS"
        const val EXTRA_PASSWORD_IDS = "com.keykeykey.app.autofill.PASSWORD_IDS"
        const val EXTRA_OTP_IDS = "com.keykeykey.app.autofill.OTP_IDS"
        const val EXTRA_WEB_DOMAIN = "com.keykeykey.app.autofill.WEB_DOMAIN"
        const val EXTRA_PACKAGE_NAME = "com.keykeykey.app.autofill.PACKAGE_NAME"
    }

    private val scope = CoroutineScope(Dispatchers.Main + Job())

    private lateinit var target: AutofillPicker.TargetContext

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Idempotent across both autofill entry points; same call is in
        // AutofillServiceImpl.onCreate(). Direct-to-picker paths below need
        // PSL loaded for DomainMatcher.matchesByDomain.
        DomainMatcher.initialize(applicationContext)

        target = readTargetContext(intent)

        // If the DEK is still cached (same 5-minute TTL window) we can skip
        // the unlock step entirely and jump straight to the picker. A clone
        // is returned so we take ownership and let AutofillPicker re-cache
        // after zeroing our local copy.
        val cached = AutofillDEKCache.get()
        if (cached != null) {
            Log.i(TAG, "onCreate: cached DEK present, routing to picker")
            AutofillPicker.render(this, scope, cached, target)
            return
        }

        val hasBio = SecureStoreReader.exists(this, "biometric_dek")
        val hasPin = SecureStoreReader.exists(this, "pin_data")
        Log.i(TAG, "onCreate: biometric_dek=$hasBio pin_data=$hasPin")
        if (hasBio) {
            showBiometricPrompt()
        } else if (hasPin) {
            showPinUI()
        } else {
            showMasterPasswordUI()
        }
    }

    @Suppress("DEPRECATION")
    private fun readTargetContext(intent: Intent?): AutofillPicker.TargetContext {
        if (intent == null) {
            return AutofillPicker.TargetContext(emptyList(), emptyList(), emptyList(), null, null)
        }
        val username: ArrayList<AutofillId>? =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableArrayListExtra(EXTRA_USERNAME_IDS, AutofillId::class.java)
            } else {
                intent.getParcelableArrayListExtra(EXTRA_USERNAME_IDS)
            }
        val password: ArrayList<AutofillId>? =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableArrayListExtra(EXTRA_PASSWORD_IDS, AutofillId::class.java)
            } else {
                intent.getParcelableArrayListExtra(EXTRA_PASSWORD_IDS)
            }
        val otp: ArrayList<AutofillId>? =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableArrayListExtra(EXTRA_OTP_IDS, AutofillId::class.java)
            } else {
                intent.getParcelableArrayListExtra(EXTRA_OTP_IDS)
            }
        return AutofillPicker.TargetContext(
            usernameIds = username?.toList() ?: emptyList(),
            passwordIds = password?.toList() ?: emptyList(),
            otpIds = otp?.toList() ?: emptyList(),
            webDomain = intent.getStringExtra(EXTRA_WEB_DOMAIN),
            packageName = intent.getStringExtra(EXTRA_PACKAGE_NAME),
        )
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    // ── Biometric flow ──────────────────────────────────────────────────

    private fun showBiometricPrompt() {
        // Prepare the Cipher bound to the biometric KeyStore key
        val cipher = try {
            prepareBiometricCipher()
        } catch (e: Exception) {
            Log.w(TAG, "Cannot prepare biometric cipher, falling back", e)
            fallbackFromBiometric()
            return
        }

        val executor = ContextCompat.getMainExecutor(this)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                Log.i(TAG, "biometric succeeded")
                handleBiometricSuccess(result.cryptoObject?.cipher)
            }
            override fun onAuthenticationFailed() { /* retry allowed by system */ }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                Log.i(TAG, "biometric error: code=$errorCode msg=$errString")
                fallbackFromBiometric()
            }
        }

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock KeyKeyKey")
            .setSubtitle("Authenticate to autofill credentials")
            .setNegativeButtonText("Use PIN / Password")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()

        val cryptoObject = BiometricPrompt.CryptoObject(cipher)
        BiometricPrompt(this, executor, callback).authenticate(promptInfo, cryptoObject)
    }

    /**
     * Routed from any biometric failure path. Prefers PIN over master
     * password when pin_data is present so the user's declared lightweight
     * unlock actually works. Guarded against the "checked at onCreate,
     * stale by now" race by re-checking the pref each call.
     */
    private fun fallbackFromBiometric() {
        val hasPin = SecureStoreReader.exists(this, "pin_data")
        Log.i(TAG, "fallbackFromBiometric: pin_data=$hasPin")
        if (hasPin) showPinUI() else showMasterPasswordUI()
    }

    /**
     * Prepare a Cipher for biometric-bound decryption of the biometric_dek value.
     * Reads the KeyStore alias from the stored expo-secure-store JSON envelope
     * and initializes the Cipher in DECRYPT_MODE.
     */
    private fun prepareBiometricCipher(): javax.crypto.Cipher {
        // Read the raw SharedPreferences value (not decrypted) to get the
        // KeyStore alias and IV. expo-secure-store stores the envelope JSON
        // string directly under the pref key — no outer base64 wrap. Same
        // landmine as SecureStoreReader: see feedback memory.
        val prefs = getSharedPreferences("SecureStore", MODE_PRIVATE)
        val prefKey = "key_v1-biometric_dek"
        val rawValue = prefs.getString(prefKey, null)
            ?: throw Exception("biometric_dek not found in SecureStore")

        val envelope = org.json.JSONObject(rawValue)
        val iv = android.util.Base64.decode(envelope.getString("iv"), android.util.Base64.DEFAULT)
        // `keystoreAlias` in the envelope is the keychainService ("key_v1"),
        // not the actual KeyStore alias — mirror SecureStoreReader's logic.
        val keychainService = envelope.getString("keystoreAlias")
        val requiresAuth = envelope.optBoolean("requireAuthentication", true)
        val suffix = if (requiresAuth) "keystoreAuthenticated" else "keystoreUnauthenticated"
        val actualAlias = "AES/GCM/NoPadding:$keychainService:$suffix"

        val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        val secretKey = keyStore.getKey(actualAlias, null)
            ?: throw Exception("KeyStore key not found: $actualAlias")

        val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        val spec = javax.crypto.spec.GCMParameterSpec(128, iv)
        cipher.init(javax.crypto.Cipher.DECRYPT_MODE, secretKey, spec)
        return cipher
    }

    private fun handleBiometricSuccess(authenticatedCipher: javax.crypto.Cipher?) {
        scope.launch {
            try {
                // Use the authenticated cipher to decrypt the biometric_dek value
                val prefs = getSharedPreferences("SecureStore", MODE_PRIVATE)
                val prefKey = "key_v1-biometric_dek"
                val rawValue = prefs.getString(prefKey, null)
                if (rawValue == null) {
                    finishCancelled()
                    return@launch
                }

                val envelope = withContext(Dispatchers.IO) {
                    // No outer base64 wrap — see feedback memory / prepareBiometricCipher.
                    org.json.JSONObject(rawValue)
                }
                val ct = android.util.Base64.decode(
                    envelope.getString("ct"), android.util.Base64.DEFAULT
                )

                val plaintext = if (authenticatedCipher != null) {
                    // Use the biometric-authenticated cipher
                    withContext(Dispatchers.IO) { authenticatedCipher.doFinal(ct) }
                } else {
                    // Fallback: use SecureStoreReader (less secure, no CryptoObject binding)
                    val dekJson = withContext(Dispatchers.IO) {
                        SecureStoreReader.read(this@AuthActivity, "biometric_dek")
                    } ?: run { finishCancelled(); return@launch }
                    dekJson.toByteArray(Charsets.UTF_8)
                }

                val dekJson = String(plaintext, Charsets.UTF_8)
                val json = JSONObject(dekJson)
                val dekBase64 = json.getString("dek")
                val savedAt = json.getString("savedAt")

                // Check 14-day expiry — parse ISO-8601 string
                val savedTime = java.time.Instant.parse(savedAt).toEpochMilli()
                val now = System.currentTimeMillis()
                val expiryMs = TimeUnit.DAYS.toMillis(BIOMETRIC_DEK_EXPIRY_DAYS)
                if (now - savedTime > expiryMs) {
                    Log.w(TAG, "Biometric DEK expired, falling back")
                    SecureStoreReader.delete(this@AuthActivity, "biometric_dek")
                    if (SecureStoreReader.exists(this@AuthActivity, "pin_data")) {
                        showPinUI()
                    } else {
                        showMasterPasswordUI()
                    }
                    return@launch
                }

                val dek = Base64.decode(dekBase64, Base64.NO_WRAP)
                try {
                    // AutofillPicker.render takes ownership: it clones into
                    // the DEK cache and zeroes the passed-in array.
                    AutofillPicker.render(this@AuthActivity, scope, dek, target)
                } catch (e: Exception) {
                    Arrays.fill(dek, 0.toByte())
                    throw e
                }
            } catch (e: Exception) {
                Log.e(TAG, "Biometric DEK processing failed", e)
                finishCancelled()
            }
        }
    }

    // ── PIN flow ────────────────────────────────────────────────────────

    private fun showPinUI() {
        // The stored `pin_attempts` value is REMAINING tries (TS semantics,
        // see apps/mobile/lib/vault-context.tsx — on failure it decrements,
        // on success it writes MAX). Missing entry → full quota available.
        val remaining = readPinAttemptsRemaining()
        if (remaining == null) {
            Log.w(TAG, "showPinUI: PIN attempts counter unreadable, falling to master password")
            showMasterPasswordUI()
            return
        }
        Log.i(TAG, "showPinUI: remaining=$remaining")
        if (remaining <= 0) {
            Log.w(TAG, "showPinUI: no attempts left, falling to master password")
            showMasterPasswordUI()
            return
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(64, 128, 64, 64)
        }

        val title = TextView(this).apply {
            text = "Enter PIN"
            textSize = 22f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        layout.addView(title)

        val pinInput = EditText(this).apply {
            hint = "PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = 48 }
        }
        layout.addView(pinInput)

        val errorText = TextView(this).apply {
            textSize = 14f
            setTextColor(0xFFCC0000.toInt())
            gravity = Gravity.CENTER
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = 16 }
        }
        layout.addView(errorText)

        val progress = ProgressBar(this).apply {
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply {
                topMargin = 24
                gravity = Gravity.CENTER
            }
        }
        layout.addView(progress)

        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = 32 }
        }

        val cancelBtn = Button(this).apply {
            text = "Cancel"
            setOnClickListener { finishCancelled() }
        }
        buttonRow.addView(cancelBtn)

        val unlockBtn = Button(this).apply {
            text = "Unlock"
        }
        buttonRow.addView(unlockBtn)

        layout.addView(buttonRow)

        // Give the user an explicit escape hatch to master password. With
        // only "Cancel" / "Unlock" the flow dead-ends if PIN is wrong or
        // forgotten — the only other way out is 5 failed attempts.
        val useMasterPasswordBtn = Button(this).apply {
            text = "Use Master Password"
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = 16; gravity = Gravity.CENTER }
            setOnClickListener { showMasterPasswordUI() }
        }
        layout.addView(useMasterPasswordBtn)

        setContentView(layout)

        unlockBtn.setOnClickListener {
            val pin = pinInput.text.toString()
            if (pin.isEmpty()) {
                errorText.text = "Please enter your PIN"
                errorText.visibility = View.VISIBLE
                return@setOnClickListener
            }

            // Read current remaining attempts (TS semantics: missing ==
            // full quota; main app writes MAX on success, decrements on
            // failure). Guard against re-entry after we've already hit 0.
            val currentRemaining = readPinAttemptsRemaining()
            if (currentRemaining == null) {
                errorText.text = "PIN attempts could not be verified. Use master password."
                errorText.visibility = View.VISIBLE
                showMasterPasswordUI()
                return@setOnClickListener
            }
            if (currentRemaining <= 0) {
                errorText.text = "Too many failed attempts. Use master password."
                errorText.visibility = View.VISIBLE
                showMasterPasswordUI()
                return@setOnClickListener
            }

            progress.visibility = View.VISIBLE
            unlockBtn.isEnabled = false
            errorText.visibility = View.GONE

            scope.launch {
                var kek: ByteArray? = null
                var dek: ByteArray? = null
                try {
                    val pinDataJson = withContext(Dispatchers.IO) {
                        SecureStoreReader.read(this@AuthActivity, "pin_data")
                    }
                    if (pinDataJson == null) {
                        showError(errorText, progress, unlockBtn, "PIN data not found")
                        return@launch
                    }

                    val pinData = JSONObject(pinDataJson)
                    val salt = Base64.decode(pinData.getString("salt"), Base64.NO_WRAP)
                    val wrappedDEK = Base64.decode(pinData.getString("wrappedDEK"), Base64.NO_WRAP)

                    kek = withContext(Dispatchers.IO) {
                        CryptoBridge.deriveKEK(pin, salt, PIN_ARGON2_PARAMS)
                    }

                    dek = withContext(Dispatchers.IO) {
                        CryptoBridge.unwrapDEK(wrappedDEK, kek!!)
                    }

                    // Success — restore full quota (matches TS behaviour in
                    // vault-context.tsx). Writing "0" would cause the next
                    // main-app unlock to decrement to -1 and delete the PIN.
                    SecureStoreReader.write(
                        this@AuthActivity,
                        "pin_attempts",
                        MAX_PIN_ATTEMPTS.toString(),
                    )
                    val unlocked = dek!!
                    dek = null
                    AutofillPicker.render(this@AuthActivity, scope, unlocked, target)
                } catch (e: SecurityException) {
                    // Wrong PIN — decrement remaining count.
                    val newRemaining = currentRemaining - 1
                    SecureStoreReader.write(
                        this@AuthActivity,
                        "pin_attempts",
                        newRemaining.toString(),
                    )
                    if (newRemaining <= 0) {
                        showError(errorText, progress, unlockBtn, "Too many failed attempts. Use master password.")
                    } else {
                        showError(errorText, progress, unlockBtn, "Wrong PIN ($newRemaining attempts left)")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "PIN unlock failed", e)
                    showError(errorText, progress, unlockBtn, "Unlock failed")
                } finally {
                    kek?.let { Arrays.fill(it, 0.toByte()) }
                    dek?.let { Arrays.fill(it, 0.toByte()) }
                }
            }
        }
    }

    // ── Master password flow ────────────────────────────────────────────

    private fun readPinAttemptsRemaining(): Int? {
        val attemptsStr = SecureStoreReader.read(this, "pin_attempts")
        if (attemptsStr == null) {
            if (SecureStoreReader.exists(this, "pin_attempts")) {
                Log.w(TAG, "PIN attempts counter exists but could not be read")
                return null
            }
            return MAX_PIN_ATTEMPTS
        }

        return attemptsStr.toIntOrNull().also {
            if (it == null) Log.w(TAG, "PIN attempts counter is not numeric")
        }
    }

    private fun showMasterPasswordUI() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(64, 128, 64, 64)
        }

        val title = TextView(this).apply {
            text = "Enter Master Password"
            textSize = 22f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        layout.addView(title)

        val passwordInput = EditText(this).apply {
            hint = "Master Password"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = 48 }
        }
        layout.addView(passwordInput)

        val errorText = TextView(this).apply {
            textSize = 14f
            setTextColor(0xFFCC0000.toInt())
            gravity = Gravity.CENTER
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = 16 }
        }
        layout.addView(errorText)

        val progress = ProgressBar(this).apply {
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply {
                topMargin = 24
                gravity = Gravity.CENTER
            }
        }
        layout.addView(progress)

        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = 32 }
        }

        val cancelBtn = Button(this).apply {
            text = "Cancel"
            setOnClickListener { finishCancelled() }
        }
        buttonRow.addView(cancelBtn)

        val unlockBtn = Button(this).apply {
            text = "Unlock"
        }
        buttonRow.addView(unlockBtn)

        layout.addView(buttonRow)

        if (SecureStoreReader.exists(this, "pin_data")) {
            val usePinBtn = Button(this).apply {
                text = "Use PIN"
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = 16; gravity = Gravity.CENTER }
                setOnClickListener { showPinUI() }
            }
            layout.addView(usePinBtn)
        }

        setContentView(layout)

        unlockBtn.setOnClickListener {
            val password = passwordInput.text.toString()
            if (password.isEmpty()) {
                errorText.text = "Please enter your master password"
                errorText.visibility = View.VISIBLE
                return@setOnClickListener
            }

            progress.visibility = View.VISIBLE
            unlockBtn.isEnabled = false
            errorText.visibility = View.GONE

            scope.launch {
                var kek: ByteArray? = null
                var dek: ByteArray? = null
                try {
                    val headerBase64 = withContext(Dispatchers.IO) {
                        SecureStoreReader.read(this@AuthActivity, "vault_header")
                    }
                    if (headerBase64 == null) {
                        showError(errorText, progress, unlockBtn, "Vault header not found")
                        return@launch
                    }

                    val headerBytes = Base64.decode(headerBase64, Base64.DEFAULT)
                    val header = VaultHeaderParser.parse(headerBytes)

                    kek = withContext(Dispatchers.IO) {
                        CryptoBridge.deriveKEK(password, header.masterSalt, header.argon2Params)
                    }

                    dek = withContext(Dispatchers.IO) {
                        CryptoBridge.unwrapDEK(header.masterWrappedDEK, kek!!)
                    }

                    val unlocked = dek!!
                    dek = null
                    AutofillPicker.render(this@AuthActivity, scope, unlocked, target)
                } catch (e: SecurityException) {
                    showError(errorText, progress, unlockBtn, "Wrong master password")
                } catch (e: Exception) {
                    Log.e(TAG, "Master password unlock failed", e)
                    showError(errorText, progress, unlockBtn, "Unlock failed")
                } finally {
                    kek?.let { Arrays.fill(it, 0.toByte()) }
                    dek?.let { Arrays.fill(it, 0.toByte()) }
                }
            }
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private fun showError(
        errorText: TextView,
        progress: ProgressBar,
        unlockBtn: Button,
        message: String,
    ) {
        errorText.text = message
        errorText.visibility = View.VISIBLE
        progress.visibility = View.GONE
        unlockBtn.isEnabled = true
    }

    private fun finishCancelled() {
        setResult(RESULT_CANCELED)
        finish()
    }
}
