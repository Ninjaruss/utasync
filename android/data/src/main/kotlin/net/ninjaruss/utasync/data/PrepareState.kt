package net.ninjaruss.utasync.data

/**
 * The whole vocabulary of [SongEntity.prepareState], in one place because every module writes it
 * and [readinessOf] reads it. [readinessOf] has to fall through to [Readiness.NO_LYRICS] for a
 * string it does not know, so a single mistyped literal in a single writer would turn a failure
 * into "No lyrics yet" — a confident, wrong label, with nothing to catch it. Spelling the states
 * once makes that misspelling a compile error instead.
 *
 * Room's `@Query` SQL cannot reference a Kotlin constant, so [SongDao.resetInterruptedLookups]
 * still spells two of these inline; `SongDaoStateVocabularyTest` ties those literals back here.
 */
object PrepareState {
    /** Nothing attempted yet. */
    const val PENDING = "pending"

    /** A lookup is in flight. */
    const val FETCHING = "fetching"

    /** The song has lyrics stored. */
    const val DONE = "done"

    /**
     * The service answered and has nothing this song can use automatically — no record, an
     * instrumental, or candidates only the user can choose among — or no query could be formed at
     * all. The user must act; an automatic retry would change nothing.
     */
    const val NO_MATCH = "no-match"

    /** The service could not be reached: offline or an error. A retry is sensible. */
    const val FAILED = "failed"

    /**
     * LRCLIB was reached and asked the client to wait (HTTP 429, or a `Retry-After` longer than
     * this client will hold). Separate from [FAILED] because the statement "couldn't reach
     * LRCLIB" would be false, and because the advice differs: wait, and do **not** offer a retry.
     * This client has no API key, so its only identity is its IP address (ledger L51).
     */
    const val RATE_LIMITED = "rate-limited"

    /** Automatic lookup is switched off, so nothing has been attempted. */
    const val OFF = "off"

    /**
     * Every value a row may hold. Tests derive their domain from this rather than listing states,
     * so a new state is covered the day it is added.
     */
    val ALL = listOf(PENDING, FETCHING, DONE, NO_MATCH, FAILED, RATE_LIMITED, OFF)
}
