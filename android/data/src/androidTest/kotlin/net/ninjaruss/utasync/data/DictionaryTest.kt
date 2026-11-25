package net.ninjaruss.utasync.data

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Against the REAL shipped seed (`createFromAsset`), not an in-memory database, because the
 * failure this guards is the asset and the schema disagreeing — Room throws on open when they do.
 * The words used are ones the vendored data is known to hold with two readings.
 */
class DictionaryTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "dictionary-test.db"
    private lateinit var db: UtasyncDatabase

    @Before fun open() {
        context.deleteDatabase(name)
        db = UtasyncDatabase.seedBuilder(context, name).build()
    }

    @After fun close() {
        db.close()
        context.deleteDatabase(name)
    }

    private fun dao() = db.dictionaryDao()

    @Test fun aSurfaceWithTwoReadingsReturnsBothRows() = runBlocking {
        val rows = dao().entriesFor("明白")
        assertEquals(setOf("めいはく", "あからさま"), rows.map { it.reading }.toSet())
        assertEquals(listOf(0, 1), rows.map { it.senseIndex })
    }

    @Test fun aLookupBySurfaceAndReadingReturnsOnlyThatReadingGlossesAsAList() = runBlocking {
        val rows = dao().entriesFor("明白", "めいはく")
        assertEquals(1, rows.size)
        assertEquals("めいはく", rows.single().reading)
        assertEquals(listOf("obvious", "clear", "plain"), rows.single().glosses)
    }

    @Test fun aReadingWithTwoSenseGroupsReturnsBothInDisplayOrder() = runBlocking {
        val rows = dao().entriesFor("私", "わたくし")
        assertTrue(rows.size >= 2)
        assertEquals(rows.map { it.senseIndex }.sorted(), rows.map { it.senseIndex })
        assertTrue(rows.all { it.reading == "わたくし" })
    }

    @Test fun aWordTheDictionaryDoesNotHoldReturnsNothingRatherThanThrowing() = runBlocking {
        assertEquals(emptyList<DictionaryEntity>(), dao().entriesFor("zzz-not-a-word"))
        assertEquals(emptyList<DictionaryEntity>(), dao().entriesFor("明白", "ぜったいにない"))
    }

    @Test fun theSeedAlsoOpensTheSongTablesEmpty() = runBlocking {
        val id = db.songDao().insertSong(SongEntity(title = "t", audioUri = "content://x", createdAtMs = 0))
        assertTrue(id > 0)
    }
}
