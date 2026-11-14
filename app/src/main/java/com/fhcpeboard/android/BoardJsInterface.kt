package com.fhcpeboard.android

import android.util.Log
import android.webkit.JavascriptInterface
import android.os.Build
import java.security.MessageDigest

class BoardJsInterface(private val host: MainActivity) {
    @JavascriptInterface
    fun uiFlavor(): String {
        val vendor = "${Build.MANUFACTURER} ${Build.BRAND}".lowercase()
        return if (listOf("oppo", "oneplus", "realme").any(vendor::contains)) "coui" else "default"
    }

    // Upstream's Wi-Fi cache can contain the administrator's Wi-Fi password.
    // Route it through the Android Keystore instead of WebView localStorage.
    @JavascriptInterface
    fun wifiCacheGet(scope: String): String = NativeStore.kcGet(wifiCacheKey(scope))

    @JavascriptInterface
    fun wifiCacheSet(scope: String, value: String) {
        require(value.length <= 350_000) { "Wi-Fi cache too large" }
        NativeStore.kcSet(wifiCacheKey(scope), value)
    }

    private fun wifiCacheKey(scope: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(scope.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return "UPSTREAM_LOCAL_WIFI_CACHE_$digest"
    }

    @JavascriptInterface
    fun postMessage(json: String) {
        // Messages can contain the local administrator password; never log payloads.
        host.forwardPageMessage(json)
    }
}
