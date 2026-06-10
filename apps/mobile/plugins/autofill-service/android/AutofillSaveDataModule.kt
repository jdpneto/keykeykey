package com.keykeykey.app

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableNativeArray
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

    @ReactMethod
    fun clearDEKCache() {
        AutofillDEKCache.clear()
    }

    /**
     * Read (without clearing) the link decisions made in the autofill
     * picker. The JS side applies them to the vault through the core store
     * and then calls [clearPendingLinks] — clear-after-apply so a crash
     * mid-apply doesn't drop links.
     */
    @ReactMethod
    fun consumePendingLinks(promise: Promise) {
        val links = PendingLinkStore.all(reactApplicationContext)
        val arr = WritableNativeArray()
        for (link in links) {
            arr.pushMap(
                WritableNativeMap().apply {
                    putString("itemId", link.itemId)
                    link.appIdentifier?.let { putString("appIdentifier", it) }
                    link.webDomain?.let { putString("webDomain", it) }
                },
            )
        }
        promise.resolve(arr)
    }

    @ReactMethod
    fun clearPendingLinks(promise: Promise) {
        PendingLinkStore.clear(reactApplicationContext)
        promise.resolve(null)
    }
}
