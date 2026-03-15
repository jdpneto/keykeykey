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
