package net.ninjaruss.utasync.align

import org.junit.Assert.assertEquals
import org.junit.Test

class LrcWriterTest {
    @Test fun `a timed line is written as mm ss xx`() {
        assertEquals("[00:12.34]alpha", writeLrc(listOf(12_340L to "alpha")).text)
    }

    @Test fun `an hour-long position does not overflow the minutes field`() {
        assertEquals("[62:03.00]alpha", writeLrc(listOf(3_723_000L to "alpha")).text)
    }

    @Test fun `rounding is to the nearest centisecond`() {
        assertEquals("[00:12.35]a", writeLrc(listOf(12_345L to "a")).text)
        assertEquals("[00:12.34]a", writeLrc(listOf(12_344L to "a")).text)
        // The carry crosses the second and minute boundaries: 59_996 ms is 60.00 s.
        assertEquals("[01:00.00]a", writeLrc(listOf(59_996L to "a")).text)
    }

    @Test fun `untimed lines are left out and counted`() {
        val out = writeLrc(listOf(1_000L to "a", null to "b", 2_000L to "c", null to "d"))
        assertEquals("[00:01.00]a\n[00:02.00]c", out.text)
        assertEquals(2, out.droppedLines)
    }

    @Test fun `rows are written in the order given, not re-sorted`() {
        val out = writeLrc(listOf(5_000L to "late", 1_000L to "early"))
        assertEquals("[00:05.00]late\n[00:01.00]early", out.text)
    }

    @Test fun `an empty list writes an empty string and drops nothing`() {
        assertEquals(LrcExport("", 0), writeLrc(emptyList()))
    }

    // Minutes, seconds and centiseconds are all different digits, so a transposed field
    // changes the parsed time; 12_346 is not centisecond-exact, so truncating instead of
    // rounding would parse back as 12_340 rather than 12_350.
    @Test fun `the round trip through parseLrc returns the same times and text`() {
        val rows = listOf(
            12_346L to "alpha",
            754_320L to "beta gamma",
            3_723_450L to "delta",
        )
        val parsed = parseLrc(writeLrc(rows).text)
        assertEquals(listOf(12_350L, 754_320L, 3_723_450L), parsed.map { Math.round(it.timeSec * 1000) })
        assertEquals(rows.map { it.second }, parsed.map { it.text })
    }
}
