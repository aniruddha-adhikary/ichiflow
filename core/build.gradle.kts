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

// Fabrikt (build plan 1.2, ADR-0006) generates Kotlin models from the canonical OpenAPI 3.1 doc.
// Kept on its own classpath so the generator's deps never leak into the core runtime/test closure.
val fabrikt: Configuration by configurations.creating

dependencies {
    // networknt is the independent JVM JSON Schema 2020-12 validator for the cross-language fidelity
    // spike (build plan 1.0). Apache-2.0 — clean under ADR-0016.
    implementation("com.networknt:json-schema-validator:1.5.4")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.18.2")
    // jackson-module-kotlin lets the generated data-class models round-trip without no-arg ctors;
    // jsr310 handles the `date-time` fields that Fabrikt maps to java.time.OffsetDateTime.
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.18.2")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.18.2")
    testImplementation(kotlin("test"))

    fabrikt("com.cjbooms:fabrikt:26.1.0")
}

kotlin {
    jvmToolchain(17)
}

// Generated Kotlin contract models are committed (contract of record) and compiled into main.
sourceSets["main"].kotlin.srcDir("generated/src/main/kotlin")

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

// Validate the real-contract vector corpus (build plan 1.3) with networknt; consumed by the TS
// `contract-vectors` scope for the cross-language agreement check.
tasks.register<JavaExec>("runContractVectors") {
    group = "verification"
    description = "Validate the contract vector corpus with networknt and write core/build/contract-vector-results.json."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("ai.ichiflow.core.spike.SpikeValidatorKt")
    args("schemas/vectors/contract-corpus.json", "build/contract-vector-results.json")
}

val openApiFile = layout.projectDirectory.file("../schemas/generated/openapi3/openapi.yaml")
val modelsPackage = "ai.ichiflow.contracts"

fun fabriktArgs(outputDir: java.io.File): List<String> = listOf(
    "--api-file", openApiFile.asFile.absolutePath,
    "--base-package", modelsPackage,
    "--output-directory", outputDir.absolutePath,
    "--targets", "http_models",
    "--validation-library", "NO_VALIDATION",
)

// Regenerate the committed Kotlin contract models from the OpenAPI (build plan 1.2). Run this and
// commit whenever the schema changes; drift is gated by `checkModelsUpToDate`.
tasks.register<JavaExec>("generateModels") {
    group = "codegen"
    description = "Generate Kotlin contract models from the canonical OpenAPI 3.1 document (Fabrikt)."
    classpath = fabrikt
    mainClass.set("com.cjbooms.fabrikt.cli.CodeGen")
    args = fabriktArgs(layout.projectDirectory.dir("generated").asFile)
}

// Regenerate-and-diff drift gate for the generated models: byte-compare a fresh generation against
// the committed tree. Any delta fails the build — the committed artifact is the contract of record.
tasks.register<JavaExec>("checkModelsUpToDate") {
    group = "verification"
    description = "Fail if the committed Kotlin contract models drift from a fresh Fabrikt generation."
    val tmpDir = layout.buildDirectory.dir("fabrikt-drift-check").get().asFile
    classpath = fabrikt
    mainClass.set("com.cjbooms.fabrikt.cli.CodeGen")
    doFirst {
        tmpDir.deleteRecursively()
        tmpDir.mkdirs()
    }
    args = fabriktArgs(tmpDir)
    doLast {
        val committed = layout.projectDirectory.dir("generated/src/main/kotlin").asFile
        val fresh = tmpDir.resolve("src/main/kotlin")
        fun tree(root: java.io.File) =
            root.walkTopDown().filter { it.isFile }
                .associate { it.relativeTo(root).path to it.readText() }
        val a = tree(committed)
        val b = tree(fresh)
        val drifted = (a.keys + b.keys).filter { a[it] != b[it] }.sorted()
        if (drifted.isNotEmpty()) {
            throw GradleException(
                "Kotlin model codegen drift in: ${drifted.joinToString()}. " +
                    "Run `./gradlew generateModels` and commit the result.",
            )
        }
        logger.lifecycle("Kotlin model codegen drift clean (${b.size} generated file(s) match).")
    }
}

tasks.named("check") {
    dependsOn("checkModelsUpToDate")
}
