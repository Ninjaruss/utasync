package net.ninjaruss.utasync.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RepeatRangeTest {
    private val duration = 60_000L

    @Test fun rangeRunsToTheNextLineStart() {
        val r = repeatRange(listOf(1_000L, 4_000L, 9_000L), 0, duration)
        assertEquals(1_000L, r.first)
        assertEquals(4_000L, r.last)
        val r1 = repeatRange(listOf(1_000L, 4_000L, 9_000L), 1, duration)
        assertEquals(4_000L..9_000L, r1)
    }

    @Test fun lastLineRunsToTheEndOfTheAudio() {
        // Not to the line's own start, and not to some made-up tail: the audio duration.
        assertEquals(9_000L..duration, repeatRange(listOf(1_000L, 4_000L, 9_000L), 2, duration))
    }

    @Test fun aLineWithNullStartHasNoRange() {
        val r = repeatRange(listOf(1_000L, null, 9_000L), 1, duration)
        assertTrue(r.isEmpty())
        assertTrue(repeatRange(listOf(1_000L), 5, duration).isEmpty())  // out of range, no crash
        assertTrue(repeatRange(listOf(1_000L), -1, duration).isEmpty())
    }

    @Test fun aNullGapIsSkippedWhenFindingTheNextStart() {
        // Line 1 is untimed; line 0 must run to line 2's start, not stop at null or run to the end.
        assertEquals(1_000L..9_000L, repeatRange(listOf(1_000L, null, 9_000L, 12_000L), 0, duration))
        // Several nulls in a row, then trailing nulls: last timed line runs to the end.
        assertEquals(1_000L..9_000L, repeatRange(listOf(1_000L, null, null, 9_000L), 0, duration))
        assertEquals(9_000L..duration, repeatRange(listOf(1_000L, 9_000L, null, null), 1, duration))
    }

    @Test fun aHeldNoteLineRunsThroughTheSilenceToTheNextStart() {
        // Accepted cost of one timestamp per line (spec 7.1): a line ending on a long note before an
        // instrumental runs through that silence. Intended; do not "fix" by guessing an end.
        assertEquals(1_000L..30_000L, repeatRange(listOf(1_000L, 30_000L), 0, duration))
    }
}
