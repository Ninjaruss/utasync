package net.ninjaruss.utasync.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ReadinessTest {
    @Test fun `fetching is shown only while there is nothing stored to show`() {
        assertEquals(Readiness.FETCHING, readinessOf(PrepareState.FETCHING, 0, 0))
        // Lines win once they exist. A lookup in flight must not give a partly timed song a
        // highlight it has not earned, nor take one away from a song that is already singable.
        assertEquals(Readiness.WORDS_ONLY, readinessOf(PrepareState.FETCHING, 10, 4))
        assertEquals(Readiness.SINGABLE, readinessOf(PrepareState.FETCHING, 10, 10))
    }

    @Test fun `no lines and a failed fetch is FETCH_FAILED`() {
        assertEquals(Readiness.FETCH_FAILED, readinessOf("failed", 0, 0))
    }

    @Test fun `no lines and a rate limit is RATE_LIMITED, not FETCH_FAILED or NO_MATCH`() {
        val r = readinessOf(PrepareState.RATE_LIMITED, 0, 0)
        assertEquals(Readiness.RATE_LIMITED, r)
        assertNotEquals(Readiness.FETCH_FAILED, r)
        assertNotEquals(Readiness.NO_MATCH, r)
    }

    /**
     * The whole vocabulary, derived: every state must map somewhere deliberate. NO_LYRICS is for
     * states that mean "nothing has been tried or nothing is stored" — a new state that forgot its
     * branch in readinessOf would land there and read as "No lyrics yet", which is the false label
     * this app exists not to repeat.
     */
    @Test fun `every prepare state maps to a readiness that is NO_LYRICS only if nothing was learned`() {
        val nothingLearned = setOf(PrepareState.PENDING, PrepareState.OFF, PrepareState.DONE)
        for (state in PrepareState.ALL) {
            val r = readinessOf(state, 0, 0)
            if (state in nothingLearned) {
                assertEquals(state, Readiness.NO_LYRICS, r)
            } else {
                assertNotEquals(state, Readiness.NO_LYRICS, r)
            }
        }
    }

    /**
     * The state the live run exposed: LRCLIB's search answered with records, so "no lyrics found"
     * is false. NEEDS_CHOICE means the user has something to pick from, and must never collapse
     * into NO_MATCH, which says the catalogue had nothing.
     */
    @Test fun `candidates waiting is NEEDS_CHOICE, never NO_MATCH`() {
        val r = readinessOf(PrepareState.NEEDS_CHOICE, 0, 0)
        assertEquals(Readiness.NEEDS_CHOICE, r)
        assertNotEquals(Readiness.NO_MATCH, r)
        assertNotEquals(Readiness.NO_LYRICS, r)
        // Lines still win: once a record is picked, the state it came from says nothing.
        assertEquals(Readiness.SINGABLE, readinessOf(PrepareState.NEEDS_CHOICE, 5, 5))
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
        for (state in PrepareState.ALL) {
            val r = readinessOf(state, 5, 0)
            assertEquals(state, Readiness.WORDS_ONLY, r)
        }
        assertEquals(Readiness.SINGABLE, readinessOf("no-match", 5, 5))
        assertEquals(Readiness.SINGABLE, readinessOf("failed", 5, 5))
    }

    // Why emptyPlayerMessage may fold WORDS_ONLY and SINGABLE into its `else`: a song with no
    // lines can never be either.
    @Test fun `a song with no lines is never WORDS_ONLY or SINGABLE, whatever the prepare state`() {
        for (state in PrepareState.ALL) {
            val r = readinessOf(state, 0, 0)
            assertNotEquals(state, Readiness.WORDS_ONLY, r)
            assertNotEquals(state, Readiness.SINGABLE, r)
        }
    }
}
