package net.ninjaruss.utasync.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/** Pins the shared warning to the exact text TapAlongScreen showed before it was extracted. */
class HandTimedWordingTest {
    @Test fun `the singular warning keeps its original text`() {
        assertEquals("Replace 1 hand-timed line?", replaceHandTimedTitle(1))
        assertEquals("1 line you placed by hand", handPlacedLines(1))
        assertEquals("That cannot be undone; the hand-placed time will be gone.", handTimedLossNote(1))
    }

    @Test fun `the plural warning keeps its original text`() {
        assertEquals("Replace 3 hand-timed lines?", replaceHandTimedTitle(3))
        assertEquals("3 lines you placed by hand", handPlacedLines(3))
        assertEquals("That cannot be undone; the hand-placed times will be gone.", handTimedLossNote(3))
    }
}
