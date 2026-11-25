package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.align.PastEnd
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LrcFitWordingTest {
    @Test fun `one line past the end is not pluralised`() {
        val text = pastEndWarning(PastEnd(1, 237_000L, 233_570L))
        assertTrue(text.startsWith("1 line starts after this file ends"))
        assertTrue(text.contains("the first at 3:57"))
        assertTrue(text.contains("the file is 3:54 long"))
    }

    @Test fun `several lines past the end are counted`() {
        assertTrue(pastEndWarning(PastEnd(24, 96_000L, 90_000L)).startsWith("24 lines start after"))
    }

    /** The warning must not claim the fit was checked, nor promise a fix the app cannot make. */
    @Test fun `the warning claims no verification and offers no repair`() {
        val text = pastEndWarning(PastEnd(3, 240_000L, 233_570L)).lowercase()
        for (word in listOf("verified", "confirmed", "we checked", "fix", "re-align", "realign")) {
            assertFalse(word, text.contains(word))
        }
        assertTrue(text.contains("not to be trusted"))
    }

    @Test fun `a position past an hour keeps its minutes two digits`() {
        assertEquals("1:03:05", clock(3_785_000L))
        assertEquals("0:09", clock(9_000L))
        assertEquals("3:54", clock(233_570L))
    }

    @Test fun `an equal length says so rather than showing a zero`() {
        assertEquals("same length as your file", lengthComparison(234, 233_570L))
    }

    @Test fun `a small gap is given in seconds and a large one as a clock`() {
        assertEquals("8 s longer than your file", lengthComparison(242, 233_570L))
        assertEquals("25 s shorter than your file", lengthComparison(209, 233_570L))
        assertEquals("2:24 shorter than your file", lengthComparison(90, 233_570L))
    }

    @Test fun `without both lengths there is no comparison to make`() {
        assertNull(lengthComparison(null, 233_570L))
        assertNull(lengthComparison(234, null))
        assertNull(lengthComparison(0, 233_570L))
        assertNull(lengthComparison(234, 0L))
    }
}
