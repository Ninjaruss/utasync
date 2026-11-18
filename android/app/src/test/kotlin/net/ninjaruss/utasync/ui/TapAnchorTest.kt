package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.align.AnchorSource
import net.ninjaruss.utasync.align.TapSession
import org.junit.Assert.assertEquals
import org.junit.Test

class TapAnchorTest {
    @Test fun tapsBecomeUserAnchorsInMilliseconds() {
        val s = TapSession(2)
        s.tap(1_234); s.tap(5_007)
        val rows = s.taps.map { it.toEntity(9L) }
        assertEquals(listOf(1_234L, 5_007L), rows.map { it.timeMs })
        assertEquals(listOf(0, 1), rows.map { it.lineIndex })
        assertEquals(setOf("user"), rows.map { it.source }.toSet())
        assertEquals(setOf(9L), rows.map { it.songId }.toSet())
        assertEquals("auto", net.ninjaruss.utasync.align.TimingAnchor(0, 1.0, AnchorSource.AUTO).toEntity(1).source)
    }
}
