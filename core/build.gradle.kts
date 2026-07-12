// ichiflow Kotlin core (ADR-0007): decision evaluation, Temporal activity workers, and core domain
// services live here. Phase 0 is a walking skeleton — a buildable, tested module the polyglot
// toolchain (Gradle + pnpm) is proven reproducible on from day one. Kotlin stays out of workflow
// code (Temporal determinism caveat, ADR-0007); it hosts activities and domain services.
plugins {
    kotlin("jvm") version "2.0.21"
}

group = "ai.ichiflow"
version = "0.0.0"

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}
