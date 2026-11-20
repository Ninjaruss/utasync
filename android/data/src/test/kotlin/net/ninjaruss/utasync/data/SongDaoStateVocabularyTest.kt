package net.ninjaruss.utasync.data

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Room's `@Query` SQL cannot reference a Kotlin constant, so [SongDao] spells two prepare states
 * inline. This reads the DAO's own source and checks every `prepareState = '…'` literal in it
 * against [PrepareState], which is the only way to notice a mistake SQL hides from the compiler:
 * `WHERE prepareState = 'fetchng'` would stop resetting interrupted lookups, and renaming a
 * constant's value without touching the SQL would break it the same way. Nothing else complains.
 */
class SongDaoStateVocabularyTest {
    private val relative = "data/src/main/kotlin/net/ninjaruss/utasync/data/SongDao.kt"

    /** The unit-test working directory is not contractual, so look for the file from here up. */
    private fun daoSource(): File? = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, relative) }
        .firstOrNull { it.isFile }

    @Test fun `every prepare state spelled in the DAO's SQL is one of the constants`() {
        val source = daoSource()
        assertTrue("$relative not found from ${File("").absolutePath}", source != null)
        val literals = Regex("""prepareState\s*=\s*'([^']*)'""")
            .findAll(source!!.readText())
            .map { it.groupValues[1] }
            .toList()
        // Both sides of the one UPDATE, in order, compared against the constants themselves: a
        // typo in the SQL fails here, and so does changing a constant's value and not the SQL.
        assertEquals(listOf(PrepareState.PENDING, PrepareState.FETCHING), literals)
    }
}
