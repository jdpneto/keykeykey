package com.keykeykey.app

import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.util.Base64
import android.util.Log
import android.view.Gravity
import android.view.View
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

    private val scope = CoroutineScope(Dispatchers.Main + Job())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (SecureStoreReader.exists(this, "biometric_dek")) {
            showBiometricPrompt()
        } else if (SecureStoreReader.exists(this, "pin_data")) {
            showPinUI()
        } else {
            showMasterPasswordUI()
        }
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
            if (SecureStoreReader.exists(this, "pin_data")) showPinUI() else showMasterPasswordUI()
            return
        }

        val executor = ContextCompat.getMainExecutor(this)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                handleBiometricSuccess(result.cryptoObject?.cipher)
            }
            override fun onAuthenticationFailed() { /* retry allowed by system */ }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                if (SecureStoreReader.exists(this@AuthActivity, "pin_data")) {
                    showPinUI()
                } else {
                    showMasterPasswordUI()
                }
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
     * Prepare a Cipher for biometric-bound decryption of the biometric_dek value.
     * Reads the KeyStore alias from the stored expo-secure-store JSON envelope
     * and initializes the Cipher in DECRYPT_MODE.
     */
    private fun prepareBiometricCipher(): javax.crypto.Cipher {
        // Read the raw SharedPreferences value (not decrypted) to get the KeyStore alias and IV
        val prefs = getSharedPreferences("SecureStore", MODE_PRIVATE)
        val prefKey = "key_v1-biometric_dek"
        val rawValue = prefs.getString(prefKey, null)
            ?: throw Exception("biometric_dek not found in SecureStore")

        val envelope = org.json.JSONObject(
            String(android.util.Base64.decode(rawValue, android.util.Base64.DEFAULT))
        )
        val iv = android.util.Base64.decode(envelope.getString("iv"), android.util.Base64.DEFAULT)
        val keystoreAlias = envelope.getString("keystoreAlias")

        val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        val secretKey = keyStore.getKey(keystoreAlias, null)
            ?: throw Exception("KeyStore key not found: $keystoreAlias")

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
                    org.json.JSONObject(
                        String(android.util.Base64.decode(rawValue, android.util.Base64.DEFAULT))
                    )
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
                    AutofillDEKCache.set(dek)
                    setResult(RESULT_OK)
                    finish()
                } finally {
                    Arrays.fill(dek, 0.toByte())
                }
            } catch (e: Exception) {
                Log.e(TAG, "Biometric DEK processing failed", e)
                finishCancelled()
            }
        }
    }

    // ── PIN flow ────────────────────────────────────────────────────────

    private fun showPinUI() {
        // Enforce PIN lockout
        val attemptsStr = SecureStoreReader.read(this, "pin_attempts")
        val remaining = (MAX_PIN_ATTEMPTS - (attemptsStr?.toIntOrNull() ?: 0))
        if (remaining <= 0) {
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
        setContentView(layout)

        unlockBtn.setOnClickListener {
            val pin = pinInput.text.toString()
            if (pin.isEmpty()) {
                errorText.text = "Please enter your PIN"
                errorText.visibility = View.VISIBLE
                return@setOnClickListener
            }

            // Check attempt count
            val attemptsStr = SecureStoreReader.read(this, "pin_attempts")
            val attempts = attemptsStr?.toIntOrNull() ?: 0
            if (attempts >= MAX_PIN_ATTEMPTS) {
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

                    // Success — reset attempts
                    SecureStoreReader.write(this@AuthActivity, "pin_attempts", "0")
                    AutofillDEKCache.set(dek!!)
                    setResult(RESULT_OK)
                    finish()
                } catch (e: SecurityException) {
                    // Wrong PIN
                    val newAttempts = attempts + 1
                    SecureStoreReader.write(this@AuthActivity, "pin_attempts", newAttempts.toString())
                    val remaining = MAX_PIN_ATTEMPTS - newAttempts
                    showError(errorText, progress, unlockBtn, "Wrong PIN ($remaining attempts left)")
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

                    AutofillDEKCache.set(dek!!)
                    setResult(RESULT_OK)
                    finish()
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
