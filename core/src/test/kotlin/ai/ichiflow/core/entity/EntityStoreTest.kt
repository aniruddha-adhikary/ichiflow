package ai.ichiflow.core.entity

import ai.ichiflow.core.entity.spi.EntityNotFoundException
import ai.ichiflow.core.entity.spi.EntityOp
import ai.ichiflow.core.entity.spi.EntityQuerySpec
import ai.ichiflow.core.entity.store.InMemoryEntityRepository
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Build-failing unit tests for the entity-store Repository SPI reference binding (build plan 4.1,
 * ADR-0018). They pin the CRUD + versioning + soft-delete + query/pagination/search + transactional
 * outbox semantics the generated callers and the `entity-store` verify scope depend on; a regression
 * fails `./gradlew test`. Determinism is structural — a fresh store, monotonic stamps, no clock/RNG.
 */
class EntityStoreTest {

    private fun loan(applicant: String, amount: Double, product: String, status: String) =
        mapOf("applicant" to applicant, "amount" to amount, "productCode" to product, "status" to status)

    @Test
    fun `create-update-delete round-trips with versioning, soft-delete, audit and outbox`() {
        val repo = InMemoryEntityRepository()

        val created = repo.create("LoanApplication", "app-1", "case-1", loan("Alice", 1000.0, "PERMIT-A", "submitted"))
        assertEquals(1, created.version)
        assertEquals("case-1", created.caseId)
        assertEquals(created, repo.get("LoanApplication", "app-1"))

        val updated = repo.update("LoanApplication", "app-1", loan("Alice", 1000.0, "PERMIT-A", "approved"))
        assertEquals(2, updated.version)
        assertEquals("approved", repo.get("LoanApplication", "app-1")?.data?.get("status"))

        repo.delete("LoanApplication", "app-1")
        assertNull(repo.get("LoanApplication", "app-1"), "a soft-deleted record is invisible to reads")

        assertEquals(
            listOf(EntityOp.CREATE, EntityOp.UPDATE, EntityOp.DELETE),
            repo.auditLog().map { it.operation },
        )
        assertEquals(listOf(1, 2, 3), repo.auditLog().map { it.version })
        assertEquals(3, repo.outbox().size)
        assertTrue(repo.outbox().none { it.delivered }, "outbox starts undelivered")
    }

    @Test
    fun `relay delivers every outbox record and is idempotent`() {
        val repo = InMemoryEntityRepository()
        repo.create("LoanApplication", "app-1", null, loan("Bob", 2000.0, "PERMIT-B", "draft"))
        repo.create("LoanApplication", "app-2", null, loan("Carol", 1500.0, "PERMIT-A", "draft"))

        assertEquals(2, repo.relayOutbox())
        assertTrue(repo.outbox().all { it.delivered })
        assertEquals(0, repo.relayOutbox(), "already-delivered records are skipped")
    }

    @Test
    fun `query filters, free-text searches, sorts and paginates deterministically`() {
        val repo = InMemoryEntityRepository()
        repo.create("LoanApplication", "app-1", null, loan("Alice", 1000.0, "PERMIT-A", "submitted"))
        repo.create("LoanApplication", "app-2", null, loan("Bob", 2000.0, "PERMIT-B", "draft"))
        repo.create("LoanApplication", "app-3", null, loan("Carol", 1500.0, "PERMIT-A", "approved"))

        val firstPage = repo.query(EntityQuerySpec("LoanApplication", sort = "amount", page = 0, size = 2))
        assertEquals(3, firstPage.total)
        assertEquals(listOf("app-1", "app-3"), firstPage.ids)

        val filtered =
            repo.query(EntityQuerySpec("LoanApplication", filter = mapOf("productCode" to "PERMIT-A"), sort = "amount"))
        assertEquals(listOf("app-1", "app-3"), filtered.ids)

        val searched = repo.query(EntityQuerySpec("LoanApplication", search = "bob"))
        assertEquals(listOf("app-2"), searched.ids)
    }

    @Test
    fun `mutating a missing record fails and creating a duplicate id is rejected`() {
        val repo = InMemoryEntityRepository()
        assertFailsWith<EntityNotFoundException> { repo.update("LoanApplication", "ghost", loan("X", 1.0, "P", "draft")) }
        assertFailsWith<EntityNotFoundException> { repo.delete("LoanApplication", "ghost") }

        repo.create("LoanApplication", "app-1", null, loan("Alice", 1000.0, "PERMIT-A", "draft"))
        assertFailsWith<IllegalArgumentException> {
            repo.create("LoanApplication", "app-1", null, loan("Alice", 1000.0, "PERMIT-A", "draft"))
        }
    }
}
