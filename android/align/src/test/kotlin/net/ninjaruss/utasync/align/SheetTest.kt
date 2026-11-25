package net.ninjaruss.utasync.align

import org.junit.Test
import org.junit.Assert.assertEquals

class SheetTest {
    @Test fun `synced lyrics with time tags are Timed`() {
        val sheet = sheetFrom(synced = "[00:01.00]one\n[00:02.50]two", plain = "one\ntwo", instrumental = false)
        assertEquals(Sheet.Timed(listOf(LrcLine(1.0, "one"), LrcLine(2.5, "two"))), sheet)
    }

    @Test fun `plain lyrics alone are Untimed`() {
        assertEquals(Sheet.Untimed(listOf("one", "two")), sheetFrom(synced = null, plain = "one\ntwo", instrumental = false))
    }

    // LRCLIB can serve untagged text in the synced field. The inputs are identical, so only
    // the result type (Untimed, not Timed) proves the fallback happened.
    @Test fun `a synced block with no time tags falls back to the plain lyrics`() {
        assertEquals(Sheet.Untimed(listOf("one", "two")), sheetFrom(synced = "one\ntwo", plain = "one\ntwo", instrumental = false))
    }

    @Test fun `a synced block with no time tags and no plain lyrics is None`() {
        assertEquals(Sheet.None, sheetFrom(synced = "one\ntwo", plain = null, instrumental = false))
        assertEquals(Sheet.None, sheetFrom(synced = "one\ntwo", plain = "  \n ", instrumental = false))
    }

    // An instrumental record must never read as a find. Valid lyric values are passed on
    // purpose: null fields would return None even if the flag were ignored.
    @Test fun `an instrumental is None even if a lyric field is non-null`() {
        assertEquals(Sheet.None, sheetFrom(synced = "[00:01.00]one", plain = "one", instrumental = true))
    }

    @Test fun `a synced field with only metadata tags or empty rows falls back to the plain lyrics`() {
        assertEquals(Sheet.Untimed(listOf("one", "two")), sheetFrom(synced = "[ar:x]\n[ti:y]", plain = "one\ntwo", instrumental = false))
        assertEquals(Sheet.Untimed(listOf("one", "two")), sheetFrom(synced = "[00:01.00]\n[00:02.00]  ", plain = "one\ntwo", instrumental = false))
    }

    @Test fun `untagged lines in a synced block are dropped, not recovered from the plain lyrics`() {
        val sheet = sheetFrom(synced = "[00:01.00]one\nuntagged\n[00:03.00]two", plain = "one\nuntagged\ntwo", instrumental = false)
        assertEquals(Sheet.Timed(listOf(LrcLine(1.0, "one"), LrcLine(3.0, "two"))), sheet)
    }

    @Test fun `both null is None`() {
        assertEquals(Sheet.None, sheetFrom(synced = null, plain = null, instrumental = false))
    }

    @Test fun `plain lyrics in a sheet are split like pasted lyrics`() {
        val text = " one \r\n\r\n two  words\n"
        assertEquals(Sheet.Untimed(splitPastedLyrics(text)), sheetFrom(synced = null, plain = text, instrumental = false))
    }

    @Test fun `pasted lyrics drop blank lines and trim each line`() {
        assertEquals(listOf("one", "two"), splitPastedLyrics("  one  \n\n   \n\ttwo\t\n"))
    }

    @Test fun `pasted lyrics accept CRLF`() {
        assertEquals(listOf("one", "two"), splitPastedLyrics("one\r\n\r\ntwo\r\n"))
    }

    @Test fun `pasted lyrics keep interior spacing inside a line`() {
        assertEquals(listOf("one  two   three"), splitPastedLyrics("  one  two   three "))
    }

    @Test fun `pasting only whitespace yields no lines`() {
        assertEquals(emptyList<String>(), splitPastedLyrics(" \n\t\r\n  "))
    }
}
