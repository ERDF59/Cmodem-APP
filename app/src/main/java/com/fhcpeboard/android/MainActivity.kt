package com.fhcpeboard.android

import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.widget.FrameLayout
import android.net.Uri
import android.content.Intent
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var board: WebView
    private lateinit var core: WebView
    private val mainHandler = Handler(Looper.getMainLooper())
    private val io = Executors.newCachedThreadPool()
    private var pendingLoadId: String? = null
    private var lastBoardHtml: String? = null
    private var lastHtmlSig: Int = 0
    private var lastHtmlAt: Long = 0L
    private val tag = "FHCpeBoard"
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val imagePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        board = findViewById(R.id.boardWebView)
        core = findViewById(R.id.coreWebView)
        applySystemInsets()
        if (!hasModernWebView()) {
            setupBack()
            core.visibility = View.GONE
            board.settings.javaScriptEnabled = false
            board.loadData(
                "<meta name=viewport content='width=device-width,initial-scale=1'><style>body{font-family:sans-serif;padding:32px 22px;background:#f6f7f9;color:#202124;line-height:1.7}h1{font-size:22px}p{font-size:15px}</style><h1>系统 WebView 版本过旧</h1><p>请更新 Android System WebView 或系统后重新打开 App。当前页面需要 Chromium WebView 80 或更高版本。</p>",
                "text/html",
                "utf-8"
            )
            return
        }
        setupBoard()
        setupCore()
        setupBack()
        requestLocalNetworkPermission()
        core.loadUrl("file:///android_asset/core.html")
    }

    private fun hasModernWebView(): Boolean {
        val version = runCatching { WebViewCompat.getCurrentWebViewPackage(this)?.versionName }.getOrNull()
        val major = version?.substringBefore('.')?.toIntOrNull()
        return major == null || major >= 80
    }

    fun isDarkTheme(): Boolean {
        val mask = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return mask == Configuration.UI_MODE_NIGHT_YES
    }

    fun runOnIo(block: () -> Unit) {
        io.execute {
            try {
                block()
            } catch (e: Exception) {
                Log.w(tag, "io ${e.message}")
            }
        }
    }

    private fun applySystemInsets() {
        val root = findViewById<View>(android.R.id.content)
        // Consume system/IME insets in the native container. Android WebView
        // reports CSS env(safe-area-inset-*) as zero, even edge-to-edge.
        // Padding the viewport also protects fixed headers, sheets and tabbar.
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime()
            )
            root.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            root.setBackgroundColor(
                if (isDarkTheme()) Color.parseColor("#121217") else Color.parseColor("#F2F5F9")
            )
            injectSafeAreaCss()
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(root)
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !isDarkTheme()
        controller.isAppearanceLightNavigationBars = !isDarkTheme()
    }

    private fun injectSafeAreaCss() {
        if (!this::board.isInitialized) return
        // The native container already consumed these pixels. Keep the page's
        // iOS safe-area rules at zero so bars/keyboard are not counted twice.
        val top = "0px"
        val bottom = "0px"
        val left = "0px"
        val right = "0px"
        val js = """
            (function(){
              try {
                var r = document.documentElement;
                if (!r) return;
                r.style.setProperty('--sat', '$top');
                r.style.setProperty('--sab', '$bottom');
                r.style.setProperty('--sal', '$left');
                r.style.setProperty('--sar', '$right');
                var s = document.getElementById('__android_insets');
                if (!s) {
                  s = document.createElement('style');
                  s.id = '__android_insets';
                  (document.head || r).appendChild(s);
                }
                s.textContent = ':root{--sat:$top;--sab:$bottom;--sal:$left;--sar:$right}';
              } catch (e) {}
            })();
        """.trimIndent()
        board.evaluateJavascript(js, null)
    }

    private fun setupBack() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!this@MainActivity::board.isInitialized) {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    return
                }
                board.evaluateJavascript(
                    "(function(){try{return typeof window.lanHandleBack==='function'?window.lanHandleBack():'none';}catch(e){return 'none';}})();"
                ) { result ->
                    if (result != null && !result.contains("none")) return@evaluateJavascript
                    moveTaskToBack(true)
                }
            }
        })
    }

    private fun requestLocalNetworkPermission() {
        if (Build.VERSION.SDK_INT < 37) return
        val perm = "android.permission.ACCESS_LOCAL_NETWORK"
        val granted = ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            ActivityCompat.requestPermissions(this, arrayOf(perm), REQ_LOCAL_NET)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWeb(view: WebView) {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val s = view.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.useWideViewPort = true
        s.loadWithOverviewMode = false
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false
        s.javaScriptCanOpenWindowsAutomatically = false
        s.mediaPlaybackRequiresUserGesture = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.safeBrowsingEnabled = true
        }
        view.setBackgroundColor(
            if (isDarkTheme()) Color.parseColor("#121217") else Color.parseColor("#F2F5F9")
        )
        view.overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
        view.isNestedScrollingEnabled = true
        try {
            @Suppress("DEPRECATION")
            s.allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            s.allowUniversalAccessFromFileURLs = false
        } catch (_: Exception) {
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
        view.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(webView: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    imagePicker.launch(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "image/*"
                    })
                    true
                } catch (_: Exception) {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = null
                    true
                }
            }
            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG) Log.i(
                    tag,
                    "js[${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}] ${consoleMessage.message()}"
                )
                return true
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupBoard() {
        setupWeb(board)
        // The visible dashboard is fully in-memory. It needs content:// only
        // for the user-selected wallpaper and must never read local files.
        board.settings.allowContentAccess = true
        board.addJavascriptInterface(BoardJsInterface(this), "AndroidBoard")
        board.webViewClient = object : WebViewClient() {
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                return recoverWebView(view, detail)
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                // All visual assets are embedded. HTTP is available only through the LAN-only native transport.
                if (request.url.scheme in setOf("http", "https")) return WebResourceResponse(
                    "text/plain", "utf-8", 403, "LAN native transport only", emptyMap(),
                    java.io.ByteArrayInputStream(ByteArray(0)))
                return null
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return handleBoardUrl(request.url?.toString() ?: return false)
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                return handleBoardUrl(url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!isBoardDocument(url)) return
                injectBoardBridge()
                injectSafeAreaCss()
                val id = pendingLoadId
                if (id != null) {
                    pendingLoadId = null
                    completeCoreCall(id, "true")
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupCore() {
        setupWeb(core)
        // The hidden core loads only packaged file:///android_asset scripts.
        core.settings.allowFileAccess = true
        @Suppress("DEPRECATION")
        core.settings.allowFileAccessFromFileURLs = true
        core.addJavascriptInterface(CoreJsInterface(this), "AndroidCore")
        core.webViewClient = object : WebViewClient() {
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                return recoverWebView(view, detail)
            }

            override fun onPageFinished(view: WebView, url: String) {
                Log.i(tag, "core ready $url")
            }
        }
    }

    private fun recoverWebView(dead: WebView, detail: RenderProcessGoneDetail): Boolean {
        val isBoard = this::board.isInitialized && dead === board
        val isCore = this::core.isInitialized && dead === core
        val crashed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail.didCrash()
        Log.e(tag, "${if (isBoard) "board" else "core"} renderer gone; crashed=$crashed")
        val parent = dead.parent as? ViewGroup
        val index = parent?.indexOfChild(dead) ?: -1
        val params = dead.layoutParams
        val oldVisibility = dead.visibility
        val oldAlpha = dead.alpha
        parent?.removeView(dead)
        runCatching { dead.stopLoading() }
        runCatching { dead.destroy() }
        if (isFinishing || isDestroyed || (!isBoard && !isCore)) return true

        val replacement = WebView(this).apply {
            layoutParams = params ?: FrameLayout.LayoutParams(
                if (isBoard) ViewGroup.LayoutParams.MATCH_PARENT else 1,
                if (isBoard) ViewGroup.LayoutParams.MATCH_PARENT else 1
            )
            visibility = oldVisibility
            alpha = oldAlpha
        }
        if (isBoard) {
            replacement.id = R.id.boardWebView
            board = replacement
            setupBoard()
        } else {
            replacement.id = R.id.coreWebView
            core = replacement
            setupCore()
        }
        if (parent != null) {
            if (index >= 0) parent.addView(replacement, index) else parent.addView(replacement)
        }
        if (isBoard) {
            lastBoardHtml?.let { html ->
                board.loadDataWithBaseURL("https://fhcpeboard.local/", html, "text/html", "utf-8", null)
            }
        } else {
            core.loadUrl("file:///android_asset/core.html")
        }
        return true
    }

    private fun handleBoardUrl(url: String): Boolean {
        if (url.startsWith("scriptable://")) {
            val payload = url.removePrefix("scriptable://")
            try {
                val decoded = java.net.URLDecoder.decode(payload, "UTF-8")
                forwardPageMessage(decoded)
            } catch (e: Exception) {
                Log.w(tag, "scriptable url ${e.message}")
            }
            return true
        }
        val u = url.lowercase()
        if (u.startsWith("https://fhcpeboard.local") || u.startsWith("about:") || u.startsWith("data:text/html")) {
            return false
        }
        Log.w(tag, "block nav $url")
        return true
    }

    private fun injectBoardBridge() {
        val js = """
            (function(){
              try {
                window.webkit = window.webkit || {};
                window.webkit.messageHandlers = window.webkit.messageHandlers || {};
                window.webkit.messageHandlers.scriptable = {
                  postMessage: function(n){
                    try {
                      var s = (typeof n === 'string') ? n : JSON.stringify(n);
                      if (window.AndroidBoard && window.AndroidBoard.postMessage) {
                        window.AndroidBoard.postMessage(s);
                      }
                    } catch (e) {}
                  }
                };
                if (typeof sendToScriptable !== 'function') {
                  window.sendToScriptable = function(e,t){
                    var n = Object.assign({action:e}, t||{});
                    window.webkit.messageHandlers.scriptable.postMessage(n);
                  };
                }
              } catch (e) {}
            })();
        """.trimIndent()
        board.evaluateJavascript(js, null)
        injectSafeAreaCss()
    }

    fun forwardPageMessage(json: String) {
        mainHandler.post {
            val lit = JSONObject.quote(json)
            core.evaluateJavascript("try{window.__onPageMessage($lit)}catch(e){console.warn(e)}", null)
        }
    }

    // Called on the IO thread. Device replies are normally a few KB, so pass
    // them inline; only unusually large bodies use the temp-file path.
    fun deliverFetch(id: String, status: Int, text: String) {
        val js = try {
            if (text.length <= INLINE_FETCH_LIMIT) {
                "try{window.__fetchText(" + JSONObject.quote(id) + "," + status + "," +
                    JSONObject.quote(text) + ")}catch(e){console.warn(e)}"
            } else {
                val path = HttpEngine.writeTemp(id, text)
                "try{window.__fetchDoneFile(" + JSONObject.quote(id) + "," + status + "," +
                    JSONObject.quote(path) + ")}catch(e){console.warn(e)}"
            }
        } catch (e: Exception) {
            Log.w(tag, "deliverFetch ${e.message}")
            "try{window.__fetchText(" + JSONObject.quote(id) + ",0,'')}catch(e){console.warn(e)}"
        }
        mainHandler.post { core.evaluateJavascript(js, null) }
    }

    fun evalOnBoard(id: String, js: String) {
        mainHandler.post {
            board.evaluateJavascript(js) { result ->
                completeCoreCall(id, result ?: "null")
            }
        }
    }

    fun loadBoardHtml(id: String, html: String) {
        mainHandler.post {
            lastBoardHtml = html
            val sig = html.length xor html.hashCode()
            val now = System.currentTimeMillis()
            if (sig == lastHtmlSig && now - lastHtmlAt < 1200L) {
                completeCoreCall(id, "true")
                return@post
            }
            lastHtmlSig = sig
            lastHtmlAt = now
            pendingLoadId = id
            board.loadDataWithBaseURL(
                "https://fhcpeboard.local/",
                html,
                "text/html",
                "utf-8",
                null
            )

        }
    }


    private fun isBoardDocument(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = url.lowercase()
        if (u == "about:blank" || u.startsWith("about:")) return false
        return u.contains("fhcpeboard.local") || u.startsWith("data:text/html")
    }

    private fun completeCoreCall(id: String, resultJs: String) {
        val payload = JSONObject()
        payload.put("id", id)
        payload.put("result", resultJs)
        val lit = JSONObject.quote(payload.toString())
        core.evaluateJavascript("try{window.__nativeDone($lit)}catch(e){console.warn(e)}", null)
    }

    override fun onPause() {
        if (this::core.isInitialized) core.evaluateJavascript("window.__lanNativeActive=false;try{__lanActive(false)}catch(e){}", null)
        if (this::board.isInitialized) {
            board.evaluateJavascript(
                "try{if(typeof _spStop==='function')_spStop();if(typeof _ppStop==='function')_ppStop()}catch(e){}",
                null
            )
            board.onPause()
        }
        if (this::core.isInitialized) core.onPause()
        try { CookieManager.getInstance().flush() } catch (_: Exception) {}
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (this::board.isInitialized) {
            board.onResume()
            board.invalidate()
            board.evaluateJavascript("try{window.__lanRestoreVisuals&&window.__lanRestoreVisuals()}catch(e){}", null)
        }
        if (this::core.isInitialized) core.onResume()
        // The LAN core validates the session immediately on foreground entry.
        // Do not also trigger the legacy cloud page-refresh path.
        if (this::core.isInitialized) core.evaluateJavascript("window.__lanNativeActive=true;try{__lanActive(true)}catch(e){}", null)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val bg = if (isDarkTheme()) Color.parseColor("#121217") else Color.parseColor("#F2F5F9")
        findViewById<View>(android.R.id.content).setBackgroundColor(bg)
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !isDarkTheme()
        controller.isAppearanceLightNavigationBars = !isDarkTheme()
        if (this::board.isInitialized) {
            board.setBackgroundColor(bg)
            injectSafeAreaCss()
            val dark = isDarkTheme()
            val themeJs = "try{var d=" + dark + ";document.documentElement.setAttribute('data-theme',d?'dark':'light');if(window.__onTheme)window.__onTheme(d);}catch(e){}"
            board.evaluateJavascript(themeJs, null)
        }
        if (this::core.isInitialized) {
            core.setBackgroundColor(bg)
            core.evaluateJavascript("try{globalThis.__themeDark=" + isDarkTheme() + "}catch(e){}", null)
        }
    }

    override fun onDestroy() {
        try {
            io.shutdownNow()
        } catch (_: Exception) {
        }
        try {
            if (this::board.isInitialized) {
                board.stopLoading()
                board.destroy()
            }
            if (this::core.isInitialized) {
                core.stopLoading()
                core.destroy()
            }
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    companion object {
        private const val REQ_LOCAL_NET = 10017
        private const val INLINE_FETCH_LIMIT = 512 * 1024
    }
}
