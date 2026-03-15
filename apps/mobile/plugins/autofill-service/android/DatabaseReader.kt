package com.keykeykey.app

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log

private const val TAG = "DatabaseReader"

/**
 * An encrypted vault item read from SQLite.
 */
data class EncryptedItem(
    val id: String,
    val type: String,
    val encryptedDataBase64: String,
)

/**
 * Read-only access to the KeyKeyKey SQLite vault database.
 *
 * The database is stored at <filesDir>/SQLite/keykeykey.db by expo-sqlite.
 * Only credential-type items are returned for autofill purposes.
 */
object DatabaseReader {

    private const val DB_NAME = "keykeykey.db"
    private const val DB_SUBDIR = "SQLite"

    /**
     * Read all credential items from the vault database.
     *
     * @param context Android context
     * @return List of encrypted credential items, empty if DB not found or on error
     */
    fun readCredentials(context: Context): List<EncryptedItem> {
        val dbFile = context.filesDir.resolve(DB_SUBDIR).resolve(DB_NAME)
        if (!dbFile.exists()) {
            Log.d(TAG, "Database not found at ${dbFile.absolutePath}")
            return emptyList()
        }

        return try {
            val db = SQLiteDatabase.openDatabase(
                dbFile.absolutePath,
                null,
                SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS,
            )
            db.use { database ->
                val cursor = database.rawQuery(
                    "SELECT id, type, encrypted_data FROM vault_items WHERE type = 'credential'",
                    null,
                )
                cursor.use { c ->
                    val items = mutableListOf<EncryptedItem>()
                    while (c.moveToNext()) {
                        items.add(
                            EncryptedItem(
                                id = c.getString(0),
                                type = c.getString(1),
                                encryptedDataBase64 = c.getString(2),
                            )
                        )
                    }
                    items
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read credentials from database", e)
            emptyList()
        }
    }
}
