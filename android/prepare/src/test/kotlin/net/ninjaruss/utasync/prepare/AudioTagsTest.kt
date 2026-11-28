package net.ninjaruss.utasync.prepare

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AudioTagsTest {
    @Test fun `artist - title dot mp3 splits on the first spaced dash`() {
        val t = tagsFromFilename("Kenshi Yonezu - Lemon.mp3")
        assertEquals("Kenshi Yonezu", t.artist)
        assertEquals("Lemon", t.title)
    }

    @Test fun `only the first spaced dash splits`() {
        val t = tagsFromFilename("Artist - Title - Live.mp3")
        assertEquals("Artist", t.artist)
        assertEquals("Title - Live", t.title)
    }

    @Test fun `a hyphen inside a name is not a separator`() {
        val t = tagsFromFilename("Jay-Z - Song.mp3")
        assertEquals("Jay-Z", t.artist)
        assertEquals("Song", t.title)
    }

    @Test fun `an unspaced dash does not split`() {
        val t = tagsFromFilename("Artist-Title.mp3")
        assertEquals("Artist-Title", t.title)
        assertNull(t.artist)
    }

    @Test fun `a leading track number is dropped`() {
        val t = tagsFromFilename("03 - Lemon.mp3")
        assertEquals("Lemon", t.title)
        assertNull(t.artist)
    }

    @Test fun `a track number before artist and title is dropped too`() {
        val t = tagsFromFilename("03 - Kenshi Yonezu - Lemon.mp3")
        assertEquals("Kenshi Yonezu", t.artist)
        assertEquals("Lemon", t.title)
    }

    @Test fun `a bare name becomes the title`() {
        val t = tagsFromFilename("Lemon.mp3")
        assertEquals("Lemon", t.title)
        assertNull(t.artist)
    }

    @Test fun `underscores are not treated as separators`() {
        val t = tagsFromFilename("Kenshi_Yonezu_Lemon.mp3")
        assertEquals("Kenshi_Yonezu_Lemon", t.title)
        assertNull(t.artist)
    }

    @Test fun `filename tags never carry a duration`() {
        val t = tagsFromFilename("A - B.mp3")
        assertNull(t.durationMs)
    }

    @Test fun `embedded tags win over the filename, field by field`() {
        val m = mergeTags(
            embedded = AudioTags(artist = "Embedded Artist"),
            fromName = AudioTags(title = "Name Title", artist = "Name Artist"),
        )
        assertEquals("Embedded Artist", m.artist)
        assertEquals("Name Title", m.title)
    }

    @Test fun `a blank embedded tag does not beat the filename`() {
        val m = mergeTags(
            embedded = AudioTags(artist = ""),
            fromName = AudioTags(artist = "Name Artist"),
        )
        assertEquals("Name Artist", m.artist)
    }

    @Test fun `merge keeps the embedded duration`() {
        val m = mergeTags(AudioTags(durationMs = 215_000L), tagsFromFilename("A - B.mp3"))
        assertEquals(215_000L, m.durationMs)
    }

    // ---- The downloader tail (ledger L67). ----

    /**
     * Every audio file the owner actually has is downloader output ending in a bitrate and the
     * site's host. Measured against `/api/search` with `track_name` (what the app really sends):
     * 1 of 10 files returned any candidate with the tail left on, 2 of 10 with it removed, and
     * all 7 downloader files get a readable title instead of one ending in a hostname.
     */
    @Test fun `a bitrate and host tail is dropped from the title`() {
        val tags = tagsFromFilename("some-song-name-128-ytshorts.savetube.me.mp3")
        assertEquals("some-song-name", tags.title)
        assertNull(tags.artist)
    }

    @Test fun `a multi-label host is dropped on its own, without a bitrate before it`() {
        assertEquals("some-song", tagsFromFilename("some-song-a.b.example.mp3").title)
    }

    @Test fun `the tail is dropped before the artist split, so the artist survives`() {
        val tags = tagsFromFilename("Someone - Some Song - 128-ytshorts.savetube.me.mp3")
        assertEquals("Someone", tags.artist)
        assertEquals("Some Song", tags.title)
    }

    /**
     * The expensive mistake this rule must never make: a real title ending in a number or in a
     * single dotted word, with no way to correct it in the app (there is still no rename).
     * A bare number is only ever dropped as part of a tail that also had a host.
     */
    @Test fun `a title that merely ends in a number or a dotted word is left alone`() {
        for (name in listOf(
            "Song - 1999.mp3",
            "1999.mp3",
            "Artist - Track 128.mp3",
            "Blink-182 - 2001.mp3",
            "Artist - Song.live.mp3",
            "U.S.A..mp3",
        )) {
            val expected = name.removeSuffix(".mp3")
            val tags = tagsFromFilename(name)
            val rebuilt = listOfNotNull(tags.artist, tags.title).joinToString(" - ")
            assertEquals(name, expected, rebuilt)
        }
    }

    @Test fun `a name that is nothing but a tail keeps its text rather than emptying`() {
        // Stripping must never leave a song with no name at all: a nameless song cannot be
        // looked up and cannot be told apart in the library.
        assertEquals("128-ytshorts.savetube.me", tagsFromFilename("128-ytshorts.savetube.me.mp3").title)
    }
}
