package com.keykeykey.app

/**
 * Data class representing a credential captured from an autofill save request.
 */
data class PendingCredential(
    val username: String,
    val password: String,
    val domain: String?,
    val packageName: String?,
)

/**
 * In-memory singleton bridge for passing captured credentials from the
 * autofill service to the main app's add-credential screen.
 *
 * Thread-safe via @Volatile and synchronized access.
 */
object AutofillSaveData {

    @Volatile
    private var pending: PendingCredential? = null

    /**
     * Store a pending credential from an autofill save request.
     *
     * @param credential The captured credential data
     */
    @Synchronized
    fun setPending(credential: PendingCredential) {
        pending = credential
    }

    /**
     * Consume the pending credential, returning it and clearing the slot.
     *
     * @return The pending credential, or null if none is set
     */
    @Synchronized
    fun consume(): PendingCredential? {
        val result = pending
        pending = null
        return result
    }

    /**
     * Clear any pending credential without consuming it.
     */
    @Synchronized
    fun clear() {
        pending = null
    }
}
