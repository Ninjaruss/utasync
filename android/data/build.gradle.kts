plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.ksp)
}

android {
    namespace = "net.ninjaruss.utasync.data"
    compileSdk = 35
    buildToolsVersion = "35.0.0"
    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
}

kotlin {
    jvmToolchain(17)
    compilerOptions { allWarningsAsErrors = true }
}

ksp {
    // Exported schemas are committed so every migration can be tested against the old shape.
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    // api: the DAO's public signatures expose Room and Flow types to :app.
    api(libs.room.runtime)
    api(libs.room.ktx)
    ksp(libs.room.compiler)
    // Timings are resolved through :align's applyAnchors; :align is pure Kotlin, the lowest layer.
    implementation(project(":align"))

    testImplementation(libs.junit)
    // The replaceLines -> resolve guarantee needs a real Room database, so it runs on a device.
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.junit)
}
