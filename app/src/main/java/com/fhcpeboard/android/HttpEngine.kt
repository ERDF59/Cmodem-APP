package com.fhcpeboard.android

import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import java.io.File
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import java.net.Proxy

object HttpEngine {
    private const val TAG = "FHCpeBoard"
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    // Every connection, including DNS names, goes through this filter: a name
    // that resolves (or is later re-pointed) to loopback, link-local,
    // multicast or unspecified addresses never gets a connection.
    private val deviceDns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            val usable = Dns.SYSTEM.lookup(hostname).filter(::isDeviceAddress)
            if (usable.isEmpty()) throw UnknownHostException("No usable device address for $hostname")
            return usable
        }
    }

    private class DeviceCookieJar : CookieJar {
        private val cookies = mutableMapOf<String, List<Cookie>>()
        @Synchronized override fun saveFromResponse(url: HttpUrl, incoming: List<Cookie>) {
            cookies[url.host] = ((cookies[url.host] ?: emptyList()).filter { old ->
                incoming.none { it.name == old.name && it.path == old.path }
            } + incoming).filter { it.expiresAt > System.currentTimeMillis() }
        }
        @Synchronized override fun loadForRequest(url: HttpUrl): List<Cookie> =
            cookies[url.host].orEmpty().filter { it.expiresAt > System.currentTimeMillis() && it.matches(url) }
        @Synchronized fun clearHost(host: String) { cookies.remove(host) }
    }

    private val cookieStore = DeviceCookieJar()
    private val client: OkHttpClient = OkHttpClient.Builder()
        .proxy(Proxy.NO_PROXY)
        .dns(deviceDns)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .cookieJar(cookieStore)
        .build()

    data class FetchResult(val status: Int, val text: String)

    fun clearSession(url: String) {
        runCatching { cookieStore.clearHost(url.toHttpUrl().host) }
    }

    // Device endpoints: http or https; an IPv4/IPv6 literal (LAN or public) or
    // a DNS name. Literals are checked here without a lookup; names are
    // checked after resolution by deviceDns. HTTPS uses the platform's normal
    // certificate and hostname verification. Keep in sync with
    // assets/device_address.js.
    fun isDeviceUrl(url: String): Boolean = try {
        val parsed = url.toHttpUrl()
        val host = parsed.host
        (parsed.scheme == "http" || parsed.scheme == "https") &&
            parsed.username.isEmpty() && parsed.password.isEmpty() &&
            when {
                isIpLiteral(host) -> isDeviceAddress(InetAddress.getByName(host))
                else -> isDnsName(host)
            }
    } catch (_: Exception) { false }

    fun isDeviceAddress(addr: InetAddress): Boolean =
        !addr.isLoopbackAddress && !addr.isLinkLocalAddress && !addr.isMulticastAddress &&
            !addr.isAnyLocalAddress && (addr is Inet4Address || addr is Inet6Address) &&
            !(addr is Inet4Address && (addr.address[0].toInt() and 0xff).let { it == 0 || it >= 224 })

    private fun isIpLiteral(host: String): Boolean = isIpv4Literal(host) ||
        (host.contains(':') && host.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' || it == ':' || it == '.' })

    private fun isIpv4Literal(host: String): Boolean {
        val parts = host.split('.')
        return parts.size == 4 && parts.all { p -> p.isNotEmpty() && p.length <= 3 && p.all(Char::isDigit) && p.toInt() in 0..255 }
    }

    private val dnsLabel = Regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
    private fun isDnsName(host: String): Boolean {
        val labels = host.lowercase().split('.')
        return host.length <= 253 && labels.size >= 2 && labels.all { dnsLabel.matches(it) } &&
            Regex("^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$").matches(labels.last()) &&
            labels.last() != "localhost"
    }

    fun fetch(url: String, optJson: String): FetchResult {
        if (!isDeviceUrl(url)) return FetchResult(403, "DEVICE_ADDRESS_REJECTED")
        return try {
            val opt = if (optJson.isBlank()) JSONObject() else JSONObject(optJson)
            val method = opt.optString("method", "GET").ifBlank { "GET" }.uppercase()
            val builder = Request.Builder().url(url)
            val headers = opt.optJSONObject("headers")
            if (headers != null) {
                val keys = headers.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    builder.header(k, headers.optString(k))
                }
            }
            if (!opt.has("headers") || opt.optJSONObject("headers")?.has("Accept") != true) {
                builder.header("Accept", "*/*")
            }
            val bodyStr = when {
                opt.has("body") && !opt.isNull("body") -> {
                    val b = opt.get("body")
                    if (b is JSONObject) b.toString() else b.toString()
                }
                else -> null
            }
            // LuCI login and cmodem writes require form bodies. OkHttp uses the
            // RequestBody media type and would otherwise override this header.
            val bodyType = headers?.optString("Content-Type")?.takeIf { it.isNotBlank() }
                ?.toMediaType() ?: jsonType
            if (method == "POST" || method == "PUT" || method == "PATCH") {
                builder.method(method, (bodyStr ?: "").toRequestBody(bodyType))
            } else if (method == "DELETE") {
                builder.method(method, bodyStr?.toRequestBody(bodyType))
            } else {
                builder.method("GET", null)
            }
            val timeoutMs = opt.optLong("timeoutMs", 45_000L).coerceIn(1_000L, 45_000L)
            val requestClient = client.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build()
            requestClient.newCall(builder.build()).execute().use { resp ->
                val text = resp.body?.string() ?: ""
                FetchResult(resp.code, text)
            }
        } catch (e: Exception) {
            val safePath = try { url.toHttpUrl().encodedPath } catch (_: Exception) { "<invalid-url>" }
            Log.w(TAG, "fetch $safePath ${e.javaClass.simpleName}: ${e.message}")
            FetchResult(0, failureReason(e))
        }
    }

    // Status stays 0 (network failure); the body names the cause for the UI.
    private fun failureReason(e: Exception): String = when (e) {
        is SecurityException -> "LOCAL_NETWORK_PERMISSION_DENIED"
        is UnknownHostException -> "DNS_FAILED"
        is javax.net.ssl.SSLPeerUnverifiedException, is java.security.cert.CertificateException -> "TLS_CERT_FAILED"
        is javax.net.ssl.SSLException -> if (e.cause is java.security.cert.CertificateException) "TLS_CERT_FAILED" else "TLS_FAILED"
        else -> ""
    }

    fun writeTemp(id: String, text: String): String {
        val dir = File(NativeStore.docsDir(), "CPE_SC")
        dir.mkdirs()
        val f = File(dir, "fetch_$id.txt")
        f.writeText(text, Charsets.UTF_8)
        return f.absolutePath
    }
}
