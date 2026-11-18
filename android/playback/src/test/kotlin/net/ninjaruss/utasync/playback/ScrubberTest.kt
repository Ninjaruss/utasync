package net.ninjaruss.utasync.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Deterministic clock + scheduler so no test sleeps and none touches a real player. */
private class FakeTime : Scrubber.Timer {
    var now = 0L
    private class Task(val at: Long, val run: () -> Unit) { var cancelled = false }
    private val tasks = mutableListOf<Task>()

    override fun nowMs() = now
    override fun postDelayed(delayMs: Long, run: () -> Unit): () -> Unit {
        val t = Task(now + delayMs, run)
        tasks += t
        return { t.cancelled = true }
    }

    fun advance(ms: Long) {
        val target = now + ms
        while (true) {
            val next = tasks.filter { !it.cancelled && it.at <= target }.minByOrNull { it.at } ?: break
            tasks.remove(next)
            now = next.at
            next.run()
        }
        now = target
    }
}

class ScrubberTest {
    private val time = FakeTime()
    private val seeks = mutableListOf<Long>()
    private val scrubber = Scrubber({ seeks += it }, time)
    private val w = Scrubber.COALESCE_WINDOW_MS

    @Test fun rapidScrubsCollapseToAtMostOneSeekPerWindow() {
        for (i in 1..100) scrubber.scrubTo(i * 10L)
        // Positive control: a seek DID happen (the drag is audible at once)...
        assertEquals(1, seeks.size)
        // ...and the other 99 events were held back, not seeked.
        time.advance(w - 1)
        assertEquals(1, seeks.size)
        time.advance(1)
        assertEquals(2, seeks.size) // the trailing flush for the next window
    }

    @Test fun lastPositionAlwaysWins() {
        for (i in 1..100) scrubber.scrubTo(i * 10L)
        time.advance(w)
        assertEquals(1000L, seeks.last())
        assertTrue(seeks.size >= 2)
    }

    @Test fun stopEndsScrubbingWithoutSeeking() {
        scrubber.scrubTo(100)
        scrubber.scrubTo(200) // pending, would flush at window end
        assertEquals(listOf(100L), seeks)
        scrubber.stop()
        time.advance(w * 10)
        assertEquals(listOf(100L), seeks) // no trailing seek after the finger lifts
        scrubber.scrubTo(300) // a new drag starts cleanly
        assertEquals(listOf(100L, 300L), seeks)
    }
}
