package ai.ichiflow.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CoreTest {
    @Test
    fun banner_reports_name_and_version() {
        assertEquals("ichiflow-core 0.0.0", Core.banner())
    }

    @Test
    fun name_is_stable() {
        assertTrue(Core.NAME.startsWith("ichiflow"))
    }
}
