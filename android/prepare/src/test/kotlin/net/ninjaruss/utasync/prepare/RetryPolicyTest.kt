package net.ninjaruss.utasync.prepare

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class RetryPolicyTest {
    @Test fun `a json 200 is used`() {
        assertEquals(Reply.JSON, classify(200, "application/json"))
        assertEquals(Reply.JSON, classify(200, "application/json; charset=utf-8"))
    }

    // LRCLIB answers malformed queries in plain text.
    @Test fun `a 200 of plain text is a client error`() {
        assertEquals(Reply.CLIENT_ERROR, classify(200, "text/plain"))
        assertEquals(Reply.CLIENT_ERROR, classify(200, null))
    }

    @Test fun `404 is not found and is never retried`() {
        assertEquals(Reply.NOT_FOUND, classify(404, "application/json"))
        assertNull(retryDelayMs(Reply.NOT_FOUND, retryAfterSec = null, attempt = 1, jitterMs = 0))
    }

    @Test fun `429 waits at least the Retry-After it was given`() {
        assertEquals(Reply.RATE_LIMITED, classify(429, null))
        val delay = retryDelayMs(Reply.RATE_LIMITED, retryAfterSec = 7, attempt = 1, jitterMs = 120)
        assertEquals(7_120L, delay)
    }

    @Test fun `429 without Retry-After backs off exponentially`() {
        assertEquals(600L, retryDelayMs(Reply.RATE_LIMITED, null, attempt = 1, jitterMs = 100))
        assertEquals(1_100L, retryDelayMs(Reply.RATE_LIMITED, null, attempt = 2, jitterMs = 100))
    }

    @Test fun `a backoff is capped`() {
        assertEquals(
            MAX_BACKOFF_MS + 50,
            retryDelayMs(Reply.RATE_LIMITED, retryAfterSec = 86_400, attempt = 1, jitterMs = 50),
        )
    }

    @Test fun `the last attempt does not ask for another`() {
        assertNull(retryDelayMs(Reply.RATE_LIMITED, 1, attempt = MAX_ATTEMPTS, jitterMs = 0))
        assertNotNull(retryDelayMs(Reply.RATE_LIMITED, 1, attempt = MAX_ATTEMPTS - 1, jitterMs = 0))
    }

    @Test fun `a 503 is retried and a 400 is not`() {
        assertEquals(Reply.BUSY, classify(503, null))
        assertNotNull(retryDelayMs(Reply.BUSY, null, attempt = 1, jitterMs = 0))
        assertEquals(Reply.CLIENT_ERROR, classify(400, "text/plain"))
        assertNull(retryDelayMs(Reply.CLIENT_ERROR, null, attempt = 1, jitterMs = 0))
    }

    @Test fun `other server errors are retried`() {
        assertEquals(Reply.SERVER_ERROR, classify(500, null))
        assertNotNull(retryDelayMs(Reply.SERVER_ERROR, null, attempt = 1, jitterMs = 0))
    }

    @Test fun `a json reply is never retried`() {
        assertNull(retryDelayMs(Reply.JSON, null, attempt = 1, jitterMs = 0))
    }

    @Test fun `outcomeOf maps every Reply`() {
        for (reply in Reply.entries) {
            val expected = when (reply) {
                Reply.JSON -> LookupOutcome.FOUND
                Reply.NOT_FOUND -> LookupOutcome.NO_ENTRY
                Reply.RATE_LIMITED -> LookupOutcome.RATE_LIMITED
                Reply.BUSY, Reply.CLIENT_ERROR, Reply.SERVER_ERROR -> LookupOutcome.ERROR
            }
            assertEquals(expected, outcomeOf(reply))
        }
    }
}
