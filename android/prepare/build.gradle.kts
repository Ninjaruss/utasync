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
    // api: prepareSong/adoptTrack take :data's SongDao and SongEntity, so :data is part of
    // this module's public signatures. With `implementation` it compiled only because :app
    // happens to depend on :data itself, which a future consumer need not.
    api(project(":data"))
    // implementation: :align's Sheet is used inside adoptTrack and never appears in a
    // signature, so a consumer does not need it. Checked, not assumed.
    implementation(project(":align"))
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    // android.jar's org.json is a stub that throws on the JVM; the real one makes the parsing
    // tests meaningful. Test-only: the APK keeps the platform's own org.json.
    testImplementation(libs.org.json)
}
