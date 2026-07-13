package ai.ichiflow.core.architecture

import com.fasterxml.jackson.databind.ObjectMapper
import com.tngtech.archunit.core.domain.JavaClasses
import com.tngtech.archunit.core.importer.ClassFileImporter
import com.tngtech.archunit.core.importer.ImportOption
import com.tngtech.archunit.lang.ArchRule
import com.tngtech.archunit.lang.EvaluationResult
import com.tngtech.archunit.library.dependencies.SlicesRuleDefinition
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses

/**
 * Architecture invariants enforced as tests (build plan 2.1). ArchUnit turns the Decision Engine SPI
 * boundary and layering conventions into compile-checked rules: a violation fails `./gradlew build`.
 * Each rule is also written machine-readably to `build/arch-rules-results.json` for the
 * `code-quality` verify scope, so the same invariants surface in the `ichiflow verify` verdict.
 */
class ArchitectureTest {

    private val classes: JavaClasses = ClassFileImporter()
        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
        .importPackages("ai.ichiflow.core")

    private data class NamedRule(val id: String, val rule: ArchRule)

    private val rules: List<NamedRule> = listOf(
        // The Decision Engine SPI is the *only* place Apache KIE / Drools may be referenced. Every
        // other package talks to decisions through the engine-neutral SPI (ADR-0002 anti-lock-in).
        NamedRule(
            "spi.boundary.kie-confined-to-spi",
            noClasses()
                .that().resideOutsideOfPackage("ai.ichiflow.core.decision.spi..")
                .should().dependOnClassesThat().resideInAnyPackage("org.kie..", "org.drools..")
                .because("only the decision.spi engine adapter may depend on Apache KIE/Drools"),
        ),
        // The SPI *contract* (interfaces + DTOs) must stay engine-neutral: the abstraction itself
        // cannot leak a vendor type. Only the Drools adapter within the package may.
        NamedRule(
            "spi.contract.engine-neutral",
            noClasses()
                .that().resideInAPackage("ai.ichiflow.core.decision.spi..")
                .and().haveSimpleNameNotContaining("Drools")
                .should().dependOnClassesThat().resideInAnyPackage("org.kie..", "org.drools..")
                .because("the SPI contract must not expose a vendor engine type"),
        ),
        // The decision-source projection (source model + compiler) is a pure text transform; it must
        // not reach into any engine at all — it emits DMN XML that engines later consume.
        NamedRule(
            "decision-source.pure-projection",
            noClasses()
                .that().haveSimpleNameEndingWith("Compiler")
                .or().haveSimpleNameEndingWith("Source")
                .should().dependOnClassesThat().resideInAnyPackage("org.kie..", "org.drools..", "ai.ichiflow.core.decision.spi..")
                .because("decision-source projection compiles to DMN text and must stay engine-free"),
        ),
        // The entity-store Repository SPI contract must stay persistence-neutral: the abstraction
        // (interfaces + DTOs in entity.spi) may not depend on any concrete binding in entity.store,
        // so the deferred PostgreSQL/jOOQ/Exposed pick (ADR-0018) slots in without touching callers.
        NamedRule(
            "entity.spi.contract-independent-of-binding",
            noClasses()
                .that().resideInAPackage("ai.ichiflow.core.entity.spi..")
                .should().dependOnClassesThat().resideInAPackage("ai.ichiflow.core.entity.store..")
                .because("the Repository SPI contract must not depend on a concrete persistence binding"),
        ),
        // The Policy Engine SPI contract must stay engine-neutral: the abstraction (authz.spi) may not
        // depend on the concrete OpenFGA reference binding (authz.engine), so a real OpenFGA server or a
        // Cedar/OPA engine (ADR-0010) binds the same SPI later without touching the contract.
        NamedRule(
            "authz.spi.contract-independent-of-binding",
            noClasses()
                .that().resideInAPackage("ai.ichiflow.core.authz.spi..")
                .should().dependOnClassesThat().resideInAPackage("ai.ichiflow.core.authz.engine..")
                .because("the Policy Engine SPI contract must not depend on a concrete engine binding"),
        ),
        // The PDP gateway and the PEPs must reach the engine only through the SPI — never the concrete
        // binding. Only the AuthzRunner composition root may wire a specific engine. This keeps
        // "one PDP, swappable engine" true (doc 06 §2.1).
        NamedRule(
            "authz.pdp-and-peps-depend-on-spi-not-binding",
            noClasses()
                .that().resideInAPackage("ai.ichiflow.core.authz.pep..")
                .or().haveSimpleName("Pdp")
                .should().dependOnClassesThat().resideInAPackage("ai.ichiflow.core.authz.engine..")
                .because("the PDP and PEPs must talk to the engine through the SPI, not the binding"),
        ),
        // No package cycles within the core (keeps the module graph a DAG).
        NamedRule(
            "core.no-package-cycles",
            SlicesRuleDefinition.slices()
                .matching("ai.ichiflow.core.(*)..")
                .should().beFreeOfCycles(),
        ),
    )

    @Test
    fun `architecture invariants hold and are recorded for the verify harness`() {
        val mapper = ObjectMapper()
        val root = mapper.createObjectNode()
        root.put("suite", "archunit")
        root.put("rules", rules.size)
        val arr = root.putArray("results")

        val failures = mutableListOf<String>()
        for (nr in rules) {
            val evaluation: EvaluationResult = nr.rule.evaluate(classes)
            val violations = evaluation.failureReport.details
            val node = arr.addObject()
            node.put("id", nr.id)
            node.put("passed", !evaluation.hasViolation())
            val vArr = node.putArray("violations")
            violations.forEach { vArr.add(it) }
            if (evaluation.hasViolation()) {
                failures += "${nr.id}:\n  " + violations.joinToString("\n  ")
            }
        }

        val out = File("build/arch-rules-results.json")
        out.parentFile.mkdirs()
        out.writeText(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root) + "\n")

        assertTrue(failures.isEmpty(), "ArchUnit violations:\n" + failures.joinToString("\n"))
    }
}
