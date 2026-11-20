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

    @Test fun `the reported outcomes group into exactly three messages, one per kind of answer`() {
        // Derived from the enum, so a new outcome cannot quietly join a group or inherit a text:
        // "nothing here", "asked to wait", and "could not be reached" (which OFFLINE and ERROR
        // share on purpose — the user can act on neither differently). FOUND says nothing.
        assertNull(lookupFailureMessage(LookupOutcome.FOUND))
        val groups = reported.groupBy { lookupFailureMessage(it) }
        groups.keys.forEach { assertNotNull(it); assertTrue(it!!.isNotBlank()) }
        assertEquals(
            setOf(
                setOf(LookupOutcome.NO_ENTRY),
                setOf(LookupOutcome.RATE_LIMITED),
                setOf(LookupOutcome.OFFLINE, LookupOutcome.ERROR),
            ),
            groups.values.map { it.toSet() }.toSet(),
        )
    }

    @Test fun `only an outcome that really failed to reach LRCLIB says so`() {
        val unreachable = setOf(LookupOutcome.OFFLINE, LookupOutcome.ERROR)
        reported.filterNot { it in unreachable }.forEach {
            val message = lookupFailureMessage(it)!!
            assertFalse("$it: $message", message.contains("reach", ignoreCase = true))
            assertFalse("$it: $message", message.contains("couldn't", ignoreCase = true))
        }
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
