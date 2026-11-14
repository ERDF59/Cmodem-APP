package com.fhcpeboard.android

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@SuppressLint("StaticFieldLeak")
object NativeStore {
    private const val TAG = "FHCpeBoard"
    private const val PREF = "cpe_keychain"
    private lateinit var app: Context
    private lateinit var docs: File

    fun init(context: Context) {
        app = context.applicationContext
        docs = app.filesDir
        File(docs, "CPE_SC").mkdirs()
    }

    fun docsDir(): String = docs.absolutePath

    fun kcGet(key: String): String {
        val v = app.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(key, null)
        if (isEncryptedKey(key) && v != null) {
            if (key.startsWith("LAN_DEVICE_NAME_OVERRIDE_") && !v.startsWith("enc1:")) return v
            return try {
                val parts = v.split(':')
                if (parts.size != 3 || parts[0] != "enc1") return ""
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, profileKey(), GCMParameterSpec(128, Base64.decode(parts[1], Base64.NO_WRAP)))
                cipher.doFinal(Base64.decode(parts[2], Base64.NO_WRAP)).toString(Charsets.UTF_8)
            } catch (_: Exception) { "" }
        }
        return v ?: ""
    }

    fun kcSet(key: String, value: String) {
        val stored = if (isEncryptedKey(key)) {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, profileKey())
            "enc1:" + Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
                Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        } else value
        app.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(key, stored).apply()
    }

    @Synchronized private fun profileKey(): SecretKey {
        val alias = "fhcpeboard_lan_profiles"
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }

    fun kcRemove(key: String) {
        app.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().remove(key).apply()
    }

    fun kcContains(key: String): Boolean {
        return app.getSharedPreferences(PREF, Context.MODE_PRIVATE).contains(key)
    }

    fun clearCaches(): Int {
        var removed = 0
        try {
            val prefs = app.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            val cacheKeys = prefs.all.keys.filter { key ->
                key.startsWith("UPSTREAM_LOCAL_DEVICE_") ||
                    key.startsWith("UPSTREAM_LOCAL_WIFI_CACHE_") ||
                    key.startsWith("UPSTREAM_LOCAL_SMS_CACHE_") ||
                    key == "UPSTREAM_LOCAL_WIFI_CACHE" ||
                    key == "UPSTREAM_LOCAL_CACHED_DATA_" ||
                    key == "CPE_WIDGET_CACHE" ||
                    key == "CPE_WIFI_CACHE" ||
                    key == "cpe_wifi_cache_v1"
            }
            if (cacheKeys.isNotEmpty()) {
                val edit = prefs.edit()
                cacheKeys.forEach { edit.remove(it) }
                edit.apply()
                removed += cacheKeys.size
            }
            val cacheDir = File(docs, "CPE_SC")
            cacheDir.listFiles()?.forEach { file ->
                if (file.name.startsWith("fetch_") || file.name == "app_cache.enc") {
                    if (file.delete()) removed++
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "clearCaches ${e.message}")
        }
        return removed
    }

    private fun safeFile(path: String): File? {
        return try {
            val root = docs.canonicalFile
            val f = File(path)
            val target = (if (f.isAbsolute) f else File(root, path)).canonicalFile
            val rp = root.path
            val tp = target.path
            if (tp == rp || tp.startsWith(rp + File.separator)) target else null
        } catch (e: Exception) {
            Log.w(TAG, "safeFile $path ${e.message}")
            null
        }
    }

    fun fileExists(path: String): Boolean = safeFile(path)?.exists() == true

    fun fileRead(path: String): String {
        return try {
            val f = safeFile(path) ?: return ""
            if (!f.exists()) "" else f.readText(Charsets.UTF_8)
        } catch (e: Exception) {
            Log.w(TAG, "fileRead $path ${e.message}")
            ""
        }
    }

    fun fileWrite(path: String, content: String) {
        try {
            val f = safeFile(path) ?: return
            f.parentFile?.mkdirs()
            f.writeText(content, Charsets.UTF_8)
        } catch (e: Exception) {
            Log.w(TAG, "fileWrite $path ${e.message}")
        }
    }

    fun fileRemove(path: String) {
        try { safeFile(path)?.delete() } catch (_: Exception) {}
    }

    private const val SEED_VER = "1.4.3-local-52"

    private fun isEncryptedKey(key: String): Boolean =
        key == "LAN_PROFILES_V1" || key.startsWith("UPSTREAM_LOCAL_") || key.startsWith("LAN_DEVICE_NAME_OVERRIDE_")

    fun seedFromAssets(context: Context) {
        reseedFromAssets(context, force = false)
    }

    fun reseedFromAssets(context: Context = app, force: Boolean = true) {
        try {
            val prefs = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            val cacheDir = File(docs, "CPE_SC")
            cacheDir.mkdirs()
            // A process kill can interrupt the normal read-and-delete path for
            // oversized device replies. Never retain those plaintext files.
            cacheDir.listFiles()?.filter { it.name.startsWith("fetch_") }?.forEach { it.delete() }
            val htmlCache = File(cacheDir, "html_cache.html")
            val appCache = File(cacheDir, "app_cache.enc")
            val needSeed = force || prefs.getString("seed_ver", "") != SEED_VER
            if (needSeed || !htmlCache.exists() || htmlCache.length() < 50_000L) {
                context.assets.open("fhcpeweb.html").use { input ->
                    htmlCache.outputStream().use { output -> input.copyTo(output) }
                }
                Log.i(TAG, "seeded html_cache.html len=${htmlCache.length()}")
            }
            // Retire the previous cloud executable; it must never run in LAN mode.
            if (appCache.exists()) appCache.delete()
            val cl = File(cacheDir, "changelog.json")
            if (force || !cl.exists()) {
                try {
                    context.assets.open("changelog.json").use { input ->
                        cl.outputStream().use { output -> input.copyTo(output) }
                    }
                } catch (_: Exception) {}
            }
            // Remove the previous edition's cloud-account/activation state.
            for (legacyKey in listOf("CPE_LIC", "CPE_TOKEN", "CPE_PASS_HEX", "CPE_USERNAME", "CPE_TOKEN_SOURCE", "UPSTREAM_LOCAL_WIFI_CACHE")) kcRemove(legacyKey)
            kcSet("CPE_SMS_TAB", "1")
            prefs.edit().putString("seed_ver", SEED_VER).apply()
        } catch (e: Exception) {
            Log.w(TAG, "reseedFromAssets ${e.message}")
        }
    }
}
