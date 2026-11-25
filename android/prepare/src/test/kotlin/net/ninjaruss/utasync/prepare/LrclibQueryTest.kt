package net.ninjaruss.utasync.prepare

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LrclibQueryTest {
    @Test fun `get url carries duration in seconds`() {
        val url = getUrl(TrackQuery("Lemon", "Kenshi Yonezu", durationSec = 256))
        assertTrue(url.startsWith("https://lrclib.net/api/get?"))
        assertTrue(url.contains("track_name=Lemon"))
        assertTrue(url.contains("artist_name=Kenshi+Yonezu") || url.contains("artist_name=Kenshi%20Yonezu"))
        assertTrue(url.contains("duration=256"))
    }

    @Test fun `get url omits absent optional fields`() {
        val url = getUrl(TrackQuery("A", "B"))
        assertFalse(url.contains("duration="))
        assertFalse(url.contains("album_name="))
    }

    @Test fun `japanese title and artist are percent encoded as utf-8`() {
        val url = getUrl(TrackQuery("打上花火", "DAOKO"))
        assertTrue(url.contains("track_name=%E6%89%93%E4%B8%8A%E8%8A%B1%E7%81%AB"))
        assertFalse(url.contains("打"))
    }

    @Test fun `search url uses track and artist, never duration`() {
        val url = searchUrl(TrackQuery("Lemon", "Kenshi Yonezu", durationSec = 256))
        assertTrue(url.startsWith("https://lrclib.net/api/search?"))
        assertTrue(url.contains("track_name=Lemon"))
        assertTrue(url.contains("artist_name="))
        assertFalse(url.contains("duration="))
    }

    @Test fun `neither url carries an album, which is never sent`() {
        // The README documents what leaves the device; this keeps that sentence true.
        val q = TrackQuery("A", "B", durationSec = 100)
        assertFalse(getUrl(q).contains("album"))
        assertFalse(searchUrl(q).contains("album"))
    }

    @Test fun `user agent names the app and links it, and carries nothing else`() {
        assertEquals("Utasync/0.1.0 (https://github.com/Ninjaruss/utasync)", userAgent("0.1.0"))
    }
}
