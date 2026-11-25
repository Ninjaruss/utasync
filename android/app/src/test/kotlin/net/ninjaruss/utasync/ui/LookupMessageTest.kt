package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.prepare.LookupOutcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The lyrics screen told the user "Couldn't reach LRCLIB" for every outcome that was not
 * NO_ENTRY, a rate limit included — the same false statement the player and the library row were
 * fixed for, surviving on this screen.
 */
class LookupMessageTest {
    /** Everything a lookup can answer except FOUND, which is adopted rather than described. */
    private val reported = LookupOutcome.entries.filter { it != LookupOutcome.FOUND }

    @Test fun `the reported outcomes group into exactly four messages, one per kind of answer`() {
        // Derived from the enum, so a new outcome cannot quietly join a group or inherit a text:
        // "nothing here", "asked to wait", "nothing answered" and "answered with an error". ERROR
        // used to share OFFLINE's text, which was false: a 503, a 4xx, a 5xx and a non-JSON 200
        // are all LRCLIB answering. FOUND says nothing.
        assertNull(lookupFailureMessage(LookupOutcome.FOUND))
        val groups = reported.groupBy { lookupFailureMessage(it) }
        groups.keys.forEach { assertNotNull(it); assertTrue(it!!.isNotBlank()) }
        assertEquals(
            setOf(
                setOf(LookupOutcome.NO_ENTRY),
                setOf(LookupOutcome.RATE_LIMITED),
                setOf(LookupOutcome.OFFLINE),
                setOf(LookupOutcome.ERROR),
            ),
            groups.values.map { it.toSet() }.toSet(),
        )
    }

    @Test fun `OFFLINE alone says LRCLIB could not be reached, and it does say it`() {
        // Both directions. OFFLINE is the only outcome where nothing answered, so it is the only
        // one allowed that wording — and it must actually carry it, or the one true statement
        // about an unreachable service would have quietly disappeared.
        val offline = lookupFailureMessage(LookupOutcome.OFFLINE)!!
        assertTrue(offline, offline.contains("reach", ignoreCase = true))
        reported.filter { it != LookupOutcome.OFFLINE }.forEach {
            val message = lookupFailureMessage(it)!!
            assertFalse("$it: $message", message.contains("reach", ignoreCase = true))
            assertFalse("$it: $message", message.contains("couldn't", ignoreCase = true))
        }
    }

    @Test fun `an error says LRCLIB answered, because in every ERROR case it did`() {
        val message = lookupFailureMessage(LookupOutcome.ERROR)!!
        assertTrue(message, message.contains("answered"))
        assertFalse(message, message.contains("reach", ignoreCase = true))
    }

    @Test fun `a rate limit is the one outcome that stops another search being offered`() {
        // Derived from the enum, including "before any search" (null), so a new outcome must be
        // decided here. The harm to a keyless client is the request, not the label (L51).
        val blocked = (LookupOutcome.entries + null).filterNot { searchAllowed(it) }
        assertEquals(listOf(LookupOutcome.RATE_LIMITED), blocked)
    }

    @Test fun `a rate limit asks for a minute rather than an immediate retry`() {
        val message = lookupFailureMessage(LookupOutcome.RATE_LIMITED)!!
        assertTrue(message, message.contains("wait"))
        assertTrue(message, message.contains("in a minute"))
        // The one text it must never borrow, since sharing it re-merges the two states.
        reported.filter { it != LookupOutcome.RATE_LIMITED }.forEach {
            assertFalse(it.toString(), lookupFailureMessage(it) == message)
        }
    }
}
