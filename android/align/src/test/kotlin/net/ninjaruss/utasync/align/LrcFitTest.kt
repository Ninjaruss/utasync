package net.ninjaruss.utasync.align

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LrcFitTest {
    @Test fun `a sheet that fits inside the audio raises nothing`() {
        assertNull(pastEndLines(listOf(0L, 12_000L, 230_000L), audioDurationMs = 233_570L))
    }

    @Test fun `a line starting after the audio ends is reported with its time`() {
        val past = pastEndLines(listOf(0L, 12_000L, 237_000L), audioDurationMs = 233_570L)
        assertEquals(PastEnd(count = 1, firstStartMs = 237_000L, audioDurationMs = 233_570L), past)
    }

    @Test fun `every line past the end is counted and the earliest one named`() {
        val past = pastEndLines(listOf(234_000L, 300_000L, 240_000L), audioDurationMs = 233_570L)
        assertEquals(3, past?.count)
        assertEquals(234_000L, past?.firstStartMs)
    }

    @Test fun `a line starting exactly at the last millisecond is not past the end`() {
        assertNull(pastEndLines(listOf(233_570L), audioDurationMs = 233_570L))
    }

    @Test fun `with no duration there is nothing to compare`() {
        assertNull(pastEndLines(listOf(900_000L), audioDurationMs = null))
        assertNull(pastEndLines(listOf(900_000L), audioDurationMs = 0L))
    }

    @Test fun `with no lines there is nothing to compare`() {
        assertNull(pastEndLines(emptyList(), audioDurationMs = 233_570L))
    }

    /** A TV-size record (90 s) against a full track: most of the sheet lands past the end. */
    @Test fun `a sheet for a much longer cut puts most lines past the end`() {
        val starts = (0 until 40).map { it * 6_000L }
        val past = pastEndLines(starts, audioDurationMs = 90_000L)
        assertEquals(24, past?.count)
        assertEquals(90_000L + 6_000L, past?.firstStartMs)
    }
}
