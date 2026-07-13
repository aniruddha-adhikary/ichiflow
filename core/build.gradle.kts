// ichiflow Kotlin core (ADR-0007): decision evaluation, Temporal activity workers, and core domain
// services live here. Phase 0 is a walking skeleton — a buildable, tested module the polyglot
// toolchain (Gradle + pnpm) is proven reproducible on from day one. Kotlin stays out of workflow
// code (Temporal determinism caveat, ADR-0007); it hosts activities and domain services.
plugins {
    kotlin("jvm") version "2.0.21"
    application
    // Kotlin static analysis (non-negotiable quality gate, ADR-0016 / build doctrine). detekt runs as
    // part of `check`, so `./gradlew build` fails on any finding. Pinned; Apache-2.0.
    id("io.gitlab.arturbosch.detekt") version "1.23.7"
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
    // Apache KIE / Drools DMN is the v1 reference decision engine (ADR-0002), pinned to KIE 10.2.0
    // (build plan 2.1). Phase 2.0 embeds it to execute DMN 1.6 (the hard boxed-expression kinds).
    // Apache-2.0 — clean under ADR-0016.
    implementation("org.kie:kie-dmn-core:10.2.0")
    testImplementation(kotlin("test"))
    // ArchUnit enforces architecture invariants as ordinary tests (build plan 2.1): the Decision
    // Engine SPI boundary — only `…decision.spi` may touch `org.kie..` — is a compile-checked rule,
    // not a convention. Apache-2.0 — clean under ADR-0016.
    testImplementation("com.tngtech.archunit:archunit-junit5:1.3.0")

    fabrikt("com.cjbooms:fabrikt:26.1.0")
}

kotlin {
    jvmToolchain(17)
}

// detekt scans only hand-authored sources — generated Fabrikt models (contract of record, drift-gated)
// are never linted. SARIF is emitted for the `code-quality` verify scope to consume machine-readably.
detekt {
    buildUponDefaultConfig = true
    config.setFrom(files("config/detekt/detekt.yml"))
    source.setFrom(files("src/main/kotlin", "src/test/kotlin"))
    parallel = true
}

tasks.withType<io.gitlab.arturbosch.detekt.Detekt>().configureEach {
    reports {
        sarif.required.set(true)
        html.required.set(false)
        xml.required.set(false)
        txt.required.set(false)
        md.required.set(false)
    }
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

// Compile the decision-source fixture to DMN 1.6 and execute it and the hand-authored reference on
// KIE/Drools across the input vectors (build plan 2.0). Writes core/build/decision-projection-results.json,
// consumed by the TS `decision-projection-spike` scope.
tasks.register<JavaExec>("runDecisionSpike") {
    group = "verification"
    description = "Compile decision-source → DMN 1.6, execute vs the reference DMN on KIE, and write core/build/decision-projection-results.json."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("ai.ichiflow.core.decision.DecisionProjectionSpike")
}

// Run the curated DMN-TCK conformance subset through the Decision Engine SPI reference engine
// (build plan 2.1). Writes core/build/decision-tck-results.json, consumed by the TS
// `decision-layer` scope for the tck_cases_green/total + capability-descriptor assertions.
tasks.register<JavaExec>("runDecisionTck") {
    group = "verification"
    description = "Execute the DMN-TCK subset on the SPI reference engine and write core/build/decision-tck-results.json."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("ai.ichiflow.core.decision.tck.DecisionTckRunner")
}

// Compile every construct in the DMN feature matrix (build plan 2.2) one-way to DMN 1.6 and execute
// the projection on the SPI reference engine. Writes core/build/projection-coverage-results.json,
// consumed by the TS `decision-layer` scope for the constructs_covered/total assertion.
tasks.register<JavaExec>("runProjectionCoverage") {
    group = "verification"
    description = "Project the decision-source feature matrix to DMN 1.6, execute on the SPI engine, and write core/build/projection-coverage-results.json."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("ai.ichiflow.core.decision.projection.ProjectionCoverageRunner")
}

// Emit the typed DecisionTrace each evaluate() produces across the feature matrix (build plan 2.3,
// doc 03 §7). Writes core/build/decision-trace-results.json, consumed by the TS `decision-layer`
// scope for the trace-shape conformance assertion against the frozen DecisionTrace JSON Schema.
tasks.register<JavaExec>("runDecisionTrace") {
    group = "verification"
    description = "Emit DecisionTrace objects across the feature matrix and write core/build/decision-trace-results.json."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("ai.ichiflow.core.decision.trace.DecisionTraceRunner")
}

// Run a DecisionModel's governed Harness (scenario suite) on the SPI engine, asserting the full typed
// Outcome per case and computing rule/row coverage (build plan 2.4, doc 03 §6). Writes
// core/build/scenario-coverage-results.json for the `decision-layer` scenarios_pass/coverage gate.
tasks.register<JavaExec>("runScenarioCoverage") {
    group = "verification"
    description = "Run the DecisionModel scenario suite + rule/row coverage and write core/build/scenario-coverage-results.json."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("ai.ichiflow.core.decision.scenario.ScenarioCoverageRunner")
}

// Evaluate the frozen FEEL semantics vectors on the reference engine (build plan 2.4, doc 13 §2.b).
// Writes core/build/feel-vector-results.json for the `decision-layer` feel_vectors_green gate.
tasks.register<JavaExec>("runFeelVectors") {
    group = "verification"
    description = "Evaluate the FEEL semantics vectors and write core/build/feel-vector-results.json."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("ai.ichiflow.core.decision.feel.FeelVectorRunner")
}

// Replay the committed entity-store conformance vectors against the Repository SPI reference binding
// (build plan 4.1). Writes core/build/entity-store-results.json for the `entity-store` scope's
// vectors_green / outbox_delivered gates.
tasks.register<JavaExec>("runEntityStore") {
    group = "verification"
    description = "Run the entity-store CRUD/outbox vectors and write core/build/entity-store-results.json."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("ai.ichiflow.core.entity.EntityStoreRunner")
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
