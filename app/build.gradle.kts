import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing material lives outside the source tree. Override the
// location with FHCPE_KEYSTORE_PROPS; without it, release builds are unsigned.
val keystoreProps = Properties().apply {
    val path = System.getenv("FHCPE_KEYSTORE_PROPS")
        ?: rootProject.file("../release-signing/keystore.properties").path
    val file = file(path)
    if (file.isFile) file.inputStream().use { load(it) }
}

android {
    namespace = "com.fhcpeboard.android"
    ndkVersion = "28.2.13676358"
    compileSdk {
        version = release(37) { minorApiLevel = 0 }
    }

    defaultConfig {
        applicationId = "com.fhcpeboard.android"
        minSdk = 24
        targetSdk = 37
        versionCode = 140352
        versionName = "1.4.3-local-52"
        vectorDrawables.useSupportLibrary = true
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86") }
        externalNativeBuild {
            ndkBuild {
                arguments += "NDK_APPLICATION_MK=${file("src/main/cpp/Application.mk").absolutePath}"
            }
        }
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.findByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        viewBinding = false
        buildConfig = true
    }

    externalNativeBuild {
        ndkBuild { path = file("src/main/cpp/Android.mk") }
    }

    packaging {
        jniLibs {
            useLegacyPackaging = false
        }
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.appcompat:appcompat:1.8.0")
    implementation("com.google.android.material:material:1.14.0")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("com.squareup.okhttp3:okhttp:5.5.1")
    testImplementation("junit:junit:4.13.2")
}
