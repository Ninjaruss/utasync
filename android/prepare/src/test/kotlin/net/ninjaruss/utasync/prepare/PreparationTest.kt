package net.ninjaruss.utasync.prepare

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import net.ninjaruss.utasync.data.AlignmentRunEntity
import net.ninjaruss.utasync.data.AnchorEntity
import net.ninjaruss.utasync.data.LineCounts
import net.ninjaruss.utasync.data.LineEntity
import net.ninjaruss.utasync.data.SongDao
import net.ninjaruss.utasync.data.SongEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * No lyric text anywhere in here: placeholder words and bare time tags only
 * (rule 6 / ADR-0004).
 */
class PreparationTest {
    /**
     * Subclasses the real [SongDao] rather than introducing a parallel interface: `upsertUser`
     * and `upsertAuto` are the doors that enforce the pin guarantee (ADR-0002) and a second
     * abstraction beside them is somewhere a future caller could slip past it. Those two are
     * **not** overridden. The raw `upsertAnchor` and `deleteAnchor` are recorded, not forbidden,
     * so a test can assert that preparation wrote and deleted nothing.
     */
    private class FakeDao(
        private var row: SongEntity,
        private val pins: List<AnchorEntity> = emptyList(),
    ) : SongDao() {
        val replaceLinesCalls = mutableListOf<List<LineEntity>>()
        val anchorWrites = mutableListOf<AnchorEntity>()
        val deletedAnchors = mutableListOf<Int>()
        val states = mutableListOf<String>()
        val lyricsSources = mutableListOf<String>()
        val titleArtistWrites = mutableListOf<Pair<String, String>>()

        /** The row as it stands now, so a test can read what preparation wrote. */
        val current: SongEntity get() = row

        override suspend fun anchors(songId: Long): List<AnchorEntity> = pins

        override suspend fun replaceLines(songId: Long, lines: List<LineEntity>) {
            replaceLinesCalls += lines
        }

        override suspend fun song(id: Long): SongEntity? = row.takeIf { it.id == id }

        override suspend fun setPrepareState(id: Long, state: String) {
            states += state
            row = row.copy(prepareState = state)
        }

        override suspend fun setLyricsSource(id: Long, source: String) {
            lyricsSources += source
            row = row.copy(lyricsSource = source)
        }

        override suspend fun setTitleArtist(id: Long, title: String, artist: String) {
            titleArtistWrites += title to artist
            row = row.copy(title = title, artist = artist)
        }

        override suspend fun upsertAnchor(anchor: AnchorEntity) {
            anchorWrites += anchor
        }

        override suspend fun deleteAnchor(songId: Long, lineIndex: Int) {
            deletedAnchors += lineIndex
        }

        // Room members preparation never touches. Reached only by a caller that should not.
        override fun observeSongs(): Flow<List<SongEntity>> = flowOf(listOf(row))
        override fun observeSong(id: Long): Flow<SongEntity?> = flowOf(row)
        override suspend fun insertSong(song: SongEntity): Long = unexpected("insertSong")
        override fun observeLines(songId: Long): Flow<List<LineEntity>> = flowOf(emptyList())
        override fun observeAnchors(songId: Long): Flow<List<AnchorEntity>> = flowOf(pins)
        override suspend fun deleteLines(songId: Long) = unexpected("deleteLines")
        override suspend fun insertLines(lines: List<LineEntity>) = unexpected("insertLines")
        override suspend fun anchorOn(songId: Long, lineIndex: Int): AnchorEntity? =
            pins.firstOrNull { it.lineIndex == lineIndex }
        override suspend fun insertRun(run: AlignmentRunEntity): Long = unexpected("insertRun")
        override suspend fun resetInterruptedLookups() = unexpected("resetInterruptedLookups")
        override fun observeLineCounts(): Flow<List<LineCounts>> = flowOf(emptyList())

        private fun unexpected(name: String): Nothing =
            throw AssertionError("preparation must not call $name")
    }

    private class StubHttp(private val answers: Map<String, HttpResponse>) : HttpGet {
        val urls = mutableListOf<String>()
        var onRequest: () -> Unit = {}

        override suspend fun get(url: String, userAgent: String): HttpResponse {
            urls += url
            onRequest()
            return answers[endpointOf(url)]
                ?: throw AssertionError("no scripted answer for ${endpointOf(url)}")
        }

        companion object {
            fun endpointOf(url: String): String = url.substringBefore('?').substringAfterLast('/')
        }
    }

    private fun json(body: String, code: Int = 200) =
        HttpResponse(code, "application/json", body, null)

    private fun lrclib(http: HttpGet) =
        Lrclib(http, versionName = "9.9.9", sleep = { }, jitter = { 0 })

    private fun song(
        title: String = "Placeholder",
        artist: String = "Nobody",
        durationMs: Long? = 100_000,
    ) = SongEntity(
        id = 7,
        title = title,
        artist = artist,
        audioUri = "content://x",
        durationMs = durationMs,
        createdAtMs = 0,
    )

    private fun record(
        synced: String? = null,
        plain: String? = null,
        instrumental: Boolean = false,
        trackName: String = "Placeholder",
        artistName: String = "Nobody",
    ) = """
        {"id":42,"trackName":"$trackName","artistName":"$artistName","albumName":"Album",
         "duration":100,"instrumental":$instrumental,
         "plainLyrics":${plain.jsonOrNull()},"syncedLyrics":${synced.jsonOrNull()}}
    """.trimIndent()

    @Test fun `a synced record stores timed lines and marks the song done`() {
        val dao = FakeDao(song())
        val http = StubHttp(mapOf("get" to json(record(synced = "[00:01.00]one\n[00:03.50]two"))))
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }

        assertEquals(PrepareOutcome.Synced(2), outcome)
        val lines = dao.replaceLinesCalls.single()
        assertEquals(listOf(0, 1), lines.map { it.lineIndex })
        assertEquals(listOf("one", "two"), lines.map { it.text })
        assertEquals(listOf(1_000L, 3_500L), lines.map { it.startMs })
        // Each line ends where the next begins; the last has no end.
        assertEquals(listOf(3_500L, null), lines.map { it.endMs })
        assertEquals("done", dao.current.prepareState)
        assertEquals(listOf("lrclib"), dao.lyricsSources)
    }

    @Test fun `a plain record stores untimed lines`() {
        val dao = FakeDao(song())
        val http = StubHttp(mapOf("get" to json(record(plain = "one\ntwo\nthree"))))
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }

        assertEquals(PrepareOutcome.WordsOnly(3), outcome)
        val lines = dao.replaceLinesCalls.single()
        assertEquals(listOf("one", "two", "three"), lines.map { it.text })
        assertTrue(lines.all { it.startMs == null && it.endMs == null })
        assertEquals("done", dao.current.prepareState)
    }

    @Test fun `an instrumental record stores no lines and reports NotFound`() {
        val dao = FakeDao(song())
        // Valid lyric fields with the flag set: only the flag can make this NotFound.
        val body = record(synced = "[00:01.00]one", plain = "one", instrumental = true)
        val http = StubHttp(mapOf("get" to json(body)))
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }

        assertEquals(PrepareOutcome.NotFound(LookupOutcome.NO_ENTRY), outcome)
        assertTrue(dao.replaceLinesCalls.isEmpty())
        // The service answered: there is simply nothing to take. Not a failure to reach it.
        assertEquals("no-match", dao.current.prepareState)
        assertTrue(dao.lyricsSources.isEmpty())
    }

    @Test fun `a 404 falls through to search and returns NeedsChoice`() {
        val dao = FakeDao(song())
        val http = StubHttp(
            mapOf(
                "get" to json("""{"statusCode":404}""", code = 404),
                "search" to json("[${record(synced = "[00:01.00]one")}]"),
            ),
        )
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }

        assertEquals(listOf(42L), (outcome as PrepareOutcome.NeedsChoice).candidates.map { it.id })
        // No lyrics are stored on a guess: the user picks (no matching threshold, rule 2).
        assertTrue(dao.replaceLinesCalls.isEmpty())
        assertEquals(listOf("get", "search"), http.urls.map { StubHttp.endpointOf(it) })
        // The service answered and there are results waiting; "failed" here would be a lie.
        assertEquals(listOf("fetching", "no-match"), dao.states)
    }

    @Test fun `a 404 with no candidates returns NotFound(NO_ENTRY)`() {
        val dao = FakeDao(song())
        val http = StubHttp(
            mapOf(
                "get" to json("""{"statusCode":404}""", code = 404),
                "search" to json("[]"),
            ),
        )
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }

        assertEquals(PrepareOutcome.NotFound(LookupOutcome.NO_ENTRY), outcome)
        assertTrue(dao.replaceLinesCalls.isEmpty())
        assertEquals("no-match", dao.current.prepareState)
    }

    @Test fun `an offline rung 1 does not go on to search`() {
        val dao = FakeDao(song())
        val http = object : HttpGet {
            var calls = 0
            override suspend fun get(url: String, userAgent: String): HttpResponse {
                calls++
                throw java.io.IOException("no network")
            }
        }
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }

        assertEquals(PrepareOutcome.NotFound(LookupOutcome.OFFLINE), outcome)
        assertEquals(1, http.calls)
    }

    @Test fun `a song with no title is not looked up`() {
        for (blank in listOf("", "   ")) {
            val dao = FakeDao(song(title = blank))
            val http = StubHttp(emptyMap())
            val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }
            assertEquals(PrepareOutcome.NotFound(LookupOutcome.NO_ENTRY), outcome)
            assertTrue(http.urls.isEmpty())
            assertTrue(dao.replaceLinesCalls.isEmpty())
        }
    }

    /**
     * `/api/get` requires both names, so a blank artist cannot match there; the ladder goes
     * straight to `/api/search` and lets the user's eye decide.
     */
    @Test fun `a song with no artist skips rung 1 and searches`() {
        val dao = FakeDao(song(artist = ""))
        val http = StubHttp(mapOf("search" to json("[${record()}]")))
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }

        assertEquals(listOf("search"), http.urls.map { StubHttp.endpointOf(it) })
        assertEquals(listOf(42L), (outcome as PrepareOutcome.NeedsChoice).candidates.map { it.id })
        // A blank artist is never sent as an empty parameter.
        assertTrue(http.urls.single(), !http.urls.single().contains("artist_name="))
    }

    @Test fun `the duration is sent, rounded to whole seconds`() {
        val dao = FakeDao(song(durationMs = 256_600))
        val http = StubHttp(mapOf("get" to json(record(plain = "one"))))
        runBlocking { prepareSong(dao, lrclib(http), dao.current) }
        assertTrue("sent ${http.urls.single()}", http.urls.single().contains("duration=257"))
    }

    @Test fun `a song with no duration sends none`() {
        val dao = FakeDao(song(durationMs = null))
        val http = StubHttp(mapOf("get" to json(record(plain = "one"))))
        runBlocking { prepareSong(dao, lrclib(http), dao.current) }
        assertTrue(!http.urls.single().contains("duration="))
    }

    // ---- The pin guarantee (ADR-0002). ----

    @Test fun `a song with a user pin is not re-sheeted`() {
        val pin = AnchorEntity(songId = 7, lineIndex = 3, timeMs = 9_000, source = "user")
        val dao = FakeDao(song(), pins = listOf(pin))
        val http = StubHttp(mapOf("get" to json(record(synced = "[00:01.00]one"))))
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }

        assertEquals(PrepareOutcome.RefusedHasPins, outcome)
        // Anchors are keyed by line index, so re-splitting the sheet would silently move the
        // pin onto different words. Both halves must hold: no line write AND no anchor touched.
        assertTrue(dao.replaceLinesCalls.isEmpty())
        assertTrue(dao.deletedAnchors.isEmpty())
        assertTrue(dao.anchorWrites.isEmpty())
        // It does not even ask: a refusal costs no request.
        assertTrue(http.urls.isEmpty())
        assertEquals("pending", dao.current.prepareState)
    }

    @Test fun `an auto anchor does not stop preparation`() {
        val auto = AnchorEntity(songId = 7, lineIndex = 3, timeMs = 9_000, source = "auto")
        val dao = FakeDao(song(), pins = listOf(auto))
        val http = StubHttp(mapOf("get" to json(record(synced = "[00:01.00]one"))))
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }

        assertEquals(PrepareOutcome.Synced(1), outcome)
        assertEquals(1, dao.replaceLinesCalls.size)
    }

    @Test fun `allowReplaceSheet lets the user go ahead, and still writes no anchor`() {
        val pin = AnchorEntity(songId = 7, lineIndex = 3, timeMs = 9_000, source = "user")
        val dao = FakeDao(song(), pins = listOf(pin))
        val http = StubHttp(mapOf("get" to json(record(synced = "[00:01.00]one\n[00:02.00]two"))))
        val outcome = runBlocking {
            prepareSong(dao, lrclib(http), dao.current, allowReplaceSheet = true)
        }

        assertEquals(PrepareOutcome.Synced(2), outcome)
        assertEquals(1, dao.replaceLinesCalls.size)
        assertTrue(dao.anchorWrites.isEmpty())
        assertTrue(dao.deletedAnchors.isEmpty())
    }

    @Test fun `adopting a track writes no anchor`() {
        // The pin is on line 0 and the sheet has three lines, so an implementation that stored
        // the record's own timings as anchors would be caught on lines 1 and 2 even though
        // upsertAuto refuses line 0.
        val pin = AnchorEntity(songId = 7, lineIndex = 0, timeMs = 500, source = "user")
        val dao = FakeDao(song(), pins = listOf(pin))
        val track = parseTrack(record(synced = "[00:01.00]one\n[00:02.00]two\n[00:03.00]three"))!!
        runBlocking { adoptTrack(dao, 7, track) }

        assertEquals(1, dao.replaceLinesCalls.size)
        assertTrue(dao.anchorWrites.isEmpty())
        assertTrue(dao.deletedAnchors.isEmpty())
    }

    // ---- The setting, and the state column. ----

    @Test fun `fetching is skipped and recorded as off when the setting is disabled`() {
        val dao = FakeDao(song())
        val http = StubHttp(emptyMap())
        val outcome = runBlocking {
            prepareSong(dao, lrclib(http), dao.current, fetchEnabled = false)
        }

        assertEquals(PrepareOutcome.Disabled, outcome)
        assertTrue(http.urls.isEmpty())
        assertEquals(listOf("off"), dao.states)
        assertTrue(dao.replaceLinesCalls.isEmpty())
    }

    @Test fun `prepareState is fetching during the call and done or no-match after`() {
        val dao = FakeDao(song())
        val http = StubHttp(mapOf("get" to json(record(synced = "[00:01.00]one"))))
        var stateWhenAsked: String? = null
        http.onRequest = { stateWhenAsked = dao.current.prepareState }
        runBlocking { prepareSong(dao, lrclib(http), dao.current) }
        assertEquals("fetching", stateWhenAsked)
        assertEquals(listOf("fetching", "done"), dao.states)

        val failing = FakeDao(song())
        val miss = StubHttp(
            mapOf(
                "get" to json("""{"statusCode":404}""", code = 404),
                "search" to json("[]"),
            ),
        )
        runBlocking { prepareSong(failing, lrclib(miss), failing.current) }
        assertEquals(listOf("fetching", "no-match"), failing.states)
    }

    /**
     * The split that stops "Couldn't reach LRCLIB" being shown when LRCLIB answered. A test
     * asserting merely "not done" would pass either way, so the exact value is asserted.
     */
    @Test fun `a service that answered with nothing is no-match, not failed`() {
        val dao = FakeDao(song())
        val http = StubHttp(
            mapOf(
                "get" to json("""{"statusCode":404}""", code = 404),
                "search" to json("[]"),
            ),
        )
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }
        assertEquals(PrepareOutcome.NotFound(LookupOutcome.NO_ENTRY), outcome)
        assertEquals("no-match", dao.current.prepareState)
    }

    @Test fun `a service that could not be reached is failed, not no-match`() {
        val dao = FakeDao(song())
        val http = object : HttpGet {
            override suspend fun get(url: String, userAgent: String): HttpResponse =
                throw java.io.IOException("no network")
        }
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }
        assertEquals(PrepareOutcome.NotFound(LookupOutcome.OFFLINE), outcome)
        // A retry is sensible here, and only "failed" says so.
        assertEquals("failed", dao.current.prepareState)
    }

    @Test fun `a rate-limited lookup is failed, not no-match`() {
        val dao = FakeDao(song())
        val http = StubHttp(
            mapOf("get" to HttpResponse(429, "application/json", """{"statusCode":429}""", 86_400)),
        )
        val outcome = runBlocking { prepareSong(dao, lrclib(http), dao.current) }
        assertEquals(PrepareOutcome.NotFound(LookupOutcome.RATE_LIMITED), outcome)
        assertEquals("failed", dao.current.prepareState)
    }

    @Test fun `a song with no title is no-match, since no query could be formed`() {
        val dao = FakeDao(song(title = ""))
        val http = StubHttp(emptyMap())
        runBlocking { prepareSong(dao, lrclib(http), dao.current) }
        assertTrue(http.urls.isEmpty())
        assertEquals(listOf("no-match"), dao.states)
    }

    @Test fun `a no-artist song whose search finds candidates is no-match`() {
        val dao = FakeDao(song(artist = ""))
        val http = StubHttp(mapOf("search" to json("[${record()}]")))
        runBlocking { prepareSong(dao, lrclib(http), dao.current) }
        assertEquals(listOf("fetching", "no-match"), dao.states)
    }

    // ---- Filling in what the file did not say. ----

    @Test fun `adopting fills a blank artist from the record`() {
        val dao = FakeDao(song(artist = ""))
        val track = parseTrack(record(plain = "one", artistName = "Someone"))!!
        runBlocking { adoptTrack(dao, 7, track) }
        assertEquals(listOf("Placeholder" to "Someone"), dao.titleArtistWrites)
    }

    @Test fun `adopting never overwrites a name the file gave`() {
        val dao = FakeDao(song(title = "File Title", artist = "File Artist"))
        val track = parseTrack(record(plain = "one", trackName = "Other", artistName = "Other"))!!
        runBlocking { adoptTrack(dao, 7, track) }
        assertTrue(dao.titleArtistWrites.isEmpty())
        assertEquals("File Title", dao.current.title)
        assertEquals("File Artist", dao.current.artist)
    }

    @Test fun `adopting nothing usable leaves the lyrics source alone`() {
        val dao = FakeDao(song())
        val track = parseTrack(record(instrumental = true))!!
        val outcome = runBlocking { adoptTrack(dao, 7, track) }
        assertEquals(PrepareOutcome.NotFound(LookupOutcome.NO_ENTRY), outcome)
        assertNull(dao.current.lyricsSource)
    }
}

private fun String?.jsonOrNull(): String =
    if (this == null) "null" else "\"${replace("\n", "\\n")}\""
