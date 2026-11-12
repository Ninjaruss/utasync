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

    // Defence in depth only: the schema allows one anchor per line and SongDao.upsertAuto refuses to
    // replace a user pin (tested in PinsSurviveReAlignmentTest), so storage cannot produce this pair.
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

    @Test(expected = IllegalArgumentException::class)
    fun linesOutOfOrderAreRejectedNotSilentlyMisresolved() {
        resolveStarts(listOf(line(1, 2_000), line(0, 1_000)), emptyList())
    }

    /**
     * The 50 ms minimum gap exists three times under three names: `applyAnchors(minGapSec = 0.05)`
     * in `:align`, `NudgeState.MIN_GAP_MS` (pinned by `NudgeStateTest`) and this module's
     * [MIN_PIN_GAP_MS]. This probe reads `:align`'s DEFAULT back out of its behaviour — in an
     * open-ended segment an unanchored line is pushed exactly `minGapSec` past the pin — so
     * changing one of the three without the others fails here instead of silently desynchronising
     * the resolved view from the module it hands its anchors to.
     */
    @Test fun theResolversMinimumGapIsTheAlignModulesDefault() {
        val pushed = net.ninjaruss.utasync.align.applyAnchors(
            computed = listOf(0.0, 0.0),
            anchors = listOf(net.ninjaruss.utasync.align.TimingAnchor(0, 10.0)),
        )
        assertEquals(MIN_PIN_GAP_MS / 1000.0, pushed[1] - pushed[0], 1e-9)
        assertEquals(50L, MIN_PIN_GAP_MS)
    }

    @Test fun resolvingLeavesTheStoredAnchorsUntouched() {
        val stored = listOf(user(1, 3_500), user(2, 3_000))
        val copy = stored.toList()
        resolveStarts(sheet, stored)
        assertEquals(copy, stored)
    }
}
