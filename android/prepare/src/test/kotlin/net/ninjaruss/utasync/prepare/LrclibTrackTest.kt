package net.ninjaruss.utasync.prepare

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Fixtures use LRCLIB's field names with placeholder words, never real lyrics (rule 6).
class LrclibTrackTest {
    private val synced = """{"id":42,"trackName":"Song","artistName":"Singer","albumName":"Disc",
        "duration":256.4,"instrumental":false,"plainLyrics":"one\ntwo",
        "syncedLyrics":"[00:12.00]one\n[00:15.50]two"}"""

    @Test fun `parses a synced record`() {
        val t = parseTrack(synced)!!
        assertEquals(42L, t.id)
        assertEquals("Song", t.trackName)
        assertEquals("Singer", t.artistName)
        assertEquals("Disc", t.albumName)
        assertEquals(256, t.durationSec)
        assertFalse(t.instrumental)
        assertEquals("[00:12.00]one\n[00:15.50]two", t.syncedLyrics)
        assertEquals("one\ntwo", t.plainLyrics)
    }

    @Test fun `reads trackName, not the name alias`() {
        val t = parseTrack("""{"id":1,"name":"Alias","trackName":"Real","artistName":"A"}""")!!
        assertEquals("Real", t.trackName)
    }

    @Test fun `instrumental record has null lyrics and instrumental true`() {
        val t = parseTrack(
            """{"id":2,"trackName":"T","artistName":"A","instrumental":true,"plainLyrics":null,"syncedLyrics":null}""",
        )!!
        assertTrue(t.instrumental)
        assertNull(t.plainLyrics)
        assertNull(t.syncedLyrics)
    }

    @Test fun `missing optional fields become null, not the string null`() {
        val t = parseTrack("""{"id":3,"trackName":"T","artistName":"A","albumName":null}""")!!
        assertNull(t.albumName)
        assertNull(t.durationSec)
        assertNull(t.plainLyrics)
        assertNull(t.syncedLyrics)
        assertFalse(t.instrumental)
    }

    @Test fun `parseTrack returns null for a 404 error body`() {
        assertNull(parseTrack("""{"message":"Failed to find specified track","name":"TrackNotFound","statusCode":404}"""))
    }

    @Test fun `parseTrack returns null for a non-JSON body`() {
        assertNull(parseTrack("track_name is required"))
        assertNull(parseTrack(""))
    }

    @Test fun `parseTracks reads an array and returns empty for anything else`() {
        val list = parseTracks("[$synced,$synced]")
        assertEquals(2, list.size)
        assertNotNull(list[0].syncedLyrics)
        assertTrue(parseTracks("""{"statusCode":404}""").isEmpty())
        assertTrue(parseTracks("nope").isEmpty())
        assertTrue(parseTracks("[]").isEmpty())
    }
}
