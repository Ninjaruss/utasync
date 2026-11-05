// Pure Kotlin: no Android dependencies, so the alignment logic tests on the JVM and can be
// checked against the desktop experiment's output (golden vectors).
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    testImplementation(libs.junit)
}
