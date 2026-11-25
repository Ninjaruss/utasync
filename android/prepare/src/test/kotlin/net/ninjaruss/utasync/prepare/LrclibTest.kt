package net.ninjaruss.utasync.prepare

import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * No lyric text anywhere in here: the bodies carry placeholder words and bare time tags
 * (rule 6 / ADR-0004).
 */
class LrclibTest {
    /** One scripted answer per attempt; `null` means "throw an IOException instead". */
    private class FakeHttp(private val answers: List<HttpResponse?>) : HttpGet {
        val urls = mutableListOf<String>()
        val userAgents = mutableListOf<String>()
        var onRequest: () -> Unit = {}

        override suspend fun get(url: String, userAgent: String): HttpResponse {
            urls += url
            userAgents += userAgent
            onRequest()
            val answer = answers.getOrNull(urls.size - 1)
                ?: throw IOException("no network")
            return answer
        }
    }

    private fun json(body: String, code: Int = 200, retryAfterSec: Int? = null) =
        HttpResponse(code, "application/json", body, retryAfterSec)

    private val query = TrackQuery(title = "Placeholder", artist = "Nobody", durationSec = 100)

    private val recordJson = """
        {"id":42,"trackName":"Placeholder","artistName":"Nobody","albumName":"Album",
         "duration":100,"instrumental":false,"plainLyrics":"la la","syncedLyrics":"[00:01.00]la"}
    """.trimIndent()

    private fun lrclib(http: FakeHttp, slept: MutableList<Long> = mutableListOf()) =
        Lrclib(http, versionName = "9.9.9", sleep = { slept += it }, jitter = { 0 })

    @Test fun `a 200 record is FOUND and carries the track`() {
        val http = FakeHttp(listOf(json(recordJson)))
        val result = runBlocking { lrclib(http).get(query) }
        assertEquals(LookupOutcome.FOUND, result.outcome)
        assertEquals(42L, result.track?.id)
        assertEquals(1, http.urls.size)
    }

    @Test fun `a 404 is NO_ENTRY with a null track and no retry`() {
        val slept = mutableListOf<Long>()
        val http = FakeHttp(listOf(json("""{"statusCode":404}""", code = 404)))
        val result = runBlocking { lrclib(http, slept).get(query) }
        assertEquals(LookupOutcome.NO_ENTRY, result.outcome)
        assertNull(result.track)
        assertEquals(1, http.urls.size)
        assertTrue(slept.isEmpty())
    }

    @Test fun `an IOException is OFFLINE`() {
        val slept = mutableListOf<Long>()
        val http = FakeHttp(listOf(null))
        val result = runBlocking { lrclib(http, slept).get(query) }
        assertEquals(LookupOutcome.OFFLINE, result.outcome)
        // A phone with no network will not have one 500 ms later, so it is not retried.
        assertEquals(1, http.urls.size)
        assertTrue(slept.isEmpty())
    }

    @Test fun `a 429 is retried after the Retry-After it was given, then gives up as RATE_LIMITED`() {
        val slept = mutableListOf<Long>()
        val rateLimited = json("""{"statusCode":429}""", code = 429, retryAfterSec = 2)
        val http = FakeHttp(List(MAX_ATTEMPTS) { rateLimited })
        val result = runBlocking { lrclib(http, slept).get(query) }
        assertEquals(LookupOutcome.RATE_LIMITED, result.outcome)
        assertEquals(MAX_ATTEMPTS, http.urls.size)
        // Exactly the wait the server asked for, twice: a shorter or computed wait fails here.
        assertEquals(listOf(2_000L, 2_000L), slept)
    }

    /**
     * A Retry-After longer than we will hold makes [retryDelayMs] return null, which is
     * "do not retry" and must NOT be read as a successful or absent answer.
     */
    @Test fun `an above-cap Retry-After is reported as RATE_LIMITED, not NO_ENTRY`() {
        val slept = mutableListOf<Long>()
        val http = FakeHttp(listOf(json("""{"statusCode":429}""", code = 429, retryAfterSec = 86_400)))
        val result = runBlocking { lrclib(http, slept).get(query) }
        assertEquals(LookupOutcome.RATE_LIMITED, result.outcome)
        assertEquals(1, http.urls.size)
        assertTrue(slept.isEmpty())
    }

    @Test fun `a busy server that will not be waited for is reported as ERROR`() {
        val http = FakeHttp(listOf(json("busy", code = 503, retryAfterSec = 86_400)))
        val result = runBlocking { lrclib(http).get(query) }
        assertEquals(LookupOutcome.ERROR, result.outcome)
    }

    // LRCLIB answers a malformed query in plain text, sometimes with a 200.
    @Test fun `a 200 of plain text is an ERROR and is not retried`() {
        val slept = mutableListOf<Long>()
        val http = FakeHttp(listOf(HttpResponse(200, "text/plain", "nope", null)))
        val result = runBlocking { lrclib(http, slept).get(query) }
        assertEquals(LookupOutcome.ERROR, result.outcome)
        assertEquals(1, http.urls.size)
        assertTrue(slept.isEmpty())
    }

    @Test fun `a 200 that is not a record is NO_ENTRY`() {
        val http = FakeHttp(listOf(json("""{"statusCode":404,"message":"x"}""")))
        val result = runBlocking { lrclib(http).get(query) }
        assertEquals(LookupOutcome.NO_ENTRY, result.outcome)
        assertNull(result.track)
    }

    @Test fun `search returns every candidate the array held`() {
        val array = """
            [$recordJson,
             {"id":43,"trackName":"Placeholder","artistName":"Nobody","duration":99,
              "instrumental":false,"plainLyrics":"la","syncedLyrics":null}]
        """.trimIndent()
        val http = FakeHttp(listOf(json(array)))
        val result = runBlocking { lrclib(http).search(query) }
        assertEquals(LookupOutcome.FOUND, result.outcome)
        assertEquals(listOf(42L, 43L), result.candidates.map { it.id })
    }

    @Test fun `an empty search array is NO_ENTRY with no candidates`() {
        val http = FakeHttp(listOf(json("[]")))
        val result = runBlocking { lrclib(http).search(query) }
        assertEquals(LookupOutcome.NO_ENTRY, result.outcome)
        assertTrue(result.candidates.isEmpty())
    }

    @Test fun `search paces its request`() {
        val slept = mutableListOf<Long>()
        val http = FakeHttp(listOf(json("[]")))
        // The pacing must happen BEFORE the request, not after it.
        var sleptWhenAsked = listOf<Long>()
        http.onRequest = { sleptWhenAsked = slept.toList() }
        runBlocking { lrclib(http, slept).search(query) }
        assertEquals(listOf(PACING_DELAY_MS), sleptWhenAsked)
    }

    /** Rung 1 is the first request of the ladder, so there is nothing to pace it against. */
    @Test fun `get does not pace its first request`() {
        val slept = mutableListOf<Long>()
        val http = FakeHttp(listOf(json(recordJson)))
        runBlocking { lrclib(http, slept).get(query) }
        assertTrue(slept.isEmpty())
    }

    @Test fun `the request carries the app user agent`() {
        val http = FakeHttp(listOf(json(recordJson)))
        runBlocking { lrclib(http).get(query) }
        assertEquals(listOf("Utasync/9.9.9 (https://github.com/Ninjaruss/utasync)"), http.userAgents)
    }

    @Test fun `get asks the get endpoint and search asks the search endpoint`() {
        val getHttp = FakeHttp(listOf(json(recordJson)))
        runBlocking { lrclib(getHttp).get(query) }
        assertEquals(getUrl(query), getHttp.urls.single())

        val searchHttp = FakeHttp(listOf(json("[]")))
        runBlocking { lrclib(searchHttp).search(query) }
        assertEquals(searchUrl(query), searchHttp.urls.single())
    }
}
