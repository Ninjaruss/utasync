package net.ninjaruss.utasync.japanese

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The shipped asset is `{ surface: [[common readings], [uncommon readings]] }`. The lookup a word
 * gets is the **union of both lists**: the split is common-versus-uncommon, not
 * primary-versus-alternates, and reading only the second list loses the rival reading of every
 * surface whose readings are all common. That error has been made once on this branch already.
 */
class ReadingAlternatesTest {
    private val relative = "japanese/src/main/assets/reading-alternates.json"

    /** The unit-test working directory is not contractual, so look for the asset from here up. */
    private fun asset(): File? = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, relative) }
        .firstOrNull { it.isFile }

    @Test fun `both sides of the split are one lookup`() {
        val parsed = parseReadingAlternates("""{"明白":[["めいはく"],["あからさま"]]}""")
        assertEquals(listOf("めいはく", "あからさま"), parsed.getValue("明白"))
    }

    @Test fun `a surface whose readings are all on one side keeps them`() {
        // Were only the uncommon list read, 行く would lose ゆく and 彼 would lose both.
        val parsed = parseReadingAlternates("""{"彼":[["あれ","かれ"],[]],"明かん":[[],["あかん","あかーん"]]}""")
        assertEquals(listOf("あれ", "かれ"), parsed.getValue("彼"))
        assertEquals(listOf("あかん", "あかーん"), parsed.getValue("明かん"))
    }

    @Test fun `a surface the file does not list has no alternates`() {
        val parsed = parseReadingAlternates("""{"明白":[["めいはく"],["あからさま"]]}""")
        assertEquals(emptyList<String>(), parsed["雨"].orEmpty())
    }

    @Test fun `every surface in the shipped asset parses to at least two readings`() {
        val file = asset()
        assertTrue("$relative not found from ${File("").absolutePath}", file != null)
        val parsed = parseReadingAlternates(file!!.readText())
        // Derived over the whole file: the builder keeps only surfaces read more than one way, so
        // a parse that dropped a side would show up here as a one-reading surface.
        assertTrue(parsed.size > 1000)
        val thin = parsed.entries.filter { it.value.size < 2 }.take(5)
        assertEquals("surfaces that lost a reading: $thin", emptyList<Any>(), thin)
        assertTrue(parsed.getValue("明白").containsAll(listOf("めいはく", "あからさま")))
        // Nothing is blank, and nothing is duplicated within a surface.
        assertTrue(parsed.values.none { rs -> rs.any { it.isBlank() } })
        assertTrue(parsed.entries.none { it.value.size != it.value.distinct().size })
    }
}
