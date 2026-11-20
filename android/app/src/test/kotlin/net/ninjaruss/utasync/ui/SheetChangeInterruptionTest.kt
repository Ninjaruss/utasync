package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.data.PrepareState
import net.ninjaruss.utasync.prepare.LrclibTrack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A cancelled paste used to write `"pending"`, which downgraded a `"no-match"` song's label to
 * "No lyrics yet" just for backing out of the paste field.
 *
 * `SheetChange.Lrc` is not exercised here: constructing an `android.net.Uri` needs the framework.
 * It takes the same `!= Search` branch, in one line of `stateAfterInterruption`.
 */
class SheetChangeInterruptionTest {
    private val track = LrclibTrack(
        id = 1, trackName = "Placeholder", artistName = "Nobody", albumName = null,
        durationSec = null, instrumental = false, plainLyrics = null, syncedLyrics = null,
    )

    @Test fun `a cancelled search resets to pending and a failed one to failed`() {
        assertEquals(PrepareState.PENDING, stateAfterInterruption(SheetChange.Search, cancelled = true))
        assertEquals(PrepareState.FAILED, stateAfterInterruption(SheetChange.Search, cancelled = false))
    }

    @Test fun `a change that never sets a state leaves it alone, cancelled or failed`() {
        val others = listOf(SheetChange.Adopt(track), SheetChange.Paste("la la"))
        others.forEach { change ->
            assertNull(change.toString(), stateAfterInterruption(change, cancelled = true))
            assertNull(change.toString(), stateAfterInterruption(change, cancelled = false))
        }
    }

    @Test fun `whatever a search writes stays inside the vocabulary`() {
        listOf(true, false).forEach {
            val state = stateAfterInterruption(SheetChange.Search, cancelled = it)!!
            assertEquals(state, PrepareState.ALL.firstOrNull { s -> s == state })
        }
    }
}
