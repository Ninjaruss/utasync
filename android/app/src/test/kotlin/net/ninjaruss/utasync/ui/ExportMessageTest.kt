package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.align.LrcExport
import net.ninjaruss.utasync.align.writeLrc
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Placeholder words only, never lyric text (rule 6 / ADR-0004). */
class ExportMessageTest {
    @Test fun `an export with nothing in it never claims a file was written`() {
        // Every line untimed: writeLrc drops them all and the text is empty.
        val export = writeLrc(listOf(null to "one", null to "two"))
        assertEquals("", export.text)
        val message = exportMessage(export, writeFailed = false)
        assertFalse(message, message.contains("Exported"))
        assertTrue(message, message.contains("nothing was written"))
    }

    @Test fun `one dropped line is singular and more than one is plural`() {
        assertTrue(exportMessage(LrcExport("[00:01.00]one", 1), false).contains("1 untimed line was"))
        assertTrue(exportMessage(LrcExport("[00:01.00]one", 2), false).contains("2 untimed lines were"))
    }

    @Test fun `a full export says so, and a failed write says that instead`() {
        assertEquals("Exported", exportMessage(LrcExport("[00:01.00]one", 0), writeFailed = false))
        val failed = exportMessage(LrcExport("[00:01.00]one", 0), writeFailed = true)
        assertFalse(failed, failed.contains("Exported"))
    }

    @Test fun `no two outcomes share a message`() {
        // Derived from the outcomes the function distinguishes, so a merged branch fails here.
        val messages = listOf(
            exportMessage(LrcExport("", 2), false),
            exportMessage(LrcExport("x", 0), true),
            exportMessage(LrcExport("x", 1), false),
            exportMessage(LrcExport("x", 2), false),
            exportMessage(LrcExport("x", 0), false),
        )
        assertEquals(messages.size, messages.distinct().size)
    }
}
