package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.data.LineEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The words sheet holds the line it was opened on.
 *
 * The defect this pins: the sheet used to be `showingWords: Boolean` over the **active** line, so
 * three seconds into reading it the song moved on and the sheet re-filled itself with the next
 * line's words -- or closed, at an instrumental break, where there is no active line at all.
 * Invented text only (CLAUDE.md rule 6).
 */
class SheetLineTest {
    private fun line(index: Int, text: String) =
        LineEntity(songId = 1, lineIndex = index, text = text, startMs = null, endMs = null)

    private val song = listOf(line(0, "そらはあおい"), line(1, "かぜがふく"), line(2, "よるがくる"))

    @Test fun `the captured line is returned whatever the playhead is doing`() {
        // sheetLineFor takes no playhead and no active index: there is no parameter the song's
        // position could arrive through, which is the fix.
        assertEquals(song[1], sheetLineFor(1, song))
    }

    @Test fun `nothing captured shows no sheet`() {
        assertNull(sheetLineFor(null, song))
    }

    @Test fun `a line gone from the song closes the sheet rather than showing a stale one`() {
        // The lyric sheet was replaced while the words sheet was open: index 2 is no longer there.
        assertNull(sheetLineFor(2, song.take(2)))
        assertNull(sheetLineFor(0, emptyList()))
    }

    @Test fun `the line is found by its own index, not by its position in the list`() {
        // Lines arrive ordered by lineIndex, but a song whose first lines were dropped does not
        // start at 0, and taking lines[captured] would then show the wrong line's words.
        val tail = song.drop(1)
        assertEquals("かぜがふく", sheetLineFor(1, tail)?.text)
        assertEquals("よるがくる", sheetLineFor(2, tail)?.text)
    }
}
