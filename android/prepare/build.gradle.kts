plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "net.ninjaruss.utasync.prepare"
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
    implementation(project(":align"))
    implementation(project(":data"))
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    // android.jar's org.json is a stub that throws on the JVM; the real one makes the parsing
    // tests meaningful. Test-only: the APK keeps the platform's own org.json.
    testImplementation(libs.org.json)
}
