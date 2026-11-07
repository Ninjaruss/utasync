package net.ninjaruss.utasync.align

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Lyric text here is invented placeholder text, never real song lyrics (ADR-0004).
class LrcTest {
    @Test
    fun parsesTimesMetadataAndBlankRows() {
        val rows = parseLrc(
            """
            [ar:Someone]
            [00:01.50]first line
            [00:04.25]
            [00:06.000]second line
            """.trimIndent(),
        )
        assertEquals(listOf(LrcLine(1.5, "first line"), LrcLine(6.0, "second line")), rows)
    }

    @Test
    fun expandsRepeatedTimeTagsAndSorts() {
        val rows = parseLrc("[00:30.00][00:10.00]chorus\n[00:20.00]verse")
        assertEquals(listOf(10.0, 20.0, 30.0), rows.map { it.timeSec })
        assertEquals("chorus", rows[0].text)
    }

    @Test
    fun appliesOffsetTagAndStripsWordTags() {
        val rows = parseLrc("[offset:+500]\n[00:02.00]<00:02.00>hello <00:02.40>there")
        assertEquals(1, rows.size)
        assertEquals(1.5, rows[0].timeSec, 1e-9)
        assertEquals("hello there", rows[0].text)
    }
}

class SheetMatchTest {
    @Test
    fun matchesMonotonicallyAndLeavesUnmatchedLinesNull() {
        val rows = listOf(LrcLine(1.0, "alpha beta gamma"), LrcLine(5.0, "delta epsilon"), LrcLine(9.0, "zeta eta theta"))
        val sheet = listOf("Alpha, beta gamma!", "something unrelated", "zeta eta theta")
        val matched = matchSheetToLrc(sheet, rows)
        assertEquals(listOf(1.0, null, 9.0), matched)
        assertNull(matched[1])
    }

    @Test
    fun normalisesFullWidthAndPunctuation() {
        assertEquals(1.0, bigramSimilarity("ＡＢＣ　ｄｅｆ。", "abc def"), 1e-9)
    }
}

class WindowsTest {
    @Test
    fun interpolatesGapsInThePrior() {
        val filled = fillPrior(listOf(10.0, null, 20.0, null), durationSec = 60.0)
        assertEquals(15.0, filled[1], 1e-9)
        assertEquals(23.0, filled[3], 1e-9) // end gap: fixed 3 s spacing
    }

    @Test
    fun windowsSpanNeighboursAndComeOnlyFromThePrior() {
        val prior = doubleArrayOf(10.0, 14.0, 18.0, 22.0)
        val w = planWindows(prior, durationSec = 60.0)
        assertEquals(AlignWindow(1, 9.0, 22.5, 0, 2), w[1])
        assertEquals(1, w[1].position)
        assertEquals(0, w[0].position) // first line has no previous context
        assertTrue(w.all { it.endSec - it.startSec <= 30.0 })
    }

    @Test
    fun longGapsDropThePreviousLineAndClampTo30Seconds() {
        val prior = doubleArrayOf(0.0, 40.0, 44.0, 48.0)
        val w = planWindows(prior, durationSec = 120.0)[1]
        assertEquals(1, w.contextFrom)
        assertEquals(37.0, w.startSec, 1e-9)
        assertTrue(w.endSec - w.startSec <= 30.0)
    }

    @Test(expected = IllegalArgumentException::class)
    fun refusesAPriorWithFewerThanTwoKnownLines() {
        fillPrior(listOf(null, 3.0, null), durationSec = 10.0)
    }
}

class AnchorsTest {
    @Test
    fun anchoredLinesTakeTheAnchorTimeAndOrderedLinesStay() {
        val out = applyAnchors(listOf(1.0, 2.0, 3.0, 4.0), listOf(TimingAnchor(2, 3.4)))
        assertEquals(listOf(1.0, 2.0, 3.4, 4.0), out)
    }

    @Test
    fun linesThatBreakOrderBetweenAnchorsAreSpreadEvenly() {
        val out = applyAnchors(listOf(10.0, 30.0, 11.0, 12.0), listOf(TimingAnchor(0, 10.0), TimingAnchor(3, 13.0)))
        assertEquals(listOf(10.0, 11.0, 12.0, 13.0), out)
    }

    @Test
    fun userAnchorWinsOverAutoAnchorOnTheSameLine() {
        val out = applyAnchors(
            listOf(1.0, 2.0, 3.0),
            listOf(TimingAnchor(1, 2.5, AnchorSource.USER), TimingAnchor(1, 1.8, AnchorSource.AUTO)),
        )
        assertEquals(2.5, out[1], 1e-9)
    }

    @Test
    fun linesBeforeTheFirstAnchorArePushedEarlierNotDropped() {
        val out = applyAnchors(listOf(5.0, 6.0, 7.0), listOf(TimingAnchor(2, 5.5)))
        assertTrue(out[0] < out[1] && out[1] < out[2])
        assertEquals(5.5, out[2], 1e-9)
    }
}

class LineClockTest {
    @Test
    fun picksTheLastLineStartedAtOrBeforeThePosition() {
        val starts = listOf(1_000L, 3_000L, 5_000L)
        assertEquals(-1, activeLineIndex(starts, 999))
        assertEquals(0, activeLineIndex(starts, 1_000))
        assertEquals(1, activeLineIndex(starts, 4_999))
        assertEquals(2, activeLineIndex(starts, 60_000))
    }

    @Test
    fun untimedLinesAreNeverActive() {
        assertEquals(-1, activeLineIndex(listOf(null, null, null), 10_000))
        val mixed = listOf(1_000L, null, 5_000L, null, 9_000L)
        assertEquals(0, activeLineIndex(mixed, 4_000))
        assertEquals(2, activeLineIndex(mixed, 8_999))
        assertEquals(4, activeLineIndex(mixed, 9_000))
    }

    @Test
    fun matchesALinearScanOnRandomInputs() {
        val rnd = java.util.Random(7)
        repeat(500) {
            var t = 0L
            val starts = List(rnd.nextInt(12)) { if (rnd.nextInt(4) == 0) null else { t += rnd.nextInt(3000); t } }
            val pos = rnd.nextInt(40_000).toLong()
            val expected = starts.indices.lastOrNull { starts[it] != null && starts[it]!! <= pos } ?: -1
            assertEquals(expected, activeLineIndex(starts, pos))
        }
    }
}
