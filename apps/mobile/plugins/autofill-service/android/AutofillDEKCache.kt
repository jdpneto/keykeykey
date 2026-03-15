package com.keykeykey.app

import android.os.Handler
import android.os.Looper
import java.util.Arrays

/**
 * In-memory cache for the Data Encryption Key (DEK).
 *
 * Stores a clone of the DEK so the caller's copy can be independently zeroed.
 * On retrieval, returns a clone so the cache retains its own copy.
 * On clear, zeros the cached bytes before nulling the reference.
 *
 * Includes a TTL mechanism: the cache auto-clears after 5 minutes (matching
 * the main app's auto-lock timeout) to prevent credential access after vault lock.
 */
object AutofillDEKCache {

    private const val TTL_MS = 5L * 60 * 1000 // 5 minutes

    @Volatile
    private var cachedDEK: ByteArray? = null

    private val handler = Handler(Looper.getMainLooper())
    private val clearRunnable = Runnable { clear() }

    /**
     * Cache a DEK. Stores a defensive copy and schedules auto-clear after TTL.
     *
     * @param dek The 32-byte DEK to cache
     */
    @Synchronized
    fun set(dek: ByteArray) {
        // Zero any previously cached DEK
        cachedDEK?.let { Arrays.fill(it, 0.toByte()) }
        cachedDEK = dek.clone()
        // Reset TTL — auto-clear after 5 minutes
        handler.removeCallbacks(clearRunnable)
        handler.postDelayed(clearRunnable, TTL_MS)
    }

    /**
     * Retrieve the cached DEK. Returns a defensive copy.
     *
     * @return A clone of the cached DEK, or null if not cached
     */
    @Synchronized
    fun get(): ByteArray? = cachedDEK?.clone()

    /**
     * Clear the cached DEK, zeroing the memory before releasing.
     */
    @Synchronized
    fun clear() {
        handler.removeCallbacks(clearRunnable)
        cachedDEK?.let { Arrays.fill(it, 0.toByte()) }
        cachedDEK = null
    }
}
