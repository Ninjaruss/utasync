package net.ninjaruss.utasync.prepare

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AudioTagsTest {
    @Test fun `artist - title dot mp3 splits on the first dash`() {
        val t = tagsFromFilename("Kenshi Yonezu - Lemon.mp3")
        assertEquals("Kenshi Yonezu", t.artist)
        assertEquals("Lemon", t.title)
    }

    @Test fun `only the first dash splits`() {
        val t = tagsFromFilename("Artist - Title - Live.mp3")
        assertEquals("Artist", t.artist)
        assertEquals("Title - Live", t.title)
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

    @Test fun `filename tags never carry a duration or album`() {
        val t = tagsFromFilename("A - B.mp3")
        assertNull(t.durationMs)
        assertNull(t.album)
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
}
