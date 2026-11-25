package net.ninjaruss.utasync.data

import android.content.Context
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [SongDao.clearAnchorsForReplacedSheet] is a whole-song delete, so its scoping is verified by
 * executing the SQL against a real Room database: a mis-scoped WHERE must fail here.
 */
class ClearAnchorsTest {
    private fun withDao(block: suspend (SongDao) -> Unit) = runBlocking {
        val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.inMemoryDatabaseBuilder(context, UtasyncDatabase::class.java).build()
        try { block(db.songDao()) } finally { db.close() }
    }

    private suspend fun SongDao.newSong() =
        insertSong(SongEntity(title = "t", audioUri = "content://x", createdAtMs = 0))

    @Test fun clearingOneSongsPinsLeavesAnotherSongsUntouched() = withDao { dao ->
        val a = dao.newSong()
        val b = dao.newSong()
        listOf(a, b).forEach { id ->
            dao.replaceLines(id, (0..2).map { LineEntity(id, it, "l$it", null, null) })
            (0..2).forEach { dao.upsertUser(AnchorEntity(id, it, 1_000L * (it + 1), "user")) }
        }

        dao.clearAnchorsForReplacedSheet(a)

        assertTrue(dao.anchors(a).isEmpty())
        assertEquals(listOf(0, 1, 2), dao.anchors(b).map { it.lineIndex })
        assertTrue(dao.anchors(b).all { it.source == "user" })
    }

    @Test fun replaceSheetClearingAnchorsReplacesLinesAndClearsOnlyThisSongsPins() = withDao { dao ->
        val a = dao.newSong()
        val b = dao.newSong()
        listOf(a, b).forEach { id ->
            dao.replaceLines(id, (0..2).map { LineEntity(id, it, "l$it", null, null) })
            dao.upsertUser(AnchorEntity(id, 1, 2_000, "user"))
        }

        dao.replaceSheetClearingAnchors(a, listOf(LineEntity(a, 0, "new", null, null)))

        assertTrue(dao.anchors(a).isEmpty())
        assertEquals(listOf("new"), dao.observeLines(a).first().map { it.text })
        assertEquals(listOf(1), dao.anchors(b).map { it.lineIndex })
        assertEquals(3, dao.observeLines(b).first().size)
    }
}
