package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.data.Readiness
import net.ninjaruss.utasync.data.readinessOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pins the honesty ruling where the user reads it: NO_MATCH and FETCH_FAILED never share a text. */
class ReadinessTextTest {
    private val rowTexts = Readiness.entries.mapNotNull { libraryStatus(it) }

    @Test fun `every row text is non-blank and distinct across the whole enum`() {
        assertTrue(rowTexts.all { it.isNotBlank() })
        assertEquals(rowTexts, rowTexts.distinct())
        // SINGABLE alone has no status (the row shows the artist); nothing else may be null.
        assertEquals(listOf(Readiness.SINGABLE), Readiness.entries.filter { libraryStatus(it) == null })
    }

    @Test fun `every empty-player message is non-blank and distinct across the whole enum`() {
        val texts = Readiness.entries.map { emptyPlayerMessage(it) }
        assertTrue(texts.all { it.isNotBlank() })
        // Only states a song with no lines can be in need their own wording; the rest never reach
        // this screen. WORDS_ONLY and SINGABLE fall to the generic text, so compare the reachable ones.
        val reachable = listOf(Readiness.FETCHING, Readiness.NO_LYRICS, Readiness.NO_MATCH, Readiness.FETCH_FAILED)
            .map { emptyPlayerMessage(it) }
        assertEquals(reachable, reachable.distinct())
    }

    @Test fun `NO_MATCH and FETCH_FAILED read differently in both places`() {
        assertNotEquals(libraryStatus(Readiness.NO_MATCH), libraryStatus(Readiness.FETCH_FAILED))
        assertNotEquals(emptyPlayerMessage(Readiness.NO_MATCH), emptyPlayerMessage(Readiness.FETCH_FAILED))
    }

    @Test fun `no row text promises a tap`() {
        rowTexts.forEach { assertFalse(it, it.contains("tap to", ignoreCase = true)) }
    }

    @Test fun `only FETCH_FAILED talks about reaching the service`() {
        val others = Readiness.entries.filter { it != Readiness.FETCH_FAILED }
        others.forEach {
            listOfNotNull(libraryStatus(it), emptyPlayerMessage(it)).forEach { t ->
                assertFalse(t, t.contains("reach", ignoreCase = true))
                assertFalse(t, t.contains("fail", ignoreCase = true))
            }
        }
    }

    @Test fun `off and pending read as no lyrics yet, never a failure`() {
        val off = readinessOf("off", 0, 0)
        assertEquals(Readiness.NO_LYRICS, off)
        val texts = listOf(libraryStatus(off)!!, emptyPlayerMessage(off))
        texts.forEach {
            assertFalse(it, it.contains("reach", ignoreCase = true))
            assertFalse(it, it.contains("fail", ignoreCase = true))
            assertFalse(it, it.contains("LRCLIB", ignoreCase = true))
        }
    }
}
