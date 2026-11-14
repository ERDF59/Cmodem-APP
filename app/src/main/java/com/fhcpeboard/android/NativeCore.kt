package com.fhcpeboard.android

import androidx.annotation.Keep

@Keep
object NativeCore {
    private val loaded = runCatching {
        System.loadLibrary("fhcpecore")
        nativeSelfTest()
    }.getOrDefault(false)

    fun isAvailable(): Boolean = loaded

    fun version(): String = if (loaded) runCatching { nativeVersion() }.getOrDefault("") else ""

    fun decodeSmsPdu(pdu: String): String? {
        if (!loaded || pdu.length !in 8..8192) return null
        return runCatching { nativeDecodeSmsPdu(pdu) }.getOrNull()?.takeIf { it.isNotBlank() }
    }

    private external fun nativeVersion(): String
    private external fun nativeSelfTest(): Boolean
    private external fun nativeDecodeSmsPdu(pdu: String): String
}
