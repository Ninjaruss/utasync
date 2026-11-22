plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "net.ninjaruss.utasync.japanese"
    compileSdk = 35
    buildToolsVersion = "35.0.0"
    defaultConfig {
        minSdk = 26
    }
}

kotlin {
    jvmToolchain(17)
    compilerOptions { allWarningsAsErrors = true }
}

dependencies {
    // Apache-2.0, IPADIC tagset (not UniDic: later gloss and role tuning is against IPADIC's tags).
    implementation(libs.kuromoji.ipadic)
    // The audit's corpus parser is a small hand-written one in the test sources, so the APK
    // and the test classpath gain nothing beyond JUnit (CLAUDE.md rule 5).
    testImplementation(libs.junit)
}
