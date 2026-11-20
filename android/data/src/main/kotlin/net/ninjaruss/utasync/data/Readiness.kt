package net.ninjaruss.utasync.data

/**
 * Where a song is on the way to being singable, as the user should be told it.
 *
 * [NO_MATCH], [FETCH_FAILED] and [RATE_LIMITED] are deliberately separate. [NO_MATCH] means the
 * service answered and has nothing usable, so the user must act (search or paste). [FETCH_FAILED]
 * means the service was not reached, so a retry is worth a tap. [RATE_LIMITED] means LRCLIB WAS
 * reached and asked the client to wait: "couldn't reach LRCLIB" would be false, and a retry is the
 * one thing not to offer, because this client's only identity is its IP address (ledger L51).
 * Merging any two of them would make one of their messages false.
 */
enum class Readiness { FETCHING, NO_LYRICS, NO_MATCH, FETCH_FAILED, RATE_LIMITED, WORDS_ONLY, SINGABLE }

/**
 * Derives readiness from what has been **attempted** ([prepareState], see
 * [SongEntity.prepareState]) and what the lines actually **contain**. Lines win once they exist:
 * a song with lines is never [Readiness.NO_MATCH], [Readiness.FETCH_FAILED],
 * [Readiness.RATE_LIMITED] or [Readiness.FETCHING], whatever the state says, because the state
 * describes an attempt, not the result the user is looking at.
 *
 * [Readiness.FETCHING] used to outrank the line branches, which meant a partly timed song got its
 * highlight back for as long as a lookup was in flight — the no-highlight-unless-fully-timed rule
 * broken by a label. It is now ranked below them: a lookup running over a song that is already
 * singable does not take its highlight away either.
 *
 * [timedLineCount] is a count of lines that have a time. A partly timed song is not singable.
 */
fun readinessOf(prepareState: String, lineCount: Int, timedLineCount: Int): Readiness {
    if (lineCount > 0) {
        return if (timedLineCount >= lineCount) Readiness.SINGABLE else Readiness.WORDS_ONLY
    }
    // Every state is named here on purpose. The `else` cannot be removed (these are strings, not
    // an enum), but nothing in the vocabulary may reach it: a state added to [PrepareState] and
    // forgotten here would silently read as "No lyrics yet", which is the dishonest-label failure
    // this app exists not to repeat. `ReadinessTest` derives its domain from [PrepareState.ALL].
    return when (prepareState) {
        PrepareState.FETCHING -> Readiness.FETCHING
        PrepareState.FAILED -> Readiness.FETCH_FAILED
        PrepareState.NO_MATCH -> Readiness.NO_MATCH
        PrepareState.RATE_LIMITED -> Readiness.RATE_LIMITED
        // Nothing has been tried, or nothing is stored. None of these is a failure.
        PrepareState.PENDING, PrepareState.OFF, PrepareState.DONE -> Readiness.NO_LYRICS
        // A string from outside the vocabulary is a bug elsewhere, and the safest thing to say
        // about a song we know nothing about is that it has no lyrics yet.
        else -> Readiness.NO_LYRICS
    }
}
