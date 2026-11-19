package net.ninjaruss.utasync.prepare

import java.io.IOException
import kotlin.random.Random
import kotlinx.coroutines.delay

/** What one lookup ended in. A `/api/get` fills [track]; a `/api/search` fills [candidates]. */
data class LookupResult(
    val outcome: LookupOutcome,
    val track: LrclibTrack?,
    val candidates: List<LrclibTrack>,
)

/**
 * The two LRCLIB endpoints, with the retry policy applied. It decides nothing about which
 * record to use: it reports what the server said and hands the records on.
 *
 * [sleep] and [jitter] are injected so a test can observe the waits instead of serving them.
 */
class Lrclib(
    private val http: HttpGet,
    private val versionName: String,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val jitter: () -> Long = { Random.nextLong(0, 250) },
) {
    // One header for every request this instance makes; LRCLIB asks clients to identify
    // themselves, and there is one source of truth for the value.
    private val userAgent = userAgent(versionName)

    /** Rung 1: the exact match. The server applies its own +-2 s duration rule. */
    suspend fun get(q: TrackQuery): LookupResult = lookup(getUrl(q), pace = false) { body ->
        // A JSON 200 that is not a record (LRCLIB's error body) means there is no entry.
        parseTrack(body)
            ?.let { LookupResult(LookupOutcome.FOUND, it, emptyList()) }
            ?: LookupResult(LookupOutcome.NO_ENTRY, null, emptyList())
    }

    /** Rung 2: the fuzzy match, whose records the user chooses among. */
    suspend fun search(q: TrackQuery): LookupResult = lookup(searchUrl(q), pace = true) { body ->
        val tracks = parseTracks(body)
        if (tracks.isEmpty()) {
            LookupResult(LookupOutcome.NO_ENTRY, null, emptyList())
        } else {
            LookupResult(LookupOutcome.FOUND, null, tracks)
        }
    }

    /**
     * One lookup, retried per [retryDelayMs]. [pace] spaces this lookup's first request from a
     * request the ladder already made (search follows get); a retry needs no pacing because its
     * own backoff is longer than [PACING_DELAY_MS] and already spaces it.
     */
    private suspend fun lookup(
        url: String,
        pace: Boolean,
        parse: (String) -> LookupResult,
    ): LookupResult {
        if (pace) sleep(PACING_DELAY_MS)
        var attempt = 1
        while (true) {
            val response = try {
                http.get(url, userAgent)
            } catch (_: IOException) {
                // Not retried: a phone with no network will not have one half a second later.
                return LookupResult(LookupOutcome.OFFLINE, null, emptyList())
            }
            val reply = classify(response.code, response.contentType)
            if (reply == Reply.JSON) return parse(response.body)
            // A null delay means "do not retry", which includes a Retry-After longer than we
            // will hold. It is not success and not an absent record: report what the reply was,
            // so "rate limited" never reads as "this song has no lyrics".
            val delayMs = retryDelayMs(reply, response.retryAfterSec, attempt, jitter())
                ?: return LookupResult(outcomeOf(reply), null, emptyList())
            sleep(delayMs)
            attempt++
        }
    }
}
