package net.ninjaruss.utasync.data

import android.content.Context
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Assert.assertTrue
import org.junit.Test

/** The non-negotiable guarantee, against a real Room database: replaceLines cannot unpin. */
class PinsSurviveReAlignmentTest {
    @Test fun aReAlignmentDoesNotChangeAnAnchoredLine() = runBlocking {
        val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.inMemoryDatabaseBuilder(context, UtasyncDatabase::class.java).build()
        try {
            val dao = db.songDao()
            val id = dao.insertSong(SongEntity(title = "t", audioUri = "content://x", createdAtMs = 0))
            fun lines(vararg ms: Long) = ms.mapIndexed { i, t -> LineEntity(id, i, "l$i", t, null) }
            dao.replaceLines(id, lines(1_000, 2_000, 3_000))
            dao.upsertUser(AnchorEntity(id, 1, 2_450, "user"))

            dao.replaceLines(id, lines(1_100, 2_300, 3_300))   // a re-alignment with new computed times

            val resolved = resolveStarts(dao.observeLines(id).first(), dao.anchors(id))
            assertEquals(listOf<Long?>(1_100, 2_450, 3_300), resolved)

            dao.replaceLines(id, lines(900))                    // a shorter re-imported sheet: no crash
            assertEquals(listOf<Long?>(900), resolveStarts(dao.observeLines(id).first(), dao.anchors(id)))
        } finally { db.close() }
    }

    @Test fun anAutoWriteCannotReplaceAUserPin() = runBlocking {
        val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.inMemoryDatabaseBuilder(context, UtasyncDatabase::class.java).build()
        try {
            val dao = db.songDao()
            val id = dao.insertSong(SongEntity(title = "t", audioUri = "content://x", createdAtMs = 0))
            dao.replaceLines(id, listOf(LineEntity(id, 0, "l0", 1_000, null), LineEntity(id, 1, "l1", 2_000, null)))
            dao.upsertUser(AnchorEntity(id, 0, 1_234, "user"))

            assertFalse(dao.upsertAuto(AnchorEntity(id, 0, 9_999, "auto")))   // refused
            assertTrue(dao.upsertAuto(AnchorEntity(id, 1, 2_100, "auto")))    // free line: written
            assertTrue(dao.upsertAuto(AnchorEntity(id, 1, 2_200, "auto")))    // newer auto replaces auto

            val stored = dao.anchors(id)
            assertEquals(
                listOf(AnchorEntity(id, 0, 1_234, "user"), AnchorEntity(id, 1, 2_200, "auto")),
                stored.map { it.copy(writtenAtMs = 0) },
            )
            // Every stored row carries the write time the DAO stamped (R1: no migration needed later).
            assertTrue("writtenAtMs must be stamped: $stored", stored.all { it.writtenAtMs > 0 })
        } finally { db.close() }
    }

    /**
     * The guarantee's enforcement, not its documentation: the raw upsert is protected, so the only
     * doors are upsertUser and upsertAuto and each refuses the other's source. A future auto-timing
     * feature cannot reach past them to destroy a pin.
     */
    @Test fun eachDoorRefusesTheOtherSource() = runBlocking {
        val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.inMemoryDatabaseBuilder(context, UtasyncDatabase::class.java).build()
        try {
            val dao = db.songDao()
            val id = dao.insertSong(SongEntity(title = "t", audioUri = "content://x", createdAtMs = 0))
            dao.replaceLines(id, listOf(LineEntity(id, 0, "l0", 1_000, null)))
            try {
                dao.upsertUser(AnchorEntity(id, 0, 1_111, "auto"))
                fail("upsertUser must refuse an auto anchor")
            } catch (e: IllegalArgumentException) { /* expected */ }
            try {
                dao.upsertAuto(AnchorEntity(id, 0, 1_111, "user"))
                fail("upsertAuto must refuse a user anchor")
            } catch (e: IllegalArgumentException) { /* expected */ }
            assertTrue("neither refusal may write a row", dao.anchors(id).isEmpty())
        } finally { db.close() }
    }

    /** A pin can be removed as well as set: the undo half of the guarantee. */
    @Test fun clearingAPinRestoresTheComputedTimeAndTouchesNoOtherLine() = runBlocking {
        val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.inMemoryDatabaseBuilder(context, UtasyncDatabase::class.java).build()
        try {
            val dao = db.songDao()
            val id = dao.insertSong(SongEntity(title = "t", audioUri = "content://x", createdAtMs = 0))
            fun lines(vararg ms: Long) = ms.mapIndexed { i, t -> LineEntity(id, i, "l$i", t, null) }
            dao.replaceLines(id, lines(1_000, 2_000, 3_000))
            dao.upsertUser(AnchorEntity(id, 0, 1_500, "user"))
            dao.upsertUser(AnchorEntity(id, 1, 2_450, "user"))
            assertEquals(listOf<Long?>(1_500, 2_450, 3_000), resolveStarts(dao.observeLines(id).first(), dao.anchors(id)))

            dao.deleteAnchor(id, 1)

            assertEquals(listOf(0), dao.anchors(id).map { it.lineIndex })
            assertEquals(listOf<Long?>(1_500, 2_000, 3_000), resolveStarts(dao.observeLines(id).first(), dao.anchors(id)))
            dao.deleteAnchor(id, 1)                                  // clearing an unpinned line is a no-op
            assertEquals(listOf(0), dao.anchors(id).map { it.lineIndex })
        } finally { db.close() }
    }
}
