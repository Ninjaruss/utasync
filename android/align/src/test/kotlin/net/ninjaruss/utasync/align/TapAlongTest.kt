package net.ninjaruss.utasync.align

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TapAlongTest {
    private val gap = TapSession.DEBOUNCE_MS

    @Test fun tapsTimeLinesInOrder() {
        val s = TapSession(3)
        assertEquals(0, s.tap(1_000))
        assertEquals(1, s.tap(5_000))
        assertEquals(2, s.tap(9_500))
        assertEquals(listOf(0, 1, 2), s.taps.map { it.lineIndex })
        assertEquals(listOf(1.0, 5.0, 9.5), s.taps.map { it.timeSec })
        assertTrue(s.taps.all { it.source == AnchorSource.USER })
    }

    @Test fun aTapWithinTheDebounceWindowIsRejected() {
        val s = TapSession(3)
        assertEquals(0, s.tap(2_000))
        // A double-tap: the second must NOT consume line 1.
        assertNull(s.tap(2_120)) // a typical double-tap, 120 ms later (literal, not derived from the constant)
        assertNull(s.tap(2_000 + gap - 1))
        assertEquals(1, s.taps.size)
        // The next real tap still times line 1, not line 2.
        assertEquals(1, s.tap(6_000))
        assertEquals(listOf(0, 1), s.taps.map { it.lineIndex })
        // Exactly at the window edge is accepted.
        assertEquals(2, s.tap(6_000 + gap))
    }

    @Test fun tapsNeverGoBackwards() {
        val s = TapSession(3)
        assertEquals(0, s.tap(5_000))
        assertNull(s.tap(4_000))
        assertEquals(1, s.taps.size)
        assertEquals(1, s.tap(8_000))
    }

    @Test fun tappingPastTheLastLineIsRejected() {
        val s = TapSession(2)
        s.tap(1_000); s.tap(4_000)
        assertNull(s.tap(9_000))
        assertEquals(2, s.taps.size)
        assertNull(TapSession(0).tap(1_000))
    }

    @Test fun undoRemovesOnlyTheLastTap() {
        val s = TapSession(4)
        s.tap(1_000); s.tap(4_000); s.tap(8_000)
        s.undoLast()
        assertEquals(listOf(0, 1), s.taps.map { it.lineIndex })
        assertEquals(listOf(1.0, 4.0), s.taps.map { it.timeSec })
        // The freed line is tapped again, and may be earlier than the undone tap.
        assertEquals(2, s.tap(6_000))
        // Undo on an empty session is a no-op.
        val e = TapSession(2); e.undoLast(); assertTrue(e.taps.isEmpty())
    }
}
