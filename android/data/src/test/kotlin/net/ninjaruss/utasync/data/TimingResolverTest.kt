package net.ninjaruss.utasync.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TimingResolverTest {
    private fun line(i: Int, ms: Long?) = LineEntity(1, i, "l$i", ms, null)
    private fun user(i: Int, ms: Long) = AnchorEntity(1, i, ms, "user")
    private fun auto(i: Int, ms: Long) = AnchorEntity(1, i, ms, "auto")
    private val sheet = listOf(line(0, 1_000), line(1, 2_000), line(2, 3_000), line(3, 4_000))

    @Test fun aUserAnchorBeatsTheComputedTime() {
        assertEquals(listOf<Long?>(1_000, 2_500, 3_000, 4_000), resolveStarts(sheet, listOf(user(1, 2_500))))
    }

    @Test fun unanchoredLinesTakeTheComputedTime() {
        assertEquals(listOf<Long?>(1_000, 2_000, 3_000, 4_000), resolveStarts(sheet, emptyList()))
        assertEquals(listOf<Long?>(1_000, null, 3_000), resolveStarts(listOf(line(0, 1_000), line(1, null), line(2, 3_000)), emptyList()))
    }

    @Test fun anchorsOnLinesThatNoLongerExistAreIgnored() {
        assertEquals(listOf<Long?>(1_000, 2_000), resolveStarts(sheet.take(2), listOf(user(3, 9_000), user(7, 1))))
    }

    @Test fun autoAnchorsAreOverriddenByUserAnchors() {
        assertEquals(2_700L, resolveStarts(sheet, listOf(auto(1, 2_200), user(1, 2_700)))[1])
        assertEquals(2_200L, resolveStarts(sheet, listOf(auto(1, 2_200)))[1])
    }

    @Test fun aPinOnALineWithNoComputedTimeStillApplies() {
        assertEquals(2_000L, resolveStarts(listOf(line(0, 1_000), line(1, null)), listOf(user(1, 2_000)))[1])
    }

    @Test fun conflictingUserPinsKeepTheEarlierLineAndNeverDropOne() {
        val out = resolveStarts(sheet, listOf(user(1, 3_500), user(2, 3_000)))
        assertEquals(3_500L, out[1])           // earlier line wins
        assertEquals(3_550L, out[2])           // later pin clamped forward by the minimum gap
        assertTrue(out.zipWithNext().all { (a, b) -> a!! < b!! })
    }

    @Test fun anAutoPinThatCannotFitIsIgnoredNotForced() {
        val out = resolveStarts(sheet, listOf(user(2, 3_000), auto(1, 3_500)))
        assertEquals(3_000L, out[2])
        assertTrue(out[1]!! < out[2]!!)
        assertTrue(out[1] != 3_500L)
    }

    @Test fun resolvingLeavesTheStoredAnchorsUntouched() {
        val stored = listOf(user(1, 3_500), user(2, 3_000))
        val copy = stored.toList()
        resolveStarts(sheet, stored)
        assertEquals(copy, stored)
    }
}
