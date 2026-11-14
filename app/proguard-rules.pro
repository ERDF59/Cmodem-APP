# WebView bridges: methods are called by name from JavaScript.
-keepclassmembers class com.fhcpeboard.android.CoreJsInterface {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class com.fhcpeboard.android.BoardJsInterface {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keepattributes *Annotation*

# JNI entry points are resolved against this stable class name.
-keep class com.fhcpeboard.android.NativeCore { *; }
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}

# OkHttp optional platform integrations.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
