package net.ninjaruss.utasync.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ReadinessTest {
    @Test fun `fetching wins over whatever the lines say`() {
        assertEquals(Readiness.FETCHING, readinessOf("fetching", 0, 0))
        assertEquals(Readiness.FETCHING, readinessOf("fetching", 10, 10))
    }

    @Test fun `no lines and a failed fetch is FETCH_FAILED`() {
        assertEquals(Readiness.FETCH_FAILED, readinessOf("failed", 0, 0))
    }

    @Test fun `no lines and no match is NO_MATCH, not FETCH_FAILED`() {
        assertEquals(Readiness.NO_MATCH, readinessOf("no-match", 0, 0))
        assertNotEquals(Readiness.FETCH_FAILED, readinessOf("no-match", 0, 0))
        assertNotEquals(readinessOf("no-match", 0, 0), readinessOf("failed", 0, 0))
    }

    @Test fun `no lines and a pending fetch is NO_LYRICS`() {
        assertEquals(Readiness.NO_LYRICS, readinessOf("pending", 0, 0))
    }

    @Test fun `lookup turned off reads as NO_LYRICS, never as a failure`() {
        assertEquals(Readiness.NO_LYRICS, readinessOf("off", 0, 0))
    }

    @Test fun `done with no lines stored is NO_LYRICS`() {
        assertEquals(Readiness.NO_LYRICS, readinessOf("done", 0, 0))
    }

    @Test fun `lines with no times are WORDS_ONLY`() {
        assertEquals(Readiness.WORDS_ONLY, readinessOf("done", 12, 0))
    }

    @Test fun `every line timed is SINGABLE`() {
        assertEquals(Readiness.SINGABLE, readinessOf("done", 12, 12))
    }

    @Test fun `a partly timed song is WORDS_ONLY, not SINGABLE`() {
        assertEquals(Readiness.WORDS_ONLY, readinessOf("done", 12, 11))
    }

    @Test fun `a song with lines is never NO_MATCH, whatever the prepare state says`() {
        for (state in listOf("pending", "done", "no-match", "failed", "off")) {
            val r = readinessOf(state, 5, 0)
            assertEquals(state, Readiness.WORDS_ONLY, r)
        }
        assertEquals(Readiness.SINGABLE, readinessOf("no-match", 5, 5))
        assertEquals(Readiness.SINGABLE, readinessOf("failed", 5, 5))
    }

    // Why emptyPlayerMessage may fold WORDS_ONLY and SINGABLE into its `else`: a song with no
    // lines can never be either.
    @Test fun `a song with no lines is never WORDS_ONLY or SINGABLE, whatever the prepare state`() {
        for (state in listOf("pending", "fetching", "done", "no-match", "failed", "off")) {
            val r = readinessOf(state, 0, 0)
            assertNotEquals(state, Readiness.WORDS_ONLY, r)
            assertNotEquals(state, Readiness.SINGABLE, r)
        }
    }
}
