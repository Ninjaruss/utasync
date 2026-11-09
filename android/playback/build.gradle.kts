plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "net.ninjaruss.utasync.playback"
    compileSdk = 35
    buildToolsVersion = "35.0.0"
    defaultConfig { minSdk = 26 }
}

kotlin { jvmToolchain(17) }

dependencies {
    // api: callers hold MediaController and build MediaItems.
    api(libs.media3.session)
    implementation(libs.media3.exoplayer)
    implementation(libs.androidx.core.ktx)
}
