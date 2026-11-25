package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.prepare.LrclibTrack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** Placeholder words and bare time tags only: no real lyric text (ADR-0004). */
class CandidateLabelTest {
    private val timed = "[00:12.00]la\n[00:15.00]la"

    @Test fun `a candidate shows what tells recordings apart`() {
        val t = LrclibTrack(1, "Lemon", "Kenshi Yonezu", "BOOTLEG", 256, false, null, timed)
        assertEquals("Lemon · Kenshi Yonezu · BOOTLEG · 4:16 · timed", candidateLabel(t))
    }

    @Test fun `a candidate with only plain lyrics says words only`() {
        val t = LrclibTrack(2, "Lemon", "Kenshi Yonezu", "BOOTLEG", 256, false, "la\nla", null)
        assertEquals("Lemon · Kenshi Yonezu · BOOTLEG · 4:16 · words only", candidateLabel(t))
    }

    @Test fun `a candidate with no duration says so rather than showing 0_00`() {
        val t = LrclibTrack(3, "Lemon", "Kenshi Yonezu", null, null, false, null, timed)
        val label = candidateLabel(t)
        assertEquals("Lemon · Kenshi Yonezu · length unknown · timed", label)
        assertFalse(label.contains("0:00"))
    }

    @Test fun `an instrumental candidate is labelled instrumental`() {
        val t = LrclibTrack(4, "Lemon", "Kenshi Yonezu", null, 256, true, null, null)
        assertEquals("Lemon · Kenshi Yonezu · 4:16 · instrumental", candidateLabel(t))
    }

    @Test fun `a candidate with no lyric text says so instead of claiming words`() {
        val t = LrclibTrack(5, "Lemon", "Kenshi Yonezu", null, 61, false, null, null)
        assertEquals("Lemon · Kenshi Yonezu · 1:01 · no lyrics", candidateLabel(t))
    }

    @Test fun `a blank artist or album is left out rather than leaving an empty slot`() {
        val t = LrclibTrack(6, "Lemon", "", " ", 256, false, "la", null)
        assertEquals("Lemon · 4:16 · words only", candidateLabel(t))
    }

    @Test fun `with the file's length known the candidate states the difference`() {
        val t = LrclibTrack(7, "Lemon", "Kenshi Yonezu", null, 256, false, null, timed)
        assertEquals(
            "Lemon · Kenshi Yonezu · 4:16 · 8 s longer than your file · timed",
            candidateLabel(t, audioDurationMs = 248_000L),
        )
    }

    @Test fun `a candidate of unknown length states no difference it cannot know`() {
        val t = LrclibTrack(8, "Lemon", "Kenshi Yonezu", null, null, false, null, timed)
        assertEquals(
            "Lemon · Kenshi Yonezu · length unknown · timed",
            candidateLabel(t, audioDurationMs = 248_000L),
        )
    }
}
