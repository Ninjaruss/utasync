package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.playback.Scrubber
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeTime : Scrubber.Timer {
    var now = 0L
    private class Task(val at: Long, val run: () -> Unit) { var cancelled = false }
    private val tasks = mutableListOf<Task>()
    override fun nowMs() = now
    override fun postDelayed(delayMs: Long, run: () -> Unit): () -> Unit {
        val t = Task(now + delayMs, run); tasks += t; return { t.cancelled = true }
    }
    fun advance(ms: Long) {
        val target = now + ms
        while (true) {
            val next = tasks.filter { !it.cancelled && it.at <= target }.minByOrNull { it.at } ?: break
            tasks.remove(next); now = next.at; next.run()
        }
        now = target
    }
}

private class FakePlayer(override var isPlaying: Boolean) : PreviewPlayer {
    var position = -1L
    override fun play() { isPlaying = true }
    override fun pause() { isPlaying = false }
    override fun seekTo(positionMs: Long) { position = positionMs }
}

class ScrubAudioTest {
    private val time = FakeTime()
    private fun rig(playing: Boolean): Pair<FakePlayer, ScrubAudio> {
        val p = FakePlayer(playing)
        return p to ScrubAudio(p, Scrubber(p::seekTo, time), time)
    }

    @Test fun draggingAPausedPlayerMakesSound() {
        val (p, a) = rig(playing = false)
        a.begin(); a.move(1_000)
        assertTrue(p.isPlaying)
        assertEquals(1_000L, p.position)
    }

    @Test fun releaseRestoresPausedAndSeeksToTheFingersOwnPosition() {
        val (p, a) = rig(playing = false)
        a.begin()
        a.move(1_000)          // seeks at once
        time.advance(10)
        a.move(1_040)          // held inside the 60 ms window: the player never sees it
        assertEquals(1_000L, p.position)
        a.release(1_040)
        assertEquals(1_040L, p.position) // not the player's lagging 1000
        assertFalse(p.isPlaying)
    }

    @Test fun releaseLeavesAPlayingPlayerPlaying() {
        val (p, a) = rig(playing = true)
        a.begin(); a.move(2_000); a.release(2_100)
        assertTrue(p.isPlaying)
        assertEquals(2_100L, p.position)
    }

    @Test fun aHeldFingerPausesThenResumesOnMovement() {
        val (p, a) = rig(playing = false)
        a.begin(); a.move(1_000)
        time.advance(ScrubAudio.IDLE_PAUSE_MS + 1)
        assertFalse(p.isPlaying) // does not run away from a stationary thumb
        a.move(1_500)
        assertTrue(p.isPlaying)
    }

    @Test fun aFineStepSoundsBrieflyThenRestores() {
        val (p, a) = rig(playing = false)
        a.preview(5_100)
        assertTrue(p.isPlaying)
        assertEquals(5_100L, p.position)
        time.advance(ScrubAudio.IDLE_PAUSE_MS + 1)
        assertFalse(p.isPlaying)
    }

    @Test fun abandonMidDragRestoresThePlayer() {
        val (p, a) = rig(playing = false)
        a.begin(); a.move(1_000)
        a.abandon()
        assertFalse(p.isPlaying)
    }
}
