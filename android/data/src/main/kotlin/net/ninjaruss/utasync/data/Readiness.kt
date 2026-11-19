package net.ninjaruss.utasync.data

/**
 * Where a song is on the way to being singable, as the user should be told it.
 *
 * [NO_MATCH] and [FETCH_FAILED] are deliberately separate. [NO_MATCH] means the service
 * answered and has nothing usable, so the user must act (search or paste). [FETCH_FAILED] means
 * the service was not reached, so a retry is worth a tap. Merging them would make one of the
 * two messages false.
 */
enum class Readiness { FETCHING, NO_LYRICS, NO_MATCH, FETCH_FAILED, WORDS_ONLY, SINGABLE }

/**
 * Derives readiness from what has been **attempted** ([prepareState], see
 * [SongEntity.prepareState]) and what the lines actually **contain**. Lines win once they exist:
 * a song with lines is never [Readiness.NO_MATCH] or [Readiness.FETCH_FAILED], whatever the
 * state says, because the state describes an attempt, not the result the user is looking at.
 *
 * [timedLineCount] is a count of lines that have a time. A partly timed song is not singable.
 */
fun readinessOf(prepareState: String, lineCount: Int, timedLineCount: Int): Readiness = when {
    prepareState == "fetching" -> Readiness.FETCHING
    lineCount > 0 && timedLineCount >= lineCount -> Readiness.SINGABLE
    lineCount > 0 -> Readiness.WORDS_ONLY
    prepareState == "failed" -> Readiness.FETCH_FAILED
    prepareState == "no-match" -> Readiness.NO_MATCH
    // "pending", "off" and "done"-with-no-lines: nothing has been tried, or nothing is stored.
    // None of them is a failure.
    else -> Readiness.NO_LYRICS
}
