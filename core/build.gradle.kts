// ichiflow Kotlin core (ADR-0007): decision evaluation, Temporal activity workers, and core domain
// services live here. Phase 0 is a walking skeleton — a buildable, tested module the polyglot
// toolchain (Gradle + pnpm) is proven reproducible on from day one. Kotlin stays out of workflow
// code (Temporal determinism caveat, ADR-0007); it hosts activities and domain services.
plugins {
    kotlin("jvm") version "2.0.21"
    application
}

group = "ai.ichiflow"
version = "0.0.0"

repositories {
    mavenCentral()
}

dependencies {
    // networknt is the independent JVM JSON Schema 2020-12 validator for the cross-language fidelity
    // spike (build plan 1.0). Apache-2.0 — clean under ADR-0016.
    implementation("com.networknt:json-schema-validator:1.5.4")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.18.2")
    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(17)
}

application {
    mainClass.set("ai.ichiflow.core.spike.SpikeValidatorKt")
}

tasks.test {
    useJUnitPlatform()
}

// Emit the JVM validator's accept/reject verdict for every probe vector, consumed by the TS
// `schema-fidelity-spike` scope for the cross-language agreement check.
tasks.register<JavaExec>("runSpike") {
    group = "verification"
    description = "Validate the fidelity probe corpus with networknt and write core/build/spike-results.json."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("ai.ichiflow.core.spike.SpikeValidatorKt")
}
