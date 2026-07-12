package ai.ichiflow.core

/**
 * Walking-skeleton marker for the ichiflow Kotlin core (ADR-0007). Real subsystems — the Decision
 * Engine SPI + Drools embedding (Phase 2), Temporal activity workers (Phase 3), generated
 * repositories (Phase 4) — land here behind their harnesses. This exists so the JVM half of the
 * polyglot toolchain builds and tests green from Phase 0.
 */
object Core {
    const val NAME: String = "ichiflow-core"
    const val VERSION: String = "0.0.0"

    fun banner(): String = "$NAME $VERSION"
}
