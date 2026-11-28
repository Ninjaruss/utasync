package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.data.PrepareState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The rules behind renaming a song, kept out of the composable so they can be read and tested.
 *
 * Renaming exists because the app had no way at all to correct a name (first real-song run,
 * 2026-11-28). Every file on the owner's device is downloader output with no embedded tags, so
 * the filename decides the name, and `/api/get` cannot run at all without an artist — see ledger
 * L67, which measured that no filename rule reaches those songs.
 */
class RenameSongTest {
    @Test fun `a trimmed, changed name is what gets stored`() {
        assertEquals(
            "Some Song" to "Someone",
            renamedTitleArtist("junk-name", "", "  Some Song  ", "  Someone  "),
        )
    }

    @Test fun `an artist may be cleared, because a blank artist is a real answer`() {
        // "" is what the import stores for a tag the file did not have: absent, not a name.
        assertEquals("Title" to "", renamedTitleArtist("Title", "Wrong", "Title", "   "))
    }

    @Test fun `a blank title is refused, because a song must keep a name`() {
        // A nameless song cannot be looked up and cannot be told from another in the library.
        assertNull(renamedTitleArtist("Title", "Someone", "   ", "Someone"))
    }

    @Test fun `a name that would not change anything is not a write`() {
        assertNull(renamedTitleArtist("Title", "Someone", "Title", "Someone"))
        // Trimming alone is not a change either.
        assertNull(renamedTitleArtist("Title", "Someone", " Title ", " Someone "))
    }

    /**
     * A stored lookup result describes the name that was asked for. Once the name changes, that
     * result is about a different question, so a song with no lines must not keep saying "No
     * lyrics found": the user renamed it precisely because the old name was wrong.
     */
    @Test fun `a stored miss does not survive a rename`() {
        assertEquals(PrepareState.PENDING, stateAfterRename(PrepareState.NO_MATCH, hasLines = false))
        assertEquals(PrepareState.PENDING, stateAfterRename(PrepareState.FAILED, hasLines = false))
        assertEquals(PrepareState.PENDING, stateAfterRename(PrepareState.RATE_LIMITED, hasLines = false))
    }

    @Test fun `a song that has lyrics keeps its state, whatever its name becomes`() {
        // Lines outrank the state everywhere (readinessOf), and renaming is not a reason to
        // forget that a song is singable.
        for (state in PrepareState.ALL) {
            assertNull(state, stateAfterRename(state, hasLines = true))
        }
    }

    /**
     * Derived from the vocabulary rather than listed, so a state added later must be decided
     * here. Only states that recorded nothing about the old name are left alone.
     */
    @Test fun `only states that learned nothing about the old name survive a rename`() {
        val keep = setOf(PrepareState.PENDING, PrepareState.OFF, PrepareState.FETCHING)
        for (state in PrepareState.ALL) {
            val after = stateAfterRename(state, hasLines = false)
            if (state in keep) assertNull(state, after) else assertEquals(state, PrepareState.PENDING, after)
        }
    }
}
