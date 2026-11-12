package net.ninjaruss.utasync.ui

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import net.ninjaruss.utasync.align.TimingAnchor
import net.ninjaruss.utasync.align.applyAnchors
import net.ninjaruss.utasync.data.AlignmentRunEntity
import net.ninjaruss.utasync.data.AnchorEntity
import net.ninjaruss.utasync.data.LineEntity
import net.ninjaruss.utasync.data.SongDao
import net.ninjaruss.utasync.data.SongEntity
import net.ninjaruss.utasync.playback.Envelope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NudgeStateTest {
    private val env = Envelope(200, FloatArray(200 * 30), 30_000)

    @Test fun dragSetsProposedTime() {
        val s = NudgeState(original = 10_000, neighbourBefore = 5_000, neighbourAfter = 20_000)
        s.drag(12_345)
        assertEquals(12_345L, s.proposedMs)
        assertFalse(s.isClamped)
    }

    @Test fun fineButtonsMoveByOneTenthSecond() {
        val s = NudgeState(10_000, 5_000, 20_000)
        s.fine(NudgeState.FINE_STEP_MS)
        assertEquals(10_100L, s.proposedMs)
        s.fine(-NudgeState.FINE_STEP_MS)
        s.fine(-NudgeState.FINE_STEP_MS)
        assertEquals(9_900L, s.proposedMs)
    }

    @Test fun dragIsClampedToNeighboursMinimumGap() {
        val s = NudgeState(10_000, neighbourBefore = 5_000, neighbourAfter = 20_000)
        s.drag(30_000)
        assertEquals(19_950L, s.proposedMs) // 0.05 s before the next line
        assertTrue(s.isClamped)
        s.drag(1_000)
        assertEquals(5_050L, s.proposedMs) // 0.05 s after the previous line
        assertTrue(s.isClamped)
        s.drag(12_000)
        assertFalse(s.isClamped)
    }

    @Test fun clampedTimeIsOneAlignLeavesAlone() {
        // The clamp must agree with applyAnchors' 0.05 s default: neighbours stay where they are.
        val computed = listOf(5.0, 10.0, 20.0)
        for (dragTo in listOf(0L, 30_000L)) {
            val s = NudgeState.forLine(computed.map { (it * 1000).toLong() }, 1)
            s.drag(dragTo)
            val out = applyAnchors(computed, listOf(TimingAnchor(1, s.proposedMs!! / 1000.0)))
            assertEquals(5.0, out[0], 1e-9)
            assertEquals(20.0, out[2], 1e-9)
            assertEquals(s.proposedMs!! / 1000.0, out[1], 1e-9)
        }
        assertEquals(50L, NudgeState.MIN_GAP_MS)
    }

    @Test fun aLineWithNoComputedTimeCanStillBeNudged() {
        val s = NudgeState(original = null, neighbourBefore = 5_000, neighbourAfter = 20_000)
        assertNull(s.proposedMs)
        assertFalse(s.canSave)
        s.fine(100) // nothing to move yet
        assertNull(s.proposedMs)
        s.drag(8_000)
        assertEquals(8_000L, s.proposedMs)
        assertTrue(s.canSave)
        assertEquals(AnchorEntity(1, 3, 8_000, "user"), s.toAnchor(1, 3))
    }

    @Test fun aLineWithNoNeighboursAtAllStillWorks() {
        val s = NudgeState.forLine(listOf(null, null, null), 1)
        s.drag(4_000)
        assertEquals(4_000L, s.proposedMs)
        s.drag(-500)
        assertEquals(0L, s.proposedMs)
        assertTrue(s.isClamped)
    }

    @Test fun originalIsPreservedForDisplayAfterDragging() {
        val s = NudgeState(10_000, 5_000, 20_000)
        s.drag(15_000)
        s.fine(100)
        assertEquals(10_000L, s.original)
        assertEquals(15_100L, s.proposedMs)
    }

    @Test fun neighboursSkipUntimedLines() {
        val s = NudgeState.forLine(listOf(1_000, null, 3_000, null, 9_000), 2)
        assertEquals(1_000L, s.neighbourBefore)
        assertEquals(9_000L, s.neighbourAfter)
    }

    @Test fun anUnreadableAudioUriShowsAMessageAndDisablesTheHandle() = runBlocking {
        val s = NudgeState(10_000, 5_000, 20_000)
        s.load { Result.failure(IOException("permission revoked")) }
        val w = s.waveform.value
        assertTrue(w is WaveformStatus.Failed)
        assertTrue((w as WaveformStatus.Failed).message.isNotBlank())
        assertFalse(s.handleEnabled)
        s.drag(12_000)
        s.fine(100)
        assertEquals(10_000L, s.proposedMs) // dead handle: nothing moved
    }

    @Test fun aSlowDecodeLeavesTheHandleUsableAndThenShowsTheWaveform() = runBlocking {
        val s = NudgeState(10_000, 5_000, 20_000)
        val gate = CompletableDeferred<Result<Envelope>>()
        val loading = async(start = CoroutineStart.UNDISPATCHED) { s.load { gate.await() } }
        assertEquals(WaveformStatus.Loading, s.waveform.value)
        assertTrue(s.handleEnabled)
        s.drag(12_000)
        assertEquals(12_000L, s.proposedMs) // usable while decoding
        gate.complete(Result.success(env))
        loading.await()
        assertEquals(WaveformStatus.Ready(env), s.waveform.value)
    }

    @Test fun leavingCancelsTheDecode() = runBlocking {
        val s = NudgeState(10_000, null, null)
        var cancelled = false
        val job = async(start = CoroutineStart.UNDISPATCHED) {
            s.load { try { CompletableDeferred<Result<Envelope>>().await() } finally { cancelled = true } }
        }
        yield()
        job.cancel()
        job.join()
        assertTrue(cancelled)
        assertEquals(WaveformStatus.Loading, s.waveform.value)
    }

    @Test fun dragPastTheEndOfTheSongIsClampedOnceDurationIsKnown() = runBlocking {
        val s = NudgeState(25_000, 20_000, null)
        s.load { Result.success(env) }
        s.drag(99_000)
        assertEquals(30_000L, s.proposedMs)
        assertTrue(s.isClamped)
    }

    @Test fun windowMapsPixelsToSongTimeAndBack() {
        val w = NudgeWindow.around(10_000, spanMs = 12_000)
        assertEquals(4_000L, w.startMs)
        assertEquals(10_000L, w.msAt(500f, 1000f))
        assertEquals(4_000L, w.msAt(-50f, 1000f))
        assertEquals(500f, w.xAt(10_000, 1000f), 1e-3f)
    }

    // ---- Step 5: saving moves exactly one line ----

    private class RecordingDao : SongDao() {
        val anchorWrites = mutableListOf<AnchorEntity>()
        val otherWrites = mutableListOf<String>()
        override fun observeSongs() = error("unused")
        override fun observeSong(id: Long) = error("unused")
        override suspend fun insertSong(song: SongEntity): Long { otherWrites += "insertSong"; return 0 }
        override fun observeLines(songId: Long) = error("unused")
        override suspend fun deleteLines(songId: Long) { otherWrites += "deleteLines" }
        override suspend fun insertLines(lines: List<LineEntity>) { otherWrites += "insertLines" }
        override suspend fun replaceLines(songId: Long, lines: List<LineEntity>) { otherWrites += "replaceLines" }
        override suspend fun anchors(songId: Long): List<AnchorEntity> = emptyList()
        override fun observeAnchors(songId: Long) = error("unused")
        override suspend fun anchorOn(songId: Long, lineIndex: Int): AnchorEntity? = null
        override suspend fun upsertAnchor(anchor: AnchorEntity) { anchorWrites += anchor }
        override suspend fun insertRun(run: AlignmentRunEntity): Long { otherWrites += "insertRun"; return 0 }
    }

    @Test fun savingANudgeWritesOneAnchorAndNoLine() = runBlocking {
        val dao = RecordingDao()
        val s = NudgeState(10_000, 5_000, 20_000)
        s.drag(12_000)
        s.save(dao, songId = 7, lineIndex = 4)
        assertEquals(listOf(AnchorEntity(7, 4, 12_000, "user")), dao.anchorWrites)
        assertTrue("no LineEntity or other row may be written: ${dao.otherWrites}", dao.otherWrites.isEmpty())
    }
}
