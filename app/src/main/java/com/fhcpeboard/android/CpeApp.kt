package com.fhcpeboard.android

import android.app.Application

class CpeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        NativeStore.init(this)
        NativeStore.seedFromAssets(this)
    }

    companion object {
        lateinit var instance: CpeApp
            private set
    }
}
