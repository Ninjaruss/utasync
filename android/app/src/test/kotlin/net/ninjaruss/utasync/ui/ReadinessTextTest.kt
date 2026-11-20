package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.data.PrepareState
import net.ninjaruss.utasync.data.Readiness
import net.ninjaruss.utasync.data.readinessOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
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

    @Test fun `the messages a song with no lines can actually show are non-blank and distinct`() {
        // The reachable domain is derived, not listed: every prepareState a song can hold, run
        // through readinessOf with no lines. A new state or a precedence change is covered.
        val reachable = PrepareState.ALL.map { readinessOf(it, 0, 0) }.toSet()
        val texts = reachable.map { emptyPlayerMessage(it) }
        assertTrue(texts.all { it.isNotBlank() })
        assertEquals(texts, texts.distinct())
    }

    @Test fun `NO_MATCH and FETCH_FAILED read differently in both places`() {
        assertNotEquals(libraryStatus(Readiness.NO_MATCH), libraryStatus(Readiness.FETCH_FAILED))
        assertNotEquals(emptyPlayerMessage(Readiness.NO_MATCH), emptyPlayerMessage(Readiness.FETCH_FAILED))
    }

    @Test fun `a rate-limited song says it was asked to wait, never that LRCLIB was unreachable`() {
        val texts = listOf(libraryStatus(Readiness.RATE_LIMITED)!!, emptyPlayerMessage(Readiness.RATE_LIMITED))
        texts.forEach { assertTrue(it, it.contains("wait")) }
        // LRCLIB was reached. The enum-wide guards above cover "reach" and "fail"; sharing a text
        // with FETCH_FAILED would re-merge the two states, which is the thing being prevented.
        assertNotEquals(libraryStatus(Readiness.FETCH_FAILED), libraryStatus(Readiness.RATE_LIMITED))
        assertNotEquals(
            emptyPlayerMessage(Readiness.FETCH_FAILED),
            emptyPlayerMessage(Readiness.RATE_LIMITED),
        )
    }

    @Test fun `only a state a retry can help offers a button, and never a rate-limited one`() {
        // Derived from the whole enum, not a list: a new readiness value must be decided here.
        val offered = Readiness.entries.filter { emptyPlayerAction(it) != null }.toSet()
        assertEquals(setOf(Readiness.FETCH_FAILED, Readiness.NO_LYRICS), offered)
        assertNull(emptyPlayerAction(Readiness.RATE_LIMITED))
        // Every label that is offered is non-blank and distinct, so no two buttons read alike.
        val labels = offered.map { emptyPlayerAction(it)!! }
        assertTrue(labels.all { it.isNotBlank() })
        assertEquals(labels.size, labels.distinct().size)
    }

    @Test fun `the lyrics screen is never described as only loading a file`() {
        // It searches, pastes and imports. Saying "load a synced .lrc file" under-describes it.
        Readiness.entries.map { emptyPlayerMessage(it) }.filter { it.contains("Lyrics…") }.forEach {
            assertTrue(it, it.contains("search"))
            assertTrue(it, it.contains("paste"))
        }
    }

    @Test fun `no row text promises a tap`() {
        rowTexts.forEach { assertFalse(it, it.contains("tap to", ignoreCase = true)) }
    }

    @Test fun `no readiness text claims LRCLIB was unreachable, because none of them can know`() {
        // Over the whole enum, FETCH_FAILED included: prepareState = "failed" is written both for
        // OFFLINE (nothing answered) and for ERROR (LRCLIB answering with a 503, a 4xx, a 5xx or
        // a non-JSON 200), so neither of these texts can honestly say the service was not
        // reached. Only the lyrics screen, which still holds the outcome, may say it.
        Readiness.entries.forEach {
            listOfNotNull(libraryStatus(it), emptyPlayerMessage(it)).forEach { t ->
                assertFalse(t, t.contains("reach", ignoreCase = true))
                assertFalse(t, t.contains("unreachable", ignoreCase = true))
            }
        }
    }

    @Test fun `only FETCH_FAILED says the lookup did not finish`() {
        Readiness.entries.filter { it != Readiness.FETCH_FAILED }.forEach {
            listOfNotNull(libraryStatus(it), emptyPlayerMessage(it)).forEach { t ->
                assertFalse(t, t.contains("didn't finish", ignoreCase = true))
                assertFalse(t, t.contains("fail", ignoreCase = true))
            }
        }
        listOf(libraryStatus(Readiness.FETCH_FAILED)!!, emptyPlayerMessage(Readiness.FETCH_FAILED))
            .forEach { assertTrue(it, it.contains("didn't finish")) }
    }

    @Test fun `off and pending read as no lyrics yet, never a failure`() {
        val off = readinessOf(PrepareState.OFF, 0, 0)
        assertEquals(Readiness.NO_LYRICS, off)
        val texts = listOf(libraryStatus(off)!!, emptyPlayerMessage(off))
        texts.forEach {
            assertFalse(it, it.contains("fail", ignoreCase = true))
            assertFalse(it, it.contains("didn't finish", ignoreCase = true))
            assertFalse(it, it.contains("LRCLIB", ignoreCase = true))
        }
    }
}
