package com.keykeykey.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val TAG = "SecureStoreReader"

/**
 * Reads values written by expo-secure-store on Android.
 *
 * expo-secure-store (Android) stores data in a plain SharedPreferences file
 * named "SecureStore" with keys prefixed by "key_v1-". Values are Base64-encoded
 * JSON objects containing AES/GCM encrypted data with keys managed by Android KeyStore.
 *
 * Value JSON format: { "ct": "<base64>", "iv": "<base64>", "tlen": 128, "scheme": "aes", "keystoreAlias": "<alias>" }
 */
object SecureStoreReader {

    private const val PREFS_NAME = "SecureStore"
    private const val KEY_PREFIX = "key_v1-"
    private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
    private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"

    /**
     * Read and decrypt a value from expo-secure-store.
     *
     * @param context Android context
     * @param key The logical key (without prefix), e.g. "vault_header"
     * @return The decrypted plaintext string, or null if not found
     */
    fun read(context: Context, key: String): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val prefKey = "$KEY_PREFIX$key"
        val raw = prefs.getString(prefKey, null) ?: return null

        return try {
            val decoded = String(Base64.decode(raw, Base64.DEFAULT), Charsets.UTF_8)
            val json = JSONObject(decoded)

            val ct = Base64.decode(json.getString("ct"), Base64.DEFAULT)
            val iv = Base64.decode(json.getString("iv"), Base64.DEFAULT)
            val tlen = json.getInt("tlen")
            val keystoreAlias = json.getString("keystoreAlias")

            val secretKey = loadKeyFromKeyStore(keystoreAlias)
                ?: throw SecurityException("KeyStore alias not found: $keystoreAlias")

            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(tlen, iv))
            val plaintext = cipher.doFinal(ct)

            String(plaintext, Charsets.UTF_8)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read SecureStore key '$key'", e)
            null
        }
    }

    /**
     * Check if a key exists in expo-secure-store.
     *
     * @param context Android context
     * @param key The logical key (without prefix)
     * @return true if the key exists
     */
    fun exists(context: Context, key: String): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.contains("$KEY_PREFIX$key")
    }

    /**
     * Write a value to expo-secure-store format.
     *
     * Creates or reuses a KeyStore key and encrypts the value with AES/GCM,
     * storing the result in the same format expo-secure-store expects.
     *
     * @param context Android context
     * @param key The logical key (without prefix)
     * @param value The plaintext string to store
     */
    fun write(context: Context, key: String, value: String) {
        val keystoreAlias = "expo_secure_store_$key"
        val secretKey = loadKeyFromKeyStore(keystoreAlias) ?: generateKey(keystoreAlias)

        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)

        val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val iv = cipher.iv

        val json = JSONObject().apply {
            put("ct", Base64.encodeToString(ct, Base64.NO_WRAP))
            put("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
            put("tlen", 128)
            put("scheme", "aes")
            put("keystoreAlias", keystoreAlias)
        }

        val encoded = Base64.encodeToString(
            json.toString().toByteArray(Charsets.UTF_8),
            Base64.NO_WRAP,
        )

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString("$KEY_PREFIX$key", encoded).apply()
    }

    /**
     * Delete a key from expo-secure-store.
     *
     * @param context Android context
     * @param key The logical key (without prefix)
     */
    fun delete(context: Context, key: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove("$KEY_PREFIX$key").apply()
    }

    private fun loadKeyFromKeyStore(alias: String): SecretKey? {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER)
        keyStore.load(null)
        val entry = keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry
        return entry?.secretKey
    }

    private fun generateKey(alias: String): SecretKey {
        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEYSTORE_PROVIDER,
        )
        val spec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }
}
