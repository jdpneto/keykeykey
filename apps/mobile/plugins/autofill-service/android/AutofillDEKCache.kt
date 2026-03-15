package com.keykeykey.app

/**
 * In-memory cache for the Data Encryption Key (DEK).
 *
 * Stores a clone of the DEK so the caller's copy can be independently zeroed.
 * On retrieval, returns a clone so the cache retains its own copy.
 * On clear, zeros the cached bytes before nulling the reference.
 */
object AutofillDEKCache {

    @Volatile
    private var cachedDEK: ByteArray? = null

    /**
     * Cache a DEK. Stores a defensive copy.
     *
     * @param dek The 32-byte DEK to cache
     */
    @Synchronized
    fun set(dek: ByteArray) {
        // Zero any previously cached DEK
        cachedDEK?.fill(0)
        cachedDEK = dek.clone()
    }

    /**
     * Retrieve the cached DEK. Returns a defensive copy.
     *
     * @return A clone of the cached DEK, or null if not cached
     */
    @Synchronized
    fun get(): ByteArray? {
        return cachedDEK?.clone()
    }

    /**
     * Clear the cached DEK, zeroing the memory before releasing.
     */
    @Synchronized
    fun clear() {
        cachedDEK?.fill(0)
        cachedDEK = null
    }
}
