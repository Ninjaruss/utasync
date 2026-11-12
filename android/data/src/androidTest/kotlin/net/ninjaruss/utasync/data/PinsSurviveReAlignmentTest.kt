package net.ninjaruss.utasync.data

import android.content.Context
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
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
            dao.upsertAnchor(AnchorEntity(id, 1, 2_450, "user"))

            dao.replaceLines(id, lines(1_100, 2_300, 3_300))   // a re-alignment with new computed times

            val resolved = resolveStarts(dao.observeLines(id).first(), dao.anchors(id))
            assertEquals(listOf<Long?>(1_100, 2_450, 3_300), resolved)

            dao.replaceLines(id, lines(900))                    // a shorter re-imported sheet: no crash
            assertEquals(listOf<Long?>(900), resolveStarts(dao.observeLines(id).first(), dao.anchors(id)))
        } finally { db.close() }
    }
}
