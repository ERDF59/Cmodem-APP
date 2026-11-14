package com.fhcpeboard.android

import org.junit.Assert.*
import org.junit.Test

class HttpEngineTest {
    @Test fun acceptsLanAndPublicIpv4() {
        for (url in listOf("http://192.168.8.1/fh_api/tmp/FHAPIS", "http://10.0.0.1:8080/", "http://172.31.1.1/",
                "http://100.69.191.69/cgi-bin/luci/", "http://8.8.8.8/", "http://36.112.1.2:8443/cgi-bin/luci/"))
            assertTrue(url, HttpEngine.isDeviceUrl(url))
    }

    @Test fun acceptsGlobalAndUniqueLocalIpv6() {
        for (url in listOf("http://[2409:8a00::1]/", "http://[240e:3a1:1::5]:8080/ubus/", "http://[fd00::1]/cgi-bin/luci/"))
            assertTrue(url, HttpEngine.isDeviceUrl(url))
    }

    @Test fun ipv6CookieHostIsStableAcrossRequests() {
        // The cookie jar is keyed by HttpUrl.host; IPv6 hosts must not vary by spelling.
        assertEquals(okhttp3.HttpUrl.Builder().scheme("http").host("2409:8a00::1").build().host,
            "http://[2409:8A00:0::1]/cgi-bin/luci/".let { okhttp3.HttpUrl.Companion.run { it.toHttpUrl() } }.host)
    }

    @Test fun acceptsHttpsAndDnsNames() {
        for (url in listOf("https://air6.erdf123.xyz/cgi-bin/luci/", "http://air6.erdf123.xyz/", "https://192.168.8.1/",
                "https://[2409:8a00::1]:8443/ubus/", "http://router.example.com:8080/", "https://xn--fiqs8s.xn--55qx5d/"))
            assertTrue(url, HttpEngine.isDeviceUrl(url))
    }

    @Test fun resolvedAddressFilterRejectsNonDeviceTargets() {
        val bad = listOf("127.0.0.1", "0.0.0.0", "169.254.1.1", "224.0.0.1", "::1", "::", "fe80::1", "ff02::1")
        for (ip in bad) assertFalse(ip, HttpEngine.isDeviceAddress(java.net.InetAddress.getByName(ip)))
        for (ip in listOf("192.168.1.1", "104.21.75.244", "2606:4700:3031::ac43:b80b", "fd00::1"))
            assertTrue(ip, HttpEngine.isDeviceAddress(java.net.InetAddress.getByName(ip)))
    }

    @Test fun rejectsCredentialsBadNamesAndNonDeviceAddresses() {
        for (url in listOf("ftp://192.168.8.1/", "http://localhost/", "http://router/", "http://a..b.com/", "http://-bad.com/",
                "http://admin@192.168.8.1/", "http://100.69.191.69@8.8.8.8/", "https://user:pass@air6.erdf123.xyz/",
                "http://127.0.0.1/", "http://0.0.0.0/", "http://0.1.2.3/", "http://169.254.1.1/", "http://224.0.0.1/", "http://255.255.255.255/",
                "http://[::1]/", "http://[::]/", "http://[fe80::1]/", "http://[ff02::1]/", "http://foo.localhost/"))
            assertFalse(url, HttpEngine.isDeviceUrl(url))
    }
}
