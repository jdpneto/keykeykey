# Android Autofill Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Android AutofillService with native vault access (lazysodium), credential fill/save flows, and biometric/PIN/master password authentication.

**Architecture:** The AutofillService runs in the same app process. It reads the SQLite database directly from Kotlin at `/data/data/<package>/files/SQLite/keykeykey.db`, reads SecureStore values from `SharedPreferences("SecureStore")` with custom AES/GCM decryption via Android KeyStore, and uses lazysodium for XChaCha20-Poly1305 and Argon2id. Authentication launches an Activity that returns the DEK via a `CompletableDeferred`. Credential save uses a Kotlin-side singleton.

**Tech Stack:** `lazysodium-android` (libsodium JNI), Android KeyStore, `BiometricPrompt` (AndroidX), Kotlin Coroutines, `SQLiteDatabase`, JUnit

**Spec:** `docs/superpowers/specs/2026-03-15-android-autofill-phase2-design.md`

**Important correction from spec:** expo-secure-store does NOT use AndroidX `EncryptedSharedPreferences`. It uses plain `SharedPreferences("SecureStore", MODE_PRIVATE)` with its own AES/GCM encryption. Values are stored as Base64-encoded JSON: `{ ct, iv, tlen, scheme, keystoreAlias, usesKeystoreSuffix, requiresAuthentication }`. Keys are prefixed with keychain service: `key_v1-<keyname>`. AES keys live in Android KeyStore under alias `AES/GCM/NoPadding:key_v1:keystoreUnauthenticated` (or `keystoreAuthenticated` for biometric-protected items).

---

## File Structure

### New Files (Kotlin — in `apps/mobile/plugins/autofill-service/android/`)

- `CryptoBridge.kt` — XChaCha20-Poly1305 decrypt, Argon2id derive, DEK unwrap via lazysodium
- `VaultHeaderParser.kt` — Binary vault header deserialization (LE integers)
- `SecureStoreReader.kt` — Read expo-secure-store values from SharedPreferences + Android KeyStore AES/GCM decryption
- `DatabaseReader.kt` — Read-only SQLite access to vault items
- `DomainMatcher.kt` — Last-two-segment domain comparison
- `AutofillSaveData.kt` — Kotlin-side credential handoff singleton
- `AutofillDEKCache.kt` — In-memory DEK cache with clear-on-lock
- `AuthActivity.kt` — Authentication Activity (biometric/PIN/master password)

### Modified Files

- `apps/mobile/plugins/autofill-service/android/AutofillServiceImpl.kt` — Fill TODO stubs with real implementation
- `apps/mobile/plugins/autofill-service/index.js` — Add lazysodium dependency to build.gradle, copy new Kotlin files
- `apps/mobile/app/item/add.tsx` — Check `AutofillSaveData` via native module on mount

### Test Files

- `packages/core/src/crypto/__tests__/test-vectors.json` — Already exists (reuse for Kotlin verification)

---

## Chunk 1: Kotlin Crypto & Storage Layer

### Task 1: Add lazysodium dependency via config plugin

**Files:**

- Modify: `apps/mobile/plugins/autofill-service/index.js`

- [ ] **Step 1: Update config plugin to add lazysodium to build.gradle**

Read `apps/mobile/plugins/autofill-service/index.js`. Add a `withAppBuildGradle` modifier (or use `withProjectBuildGradle`) to inject the lazysodium dependency. Add to the config plugin:

```javascript
const { withAppBuildGradle } = require('expo/config-plugins');

// Inside the withAutofillService function, add:
config = withAppBuildGradle(config, (mod) => {
  const buildGradle = mod.modResults.contents;
  // Add lazysodium dependency if not already present
  if (!buildGradle.includes('lazysodium-android')) {
    mod.modResults.contents = buildGradle.replace(
      /dependencies\s*\{/,
      `dependencies {\n    implementation 'com.goterl:lazysodium-android:5.1.0:@aar'\n    implementation 'net.java.dev.jna:jna:5.14.0@aar'`,
    );
  }
  return mod;
});
```

Note: lazysodium-android requires JNA (Java Native Access) as a transitive dependency.

- [ ] **Step 2: Update config plugin to copy all new Kotlin files**

The existing plugin copies `AutofillServiceImpl.kt`. Update the file copy logic to also copy all new Kotlin files from the `android/` directory:

```javascript
// Replace single file copy with directory copy
const androidSrcDir = path.join(__dirname, 'android');
const targetDir = path.join(projectRoot, 'android/app/src/main/java/com/keykeykey/app');

for (const file of fs.readdirSync(androidSrcDir)) {
  if (file.endsWith('.kt')) {
    fs.copyFileSync(path.join(androidSrcDir, file), path.join(targetDir, file));
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/plugins/autofill-service/index.js
git commit -m "feat(mobile): add lazysodium dependency and multi-file copy to Android autofill plugin"
```

---

### Task 2: Create CryptoBridge.kt

**Files:**

- Create: `apps/mobile/plugins/autofill-service/android/CryptoBridge.kt`

- [ ] **Step 1: Create the Kotlin crypto bridge**

Create `apps/mobile/plugins/autofill-service/android/CryptoBridge.kt`:

```kotlin
package com.keykeykey.app

import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import com.goterl.lazysodium.interfaces.AEAD
import com.goterl.lazysodium.interfaces.PwHash
import java.util.Arrays

data class Argon2Params(val t: Int, val m: Int, val p: Int, val dkLen: Int)

object CryptoConstants {
    const val KEY_SIZE = 32
    const val NONCE_SIZE = 24
    const val TAG_SIZE = 16
    const val SALT_SIZE = 16
    const val OVERHEAD = NONCE_SIZE + TAG_SIZE // 40
}

class CryptoException(message: String) : Exception(message)

/**
 * Kotlin crypto bridge matching TypeScript @noble/ciphers binary format.
 * Uses lazysodium (libsodium JNI). Decrypt/derive only — no encrypt.
 */
object CryptoBridge {
    private val sodium = LazySodiumAndroid(SodiumAndroid())

    /**
     * Decrypt XChaCha20-Poly1305 ciphertext in managed-nonce format.
     * Input: [24-byte nonce][ciphertext][16-byte tag]
     */
    fun decrypt(ciphertext: ByteArray, key: ByteArray): ByteArray {
        require(key.size == CryptoConstants.KEY_SIZE) {
            "Key must be ${CryptoConstants.KEY_SIZE} bytes, got ${key.size}"
        }
        require(ciphertext.size > CryptoConstants.OVERHEAD) {
            "Ciphertext too short: ${ciphertext.size} bytes"
        }

        val nonce = ciphertext.copyOfRange(0, CryptoConstants.NONCE_SIZE)
        val encryptedWithTag = ciphertext.copyOfRange(CryptoConstants.NONCE_SIZE, ciphertext.size)

        // libsodium expects [ciphertext][tag] with separate nonce
        val plaintext = ByteArray(encryptedWithTag.size - CryptoConstants.TAG_SIZE)
        val success = sodium.cryptoAeadXChaCha20Poly1305IetfDecrypt(
            plaintext,
            null, // plaintext length output (not needed)
            null, // nsec (not used)
            encryptedWithTag,
            encryptedWithTag.size.toLong(),
            null, // additional data
            0L,   // additional data length
            nonce,
            key,
        )

        if (!success) throw CryptoException("Decryption failed — wrong key or tampered data")
        return plaintext
    }

    /** Unwrap a DEK using a KEK. Returns 32-byte DEK. */
    fun unwrapDEK(wrappedDEK: ByteArray, kek: ByteArray): ByteArray {
        val dek = decrypt(wrappedDEK, kek)
        require(dek.size == CryptoConstants.KEY_SIZE) {
            "Unwrapped DEK is ${dek.size} bytes, expected ${CryptoConstants.KEY_SIZE}"
        }
        return dek
    }

    /**
     * Derive a KEK from password using Argon2id.
     * Only supports p=1 (libsodium limitation).
     */
    fun deriveKEK(password: String, salt: ByteArray, params: Argon2Params): ByteArray {
        require(params.p == 1) {
            "libsodium only supports p=1; got p=${params.p}"
        }
        require(salt.size == CryptoConstants.SALT_SIZE) {
            "Salt must be ${CryptoConstants.SALT_SIZE} bytes"
        }

        val passwordBytes = password.toByteArray(Charsets.UTF_8)
        val output = ByteArray(params.dkLen)

        try {
            val result = sodium.cryptoPwHash(
                output,
                output.size.toLong(),
                passwordBytes,
                passwordBytes.size.toLong(),
                salt,
                params.t.toLong(),           // opslimit
                params.m.toLong() * 1024,    // memlimit (KiB → bytes)
                PwHash.Alg.PWHASH_ALG_ARGON2ID13.value,
            )

            if (!result) throw CryptoException("Argon2id key derivation failed")
            return output
        } finally {
            // Zero password bytes after derivation
            Arrays.fill(passwordBytes, 0.toByte())
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/plugins/autofill-service/android/CryptoBridge.kt
git commit -m "feat(mobile): add Kotlin crypto bridge for XChaCha20-Poly1305 and Argon2id"
```

---

### Task 3: Create VaultHeaderParser.kt

**Files:**

- Create: `apps/mobile/plugins/autofill-service/android/VaultHeaderParser.kt`

- [ ] **Step 1: Create vault header parser**

```kotlin
package com.keykeykey.app

import java.nio.ByteBuffer
import java.nio.ByteOrder

data class VaultHeader(
    val version: Int,
    val masterSalt: ByteArray,
    val recoverySalt: ByteArray,
    val argon2Params: Argon2Params,
    val masterWrappedDEK: ByteArray,
    val recoveryWrappedDEK: ByteArray,
)

class VaultHeaderParseException(message: String) : Exception(message)

/**
 * Parse the binary vault header format.
 * Format: [1B version][16B masterSalt][16B recoverySalt]
 *         [4B t LE][4B m LE][4B p LE][4B dkLen LE]
 *         [2B len LE][masterWrappedDEK][2B len LE][recoveryWrappedDEK]
 */
object VaultHeaderParser {

    fun parse(base64String: String): VaultHeader {
        val data = android.util.Base64.decode(base64String, android.util.Base64.DEFAULT)
        return parse(data)
    }

    fun parse(data: ByteArray): VaultHeader {
        if (data.size < 53) {
            throw VaultHeaderParseException("Vault header too short: ${data.size} bytes")
        }

        val buf = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)

        val version = buf.get().toInt() and 0xFF
        if (version != 1) {
            throw VaultHeaderParseException("Unsupported vault version: $version")
        }

        val masterSalt = ByteArray(16); buf.get(masterSalt)
        val recoverySalt = ByteArray(16); buf.get(recoverySalt)

        val t = buf.int
        val m = buf.int
        val p = buf.int
        val dkLen = buf.int
        val argon2Params = Argon2Params(t, m, p, dkLen)

        if (buf.remaining() < 2) throw VaultHeaderParseException("Truncated at masterWrappedDEK length")
        val masterLen = buf.short.toInt() and 0xFFFF
        if (buf.remaining() < masterLen) throw VaultHeaderParseException("Truncated at masterWrappedDEK data")
        val masterWrappedDEK = ByteArray(masterLen); buf.get(masterWrappedDEK)

        if (buf.remaining() < 2) throw VaultHeaderParseException("Truncated at recoveryWrappedDEK length")
        val recoveryLen = buf.short.toInt() and 0xFFFF
        if (buf.remaining() < recoveryLen) throw VaultHeaderParseException("Truncated at recoveryWrappedDEK data")
        val recoveryWrappedDEK = ByteArray(recoveryLen); buf.get(recoveryWrappedDEK)

        return VaultHeader(version, masterSalt, recoverySalt, argon2Params, masterWrappedDEK, recoveryWrappedDEK)
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/plugins/autofill-service/android/VaultHeaderParser.kt
git commit -m "feat(mobile): add Kotlin vault header parser for Android autofill"
```

---

### Task 4: Create SecureStoreReader.kt

This is the most critical file — it must replicate expo-secure-store's encryption format.

**Files:**

- Create: `apps/mobile/plugins/autofill-service/android/SecureStoreReader.kt`

- [ ] **Step 1: Create the SecureStore reader**

expo-secure-store stores values in `SharedPreferences("SecureStore", MODE_PRIVATE)`. Each value is a Base64-encoded JSON: `{ ct, iv, tlen, scheme, keystoreAlias, usesKeystoreSuffix, requiresAuthentication }`. The AES key lives in Android KeyStore. The key name in SharedPreferences is prefixed: `key_v1-<keyname>`.

```kotlin
package com.keykeykey.app

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec

/**
 * Reads values from expo-secure-store's SharedPreferences on Android.
 *
 * expo-secure-store uses:
 * - SharedPreferences file: "SecureStore" (MODE_PRIVATE)
 * - Key prefix: "key_v1-<keyname>"
 * - Value format: Base64 JSON { ct, iv, tlen, scheme, keystoreAlias }
 * - Encryption: AES/GCM/NoPadding via Android KeyStore
 * - KeyStore alias: "AES/GCM/NoPadding:key_v1:keystoreUnauthenticated"
 *   (or "keystoreAuthenticated" for biometric-protected items)
 */
object SecureStoreReader {

    private const val SHARED_PREFS_NAME = "SecureStore"
    private const val KEY_PREFIX = "key_v1-"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val CIPHER_ALGORITHM = "AES/GCM/NoPadding"

    /**
     * Read a non-authenticated value from expo-secure-store.
     * Returns null if the key does not exist.
     */
    fun read(context: Context, key: String): String? {
        val prefs = context.getSharedPreferences(SHARED_PREFS_NAME, Context.MODE_PRIVATE)
        val prefKey = "$KEY_PREFIX$key"
        val rawValue = prefs.getString(prefKey, null) ?: return null

        return try {
            val json = JSONObject(String(Base64.decode(rawValue, Base64.DEFAULT)))
            val ct = Base64.decode(json.getString("ct"), Base64.DEFAULT)
            val iv = Base64.decode(json.getString("iv"), Base64.DEFAULT)
            val tlen = json.getInt("tlen")
            val keystoreAlias = json.getString("keystoreAlias")

            // Get the AES key from Android KeyStore
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
            keyStore.load(null)
            val secretKey = keyStore.getKey(keystoreAlias, null)
                ?: throw Exception("KeyStore key not found: $keystoreAlias")

            // Decrypt with AES/GCM
            val cipher = Cipher.getInstance(CIPHER_ALGORITHM)
            val spec = GCMParameterSpec(tlen, iv)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
            val plaintext = cipher.doFinal(ct)

            String(plaintext, Charsets.UTF_8)
        } catch (e: Exception) {
            null // Return null on any decryption failure
        }
    }

    /**
     * Check if a key exists in expo-secure-store (without decrypting).
     */
    fun exists(context: Context, key: String): Boolean {
        val prefs = context.getSharedPreferences(SHARED_PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.contains("$KEY_PREFIX$key")
    }

    /**
     * Write a value to expo-secure-store's SharedPreferences.
     * Used for PIN attempts counter (non-authenticated).
     */
    fun write(context: Context, key: String, value: String) {
        val prefs = context.getSharedPreferences(SHARED_PREFS_NAME, Context.MODE_PRIVATE)
        val prefKey = "$KEY_PREFIX$key"

        // Determine the KeyStore alias (unauthenticated)
        val keystoreAlias = "$CIPHER_ALGORITHM:key_v1:keystoreUnauthenticated"

        // Get or create the AES key
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)
        val secretKey = keyStore.getKey(keystoreAlias, null)
            ?: throw Exception("KeyStore key not found: $keystoreAlias")

        // Encrypt with AES/GCM
        val cipher = Cipher.getInstance(CIPHER_ALGORITHM)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val iv = cipher.iv
        val tlen = 128 // GCM tag length in bits

        // Build the JSON envelope
        val json = JSONObject().apply {
            put("ct", Base64.encodeToString(ct, Base64.NO_WRAP))
            put("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
            put("tlen", tlen)
            put("scheme", CIPHER_ALGORITHM)
            put("keystoreAlias", keystoreAlias)
        }

        val encoded = Base64.encodeToString(json.toString().toByteArray(), Base64.NO_WRAP)
        prefs.edit().putString(prefKey, encoded).apply()
    }

    /**
     * Delete a key from expo-secure-store's SharedPreferences.
     */
    fun delete(context: Context, key: String) {
        val prefs = context.getSharedPreferences(SHARED_PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove("$KEY_PREFIX$key").apply()
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/plugins/autofill-service/android/SecureStoreReader.kt
git commit -m "feat(mobile): add Kotlin SecureStore reader matching expo-secure-store format"
```

---

### Task 5: Create DatabaseReader.kt, DomainMatcher.kt, AutofillSaveData.kt, AutofillDEKCache.kt

**Files:**

- Create: `apps/mobile/plugins/autofill-service/android/DatabaseReader.kt`
- Create: `apps/mobile/plugins/autofill-service/android/DomainMatcher.kt`
- Create: `apps/mobile/plugins/autofill-service/android/AutofillSaveData.kt`
- Create: `apps/mobile/plugins/autofill-service/android/AutofillDEKCache.kt`

- [ ] **Step 1: Create DatabaseReader.kt**

```kotlin
package com.keykeykey.app

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File

data class EncryptedItem(
    val id: String,
    val type: String,
    val encryptedDataBase64: String,
)

/**
 * Read-only access to the vault SQLite database.
 * expo-sqlite stores databases at: <filesDir>/SQLite/<name>.db
 */
object DatabaseReader {

    fun readCredentials(context: Context): List<EncryptedItem> {
        val dbPath = File(context.filesDir, "SQLite/keykeykey.db")
        if (!dbPath.exists()) return emptyList()

        val db = SQLiteDatabase.openDatabase(
            dbPath.absolutePath,
            null,
            SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS,
        )

        return db.use { database ->
            val cursor = database.rawQuery(
                "SELECT id, type, encrypted_data FROM vault_items WHERE type = 'credential'",
                null,
            )
            cursor.use {
                val items = mutableListOf<EncryptedItem>()
                while (it.moveToNext()) {
                    items.add(
                        EncryptedItem(
                            id = it.getString(0),
                            type = it.getString(1),
                            encryptedDataBase64 = it.getString(2),
                        )
                    )
                }
                items
            }
        }
    }
}
```

- [ ] **Step 2: Create DomainMatcher.kt**

```kotlin
package com.keykeykey.app

import android.net.Uri

object DomainMatcher {

    fun extractRegistrableDomain(urlString: String): String? {
        val normalized = if ("://" in urlString) urlString else "https://$urlString"
        val host = Uri.parse(normalized).host?.lowercase() ?: return null
        val parts = host.split(".")
        return if (parts.size >= 2) parts.takeLast(2).joinToString(".") else host
    }

    fun matchesByAppIdentifier(credentialAppIds: List<String>, queryAppId: String): Boolean {
        val lower = queryAppId.lowercase()
        return credentialAppIds.any { it.lowercase() == lower }
    }

    fun matchesByDomain(credentialUrl: String?, queryDomain: String): Boolean {
        if (credentialUrl == null) return false
        val credDomain = extractRegistrableDomain(credentialUrl) ?: return false
        val queryRegDomain = extractRegistrableDomain(queryDomain) ?: return false
        return credDomain == queryRegDomain
    }
}
```

- [ ] **Step 3: Create AutofillSaveData.kt**

```kotlin
package com.keykeykey.app

/**
 * Kotlin-side singleton for passing credentials from onSaveRequest
 * to the add screen. Avoids dependency on React Native bridge.
 */
object AutofillSaveData {
    data class PendingCredential(
        val username: String,
        val password: String,
        val packageName: String,
        val domain: String?,
    )

    @Volatile
    private var pending: PendingCredential? = null

    fun setPending(credential: PendingCredential) { pending = credential }
    fun consume(): PendingCredential? { val r = pending; pending = null; return r }
    fun clear() { pending = null }
}
```

- [ ] **Step 4: Create AutofillDEKCache.kt**

```kotlin
package com.keykeykey.app

import java.util.Arrays

/**
 * In-memory DEK cache for the autofill service.
 * Avoids re-authentication for every fill request within a session.
 */
object AutofillDEKCache {
    @Volatile
    private var cachedDEK: ByteArray? = null

    fun get(): ByteArray? = cachedDEK?.clone()

    fun set(dek: ByteArray) { cachedDEK = dek.clone() }

    fun clear() {
        cachedDEK?.let { Arrays.fill(it, 0.toByte()) }
        cachedDEK = null
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/plugins/autofill-service/android/DatabaseReader.kt apps/mobile/plugins/autofill-service/android/DomainMatcher.kt apps/mobile/plugins/autofill-service/android/AutofillSaveData.kt apps/mobile/plugins/autofill-service/android/AutofillDEKCache.kt
git commit -m "feat(mobile): add database reader, domain matcher, save data, and DEK cache for Android autofill"
```

---

## Chunk 2: Authentication & AutofillService Implementation

### Task 6: Create AuthActivity.kt

**Files:**

- Create: `apps/mobile/plugins/autofill-service/android/AuthActivity.kt`

- [ ] **Step 1: Create the authentication Activity**

This Activity handles biometric, PIN, and master password unlock. It communicates the DEK back to the AutofillService via `AutofillDEKCache`.

```kotlin
package com.keykeykey.app

import android.app.Activity
import android.os.Bundle
import android.util.Base64
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.Arrays

/**
 * Authentication Activity for the autofill service.
 * Supports biometric, PIN, and master password unlock.
 * Sets AutofillDEKCache on success and finishes with RESULT_OK.
 */
class AuthActivity : FragmentActivity() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Determine available auth method
        val hasBiometric = SecureStoreReader.exists(this, "biometric_dek")
        val hasPin = SecureStoreReader.exists(this, "pin_data")

        when {
            hasBiometric -> showBiometricPrompt()
            hasPin -> showPinUI()
            else -> showPasswordUI()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    // MARK: - Biometric

    private fun showBiometricPrompt() {
        val executor = ContextCompat.getMainExecutor(this)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                handleBiometricSuccess()
            }
            override fun onAuthenticationFailed() {
                // Single attempt failed — BiometricPrompt allows retry automatically
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                // User cancelled or too many attempts — fall back
                val hasPin = SecureStoreReader.exists(this@AuthActivity, "pin_data")
                if (hasPin) showPinUI() else showPasswordUI()
            }
        }

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("KeyKeyKey")
            .setSubtitle("Authenticate to autofill")
            .setNegativeButtonText("Use PIN or password")
            .build()

        BiometricPrompt(this, executor, callback).authenticate(promptInfo)
    }

    private fun handleBiometricSuccess() {
        val dekJson = SecureStoreReader.read(this, "biometric_dek") ?: run {
            failAndFinish("Biometric data not found")
            return
        }
        try {
            val json = JSONObject(dekJson)
            val dekBase64 = json.getString("dek")
            val savedAt = json.getString("savedAt")

            // Check 14-day expiry
            val savedTime = java.time.Instant.parse(savedAt).toEpochMilli()
            val now = System.currentTimeMillis()
            if (now - savedTime > 14L * 24 * 60 * 60 * 1000) {
                failAndFinish("Biometric unlock expired. Please unlock in the main app.")
                return
            }

            val dek = Base64.decode(dekBase64, Base64.DEFAULT)
            AutofillDEKCache.set(dek)
            Arrays.fill(dek, 0.toByte())
            setResult(RESULT_OK)
            finish()
        } catch (e: Exception) {
            failAndFinish("Failed to read biometric data: ${e.message}")
        }
    }

    // MARK: - PIN

    private fun showPinUI() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(64, 128, 64, 64)
        }
        val title = TextView(this).apply { text = "Enter your PIN"; textSize = 20f }
        val pinInput = EditText(this).apply {
            hint = "PIN"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or
                android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val submitBtn = Button(this).apply { text = "Unlock" }
        val cancelBtn = Button(this).apply { text = "Cancel" }

        layout.addView(title)
        layout.addView(pinInput)
        layout.addView(submitBtn)
        layout.addView(cancelBtn)
        setContentView(layout)

        cancelBtn.setOnClickListener { failAndFinish("Cancelled") }
        submitBtn.setOnClickListener {
            val pin = pinInput.text.toString()
            if (pin.length < 4) {
                Toast.makeText(this, "PIN must be at least 4 digits", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            handlePinSubmit(pin)
        }
    }

    private fun handlePinSubmit(pin: String) {
        scope.launch(Dispatchers.IO) {
            try {
                val pinDataJson = SecureStoreReader.read(this@AuthActivity, "pin_data")
                    ?: throw Exception("PIN data not found")
                val attemptsStr = SecureStoreReader.read(this@AuthActivity, "pin_attempts")
                val remaining = attemptsStr?.toIntOrNull() ?: 5

                if (remaining <= 0) {
                    SecureStoreReader.delete(this@AuthActivity, "pin_data")
                    SecureStoreReader.delete(this@AuthActivity, "pin_attempts")
                    withContext(Dispatchers.Main) {
                        failAndFinish("Too many failed attempts. PIN disabled.")
                    }
                    return@launch
                }

                val json = JSONObject(pinDataJson)
                val wrappedDEK = Base64.decode(json.getString("wrappedDEK"), Base64.DEFAULT)
                val salt = Base64.decode(json.getString("salt"), Base64.DEFAULT)

                val params = Argon2Params(t = 2, m = 19_456, p = 1, dkLen = 32)
                val kek = CryptoBridge.deriveKEK(pin, salt, params)

                try {
                    val dek = CryptoBridge.unwrapDEK(wrappedDEK, kek)
                    // Success — reset attempts
                    SecureStoreReader.write(this@AuthActivity, "pin_attempts", "5")
                    AutofillDEKCache.set(dek)
                    Arrays.fill(dek, 0.toByte())
                    Arrays.fill(kek, 0.toByte())
                    withContext(Dispatchers.Main) {
                        setResult(RESULT_OK)
                        finish()
                    }
                } catch (_: CryptoException) {
                    // Wrong PIN
                    val newRemaining = remaining - 1
                    SecureStoreReader.write(this@AuthActivity, "pin_attempts", newRemaining.toString())
                    Arrays.fill(kek, 0.toByte())

                    if (newRemaining <= 0) {
                        SecureStoreReader.delete(this@AuthActivity, "pin_data")
                        SecureStoreReader.delete(this@AuthActivity, "pin_attempts")
                    }

                    withContext(Dispatchers.Main) {
                        val msg = if (newRemaining <= 0) "PIN disabled. Too many attempts."
                            else "Wrong PIN. $newRemaining attempt${if (newRemaining == 1) "" else "s"} remaining."
                        Toast.makeText(this@AuthActivity, msg, Toast.LENGTH_LONG).show()
                        if (newRemaining > 0) showPinUI()
                        else showPasswordUI()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { failAndFinish("PIN error: ${e.message}") }
            }
        }
    }

    // MARK: - Master Password

    private fun showPasswordUI() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(64, 128, 64, 64)
        }
        val title = TextView(this).apply { text = "Enter master password"; textSize = 20f }
        val passwordInput = EditText(this).apply {
            hint = "Master password"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val progress = ProgressBar(this).apply { visibility = android.view.View.GONE }
        val statusText = TextView(this).apply { visibility = android.view.View.GONE }
        val submitBtn = Button(this).apply { text = "Unlock" }
        val cancelBtn = Button(this).apply { text = "Cancel" }

        layout.addView(title)
        layout.addView(passwordInput)
        layout.addView(progress)
        layout.addView(statusText)
        layout.addView(submitBtn)
        layout.addView(cancelBtn)
        setContentView(layout)

        cancelBtn.setOnClickListener { failAndFinish("Cancelled") }
        submitBtn.setOnClickListener {
            val password = passwordInput.text.toString()
            if (password.isEmpty()) return@setOnClickListener
            submitBtn.isEnabled = false
            progress.visibility = android.view.View.VISIBLE
            statusText.visibility = android.view.View.VISIBLE
            statusText.text = "Deriving encryption key..."
            handlePasswordSubmit(password)
        }
    }

    private fun handlePasswordSubmit(password: String) {
        scope.launch(Dispatchers.IO) {
            try {
                val headerBase64 = SecureStoreReader.read(this@AuthActivity, "vault_header")
                    ?: throw Exception("Vault header not found")
                val header = VaultHeaderParser.parse(headerBase64)

                val kek = CryptoBridge.deriveKEK(password, header.masterSalt, header.argon2Params)
                val dek = CryptoBridge.unwrapDEK(header.masterWrappedDEK, kek)

                AutofillDEKCache.set(dek)
                Arrays.fill(dek, 0.toByte())
                Arrays.fill(kek, 0.toByte())

                withContext(Dispatchers.Main) {
                    setResult(RESULT_OK)
                    finish()
                }
            } catch (e: CryptoException) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, "Incorrect password", Toast.LENGTH_SHORT).show()
                    showPasswordUI()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { failAndFinish("Error: ${e.message}") }
            }
        }
    }

    private fun failAndFinish(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
        setResult(RESULT_CANCELED)
        finish()
    }
}
```

Note: This Activity uses basic Android Views for simplicity. A production version could use Jetpack Compose or XML layouts for better styling.

- [ ] **Step 2: Register AuthActivity in AndroidManifest via config plugin**

Update `apps/mobile/plugins/autofill-service/index.js` to add the AuthActivity to the manifest:

```javascript
// Inside withAndroidManifest modifier, after the service registration:
if (!mainApplication.activity) mainApplication.activity = [];
const activityExists = mainApplication.activity.some(
  (a) => a.$?.['android:name'] === '.AuthActivity',
);
if (!activityExists) {
  mainApplication.activity.push({
    $: {
      'android:name': '.AuthActivity',
      'android:theme': '@android:style/Theme.DeviceDefault.Light.NoActionBar',
      'android:exported': 'false',
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/plugins/autofill-service/android/AuthActivity.kt apps/mobile/plugins/autofill-service/index.js
git commit -m "feat(mobile): add Android auth Activity for autofill (biometric/PIN/password)"
```

---

### Task 7: Implement onFillRequest and onSaveRequest

**Files:**

- Modify: `apps/mobile/plugins/autofill-service/android/AutofillServiceImpl.kt`

- [ ] **Step 1: Replace the onFillRequest TODO stub**

Read `AutofillServiceImpl.kt`, then replace the `onFillRequest` method body (after the existing parsing code) with:

```kotlin
override fun onFillRequest(
    request: FillRequest,
    cancellationSignal: CancellationSignal,
    callback: FillCallback,
) {
    val structure = request.fillContexts.lastOrNull()?.structure
    if (structure == null) { callback.onSuccess(null); return }

    val parsed = parseStructure(structure)
    if (parsed.usernameFields.isEmpty() && parsed.passwordFields.isEmpty()) {
        callback.onSuccess(null); return
    }

    // Check for cached DEK
    val cachedDEK = AutofillDEKCache.get()
    if (cachedDEK != null) {
        // Already authenticated — build response directly
        CoroutineScope(Dispatchers.IO).launch {
            val response = buildFillResponse(parsed, cachedDEK)
            Arrays.fill(cachedDEK, 0.toByte())
            callback.onSuccess(response)
        }
    } else {
        // Need authentication — launch AuthActivity
        val intent = android.content.Intent(this, AuthActivity::class.java)
        val sender = android.app.PendingIntent.getActivity(
            this, 0, intent,
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val response = android.service.autofill.FillResponse.Builder()
            .setAuthentication(
                (parsed.usernameFields + parsed.passwordFields).toTypedArray(),
                sender.intentSender,
                android.widget.RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
                    setTextViewText(android.R.id.text1, "Unlock KeyKeyKey")
                },
            )
            .build()
        callback.onSuccess(response)
    }
}
```

Add the `buildFillResponse` helper:

```kotlin
private fun buildFillResponse(parsed: ParsedStructure, dek: ByteArray): android.service.autofill.FillResponse? {
    val items = DatabaseReader.readCredentials(this)
    if (items.isEmpty()) return null

    val matchedCredentials = mutableListOf<Triple<String, String, String>>() // name, username, password

    for (item in items) {
        val encryptedData = try {
            android.util.Base64.decode(item.encryptedDataBase64, android.util.Base64.DEFAULT)
        } catch (_: Exception) { continue }

        val decrypted = try { CryptoBridge.decrypt(encryptedData, dek) } catch (_: Exception) { continue }

        val json = try { org.json.JSONObject(String(decrypted, Charsets.UTF_8)) } catch (_: Exception) {
            Arrays.fill(decrypted, 0.toByte()); continue
        }

        val name = json.optString("name", "")
        val username = json.optString("username", "")
        val password = json.optString("password", "")
        val url = json.optString("url", null as String?)
        val appIds = json.optJSONArray("appIdentifiers")?.let { arr ->
            (0 until arr.length()).map { arr.getString(it) }
        } ?: emptyList()

        var matched = false
        if (parsed.packageName != null) {
            matched = DomainMatcher.matchesByAppIdentifier(appIds, parsed.packageName!!)
        }
        if (!matched && parsed.webDomain != null) {
            matched = DomainMatcher.matchesByDomain(url, parsed.webDomain!!)
        }

        if (matched) {
            matchedCredentials.add(Triple(name, username, password))
        }

        Arrays.fill(decrypted, 0.toByte())
    }

    if (matchedCredentials.isEmpty()) return null

    val responseBuilder = android.service.autofill.FillResponse.Builder()

    for ((name, username, password) in matchedCredentials) {
        val presentation = android.widget.RemoteViews(packageName, android.R.layout.simple_list_item_1)
        presentation.setTextViewText(android.R.id.text1, "$name ($username)")

        val datasetBuilder = android.service.autofill.Dataset.Builder()

        for (fieldId in parsed.usernameFields) {
            datasetBuilder.setValue(fieldId, android.view.autofill.AutofillValue.forText(username), presentation)
        }
        for (fieldId in parsed.passwordFields) {
            datasetBuilder.setValue(fieldId, android.view.autofill.AutofillValue.forText(password), presentation)
        }

        responseBuilder.addDataset(datasetBuilder.build())
    }

    // Configure SaveInfo so onSaveRequest is triggered after form submission
    val allFieldIds = (parsed.usernameFields + parsed.passwordFields).toTypedArray()
    if (allFieldIds.isNotEmpty()) {
        responseBuilder.setSaveInfo(
            android.service.autofill.SaveInfo.Builder(
                android.service.autofill.SaveInfo.SAVE_DATA_TYPE_USERNAME or
                    android.service.autofill.SaveInfo.SAVE_DATA_TYPE_PASSWORD,
                allFieldIds,
            ).build()
        )
    }

    return responseBuilder.build()
}
```

- [ ] **Step 2: Replace the onSaveRequest TODO stub**

```kotlin
override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    val structure = request.fillContexts.lastOrNull()?.structure
    if (structure == null) { callback.onSuccess(); return }

    val parsed = parseStructure(structure)
    var username: String? = null
    var password: String? = null

    // Extract values from saved fields
    for (i in 0 until structure.windowNodeCount) {
        val rootNode = structure.getWindowNodeAt(i).rootViewNode ?: continue
        extractSavedValues(rootNode, parsed) { u, p ->
            if (u != null) username = u
            if (p != null) password = p
        }
    }

    if (username != null && password != null) {
        AutofillSaveData.setPending(
            AutofillSaveData.PendingCredential(
                username = username!!,
                password = password!!,
                packageName = parsed.packageName ?: "",
                domain = parsed.webDomain,
            )
        )

        // Launch main app to the add screen
        val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            putExtra("autofill_save", true)
        }
        if (intent != null) startActivity(intent)
    }

    callback.onSuccess()
}

private fun extractSavedValues(
    node: android.app.assist.AssistStructure.ViewNode,
    parsed: ParsedStructure,
    onFound: (username: String?, password: String?) -> Unit,
) {
    val autofillId = node.autofillId
    val value = node.autofillValue?.textValue?.toString()

    if (autofillId != null && value != null) {
        if (autofillId in parsed.usernameFields) onFound(value, null)
        if (autofillId in parsed.passwordFields) onFound(null, value)
    }

    for (i in 0 until node.childCount) {
        extractSavedValues(node.getChildAt(i), parsed, onFound)
    }
}
```

- [ ] **Step 3: Add required imports to AutofillServiceImpl.kt**

Add at the top of the file:

```kotlin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.Arrays
```

- [ ] **Step 4: Run mobile tests**

```bash
pnpm --filter @keykeykey/mobile test
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/plugins/autofill-service/android/AutofillServiceImpl.kt
git commit -m "feat(mobile): implement onFillRequest and onSaveRequest in Android AutofillService"
```

---

## Chunk 3: Integration & Testing

### Task 8: Wire AutofillSaveData to the add screen

The add screen needs to check the Kotlin-side `AutofillSaveData` singleton on mount, alongside the existing `AutofillHandoff.consume()`.

**Files:**

- Create: `apps/mobile/plugins/autofill-service/android/AutofillSaveDataModule.kt`
- Modify: `apps/mobile/app/item/add.tsx`
- Modify: `apps/mobile/plugins/autofill-service/index.js`

- [ ] **Step 1: Create a React Native native module**

Create `apps/mobile/plugins/autofill-service/android/AutofillSaveDataModule.kt`:

```kotlin
package com.keykeykey.app

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableNativeMap

class AutofillSaveDataModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AutofillSaveData"

    @ReactMethod
    fun consume(promise: Promise) {
        val pending = AutofillSaveData.consume()
        if (pending == null) {
            promise.resolve(null)
            return
        }
        val map = WritableNativeMap().apply {
            putString("username", pending.username)
            putString("password", pending.password)
            putString("packageName", pending.packageName)
            pending.domain?.let { putString("domain", it) }
        }
        promise.resolve(map)
    }
}
```

- [ ] **Step 2: Update add.tsx to check AutofillSaveData**

In `apps/mobile/app/item/add.tsx`, update the `useEffect` to also check the Kotlin singleton. Add at the beginning of the effect, before the existing `AutofillHandoff.consume()` check:

```typescript
// Check for Android autofill save data (Kotlin-side singleton)
if (Platform.OS === 'android') {
  try {
    const { NativeModules } = require('react-native');
    const result = await NativeModules.AutofillSaveData?.consume();
    if (result) {
      setType('credential');
      setUsername(result.username);
      setPassword(result.password);
      if (result.domain) {
        const d = result.domain;
        setUrl(d.startsWith('http') ? d : `https://${d}`);
        setName(extractDomainBrand(d));
      }
      if (result.packageName) {
        setAppIdentifiers([result.packageName]);
      }
      return;
    }
  } catch {
    // Module not available — continue with other checks
  }
}
```

Note: The useEffect needs to become async or use `.then()` since `consume()` returns a Promise.

- [ ] **Step 3: Register the native module in the config plugin**

The native module needs to be registered via a ReactPackage. Create `AutofillSaveDataPackage.kt` and update the config plugin to copy it and register it in `MainApplication.java`. However, for Expo apps using the new architecture, native modules are auto-linked. Verify if a manual ReactPackage is needed or if expo-modules handles this.

Simpler alternative: Use Expo Modules API instead of the raw React Native bridge. But since the autofill service files are copied by the config plugin (not an Expo module), the simplest approach is the ReactPackage.

Create `apps/mobile/plugins/autofill-service/android/AutofillSaveDataPackage.kt`:

```kotlin
package com.keykeykey.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AutofillSaveDataPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(AutofillSaveDataModule(reactContext))
    }
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
```

Add to the config plugin a step that registers this package in `MainApplication`. This requires modifying the `getPackages()` method.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/plugins/autofill-service/android/ apps/mobile/app/item/add.tsx apps/mobile/plugins/autofill-service/index.js
git commit -m "feat(mobile): wire AutofillSaveData to add screen via React Native native module"
```

---

### Task 9: Add Kotlin JVM tests for crypto compatibility

**Files:**

- The test vectors at `packages/core/src/crypto/__tests__/test-vectors.json` serve as the compatibility contract

Since Kotlin JVM tests require a Gradle test setup and lazysodium-java (not lazysodium-android), and the autofill service files are Kotlin source copied by a config plugin (not a standard Gradle module), the most practical approach for now is:

- [ ] **Step 1: Create an Android instrumented test**

Create `apps/mobile/plugins/autofill-service/android/CryptoBridgeTest.kt`:

```kotlin
package com.keykeykey.app

/**
 * Cross-platform crypto compatibility test.
 * Verifies Kotlin/lazysodium produces identical output to TypeScript/@noble/ciphers.
 *
 * Test vectors from: packages/core/src/crypto/__tests__/test-vectors.json
 * Run as Android instrumented test after expo prebuild.
 *
 * To run: ./gradlew connectedAndroidTest
 */
// TODO: Convert to proper instrumented test when Gradle module is set up.
// For now, verify manually by calling these functions from the app.

object CryptoBridgeTest {
    // Hex values from test-vectors.json (paste actual values from the committed file)

    fun runAllTests(): List<String> {
        val results = mutableListOf<String>()

        // Test 1: XChaCha20-Poly1305 decrypt
        // Test 2: DEK unwrap
        // Test 3: Argon2id PIN derivation
        // Test 4: Vault header parse
        // Test 5: Full credential decrypt

        // Each test: decrypt/derive, compare to expected, report pass/fail
        // Implementer should read test-vectors.json and paste the actual hex values

        return results
    }
}
```

Note: A proper Gradle test setup would require restructuring the Android source as a proper module. For Phase 2, manual verification via the test protocol is acceptable. The test vectors ensure compatibility contractually.

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/plugins/autofill-service/android/CryptoBridgeTest.kt
git commit -m "test(mobile): add Kotlin crypto compatibility test scaffold"
```

---

### Task 10: Run tests and verify

- [ ] **Step 1: Run all tests**

```bash
pnpm --filter @keykeykey/core test -- --run
pnpm --filter @keykeykey/mobile test
pnpm lint
pnpm format:check
```

- [ ] **Step 2: Fix any issues**

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore(mobile): fix lint and formatting for Android autofill Phase 2"
```
