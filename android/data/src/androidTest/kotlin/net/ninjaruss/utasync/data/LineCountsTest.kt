package net.ninjaruss.utasync.data

import android.content.Context
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [SongDao.observeLineCounts] is pure SQL, so it is tested against a real Room database. It must
 * apply the same rule as [resolveStarts]: a line is timed when it has a computed start OR an
 * anchor, so the library and the player cannot disagree about a song.
 */
class LineCountsTest {
    private fun withDao(block: suspend (SongDao) -> Unit) = runBlocking {
        val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.inMemoryDatabaseBuilder(context, UtasyncDatabase::class.java).build()
        try { block(db.songDao()) } finally { db.close() }
    }

    private suspend fun SongDao.newSong() =
        insertSong(SongEntity(title = "t", audioUri = "content://x", createdAtMs = 0))

    /** The library's mapping: an absent row means 0/0. */
    private suspend fun SongDao.countsFor(id: Long): Pair<Int, Int> {
        val c = observeLineCounts().first().firstOrNull { it.songId == id }
        return (c?.total ?: 0) to (c?.timed ?: 0)
    }

    @Test fun aSongTimedOnlyByPinsReadsAsFullyTimed() = withDao { dao ->
        val id = dao.newSong()
        dao.replaceLines(id, (0..3).map { LineEntity(id, it, "l$it", null, null) })
        (0..3).forEach { dao.upsertUser(AnchorEntity(id, it, 1_000L * (it + 1), "user")) }

        assertEquals(4 to 4, dao.countsFor(id))
    }

    @Test fun aPartlyPinnedSongCountsTheUnionOfComputedStartsAndPins() = withDao { dao ->
        val id = dao.newSong()
        dao.replaceLines(
            id,
            listOf(
                LineEntity(id, 0, "l0", 1_000, null),   // computed only
                LineEntity(id, 1, "l1", null, null),    // pin only
                LineEntity(id, 2, "l2", null, null),    // neither
                LineEntity(id, 3, "l3", 4_000, null),   // computed AND pinned: counted once
                LineEntity(id, 4, "l4", null, null),    // neither
            ),
        )
        dao.upsertUser(AnchorEntity(id, 1, 2_000, "user"))
        dao.upsertUser(AnchorEntity(id, 3, 4_100, "user"))

        assertEquals(5 to 3, dao.countsFor(id))
    }

    @Test fun anotherSongsPinsDoNotLeakIn() = withDao { dao ->
        val a = dao.newSong()
        val b = dao.newSong()
        dao.replaceLines(a, listOf(LineEntity(a, 0, "l0", null, null)))
        dao.replaceLines(b, listOf(LineEntity(b, 0, "l0", null, null)))
        dao.upsertUser(AnchorEntity(b, 0, 1_000, "user"))

        assertEquals(1 to 0, dao.countsFor(a))
        assertEquals(1 to 1, dao.countsFor(b))
    }

    @Test fun aSongWithNoLinesCountsAsZeroUnderTheLibrariesMapping() = withDao { dao ->
        val empty = dao.newSong()
        val other = dao.newSong()
        dao.replaceLines(other, listOf(LineEntity(other, 0, "l0", 1_000, null)))

        // Whether the query emits a 0/0 row or no row, the library must see 0/0, and the song with
        // lines must not be disturbed by the empty one.
        assertEquals(0 to 0, dao.countsFor(empty))
        assertEquals(1 to 1, dao.countsFor(other))
    }
}
