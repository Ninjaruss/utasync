package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.prepare.LookupOutcome

/**
 * What the lyrics screen says when a lookup came back with no usable record, or null when there
 * is nothing to report (a found record is adopted, never described).
 *
 * Each answer is kept apart from the others because each is a different statement about what
 * happened, and only one of them is "we could not reach LRCLIB":
 *  - [LookupOutcome.OFFLINE] is the only outcome where the service really was not reached: it
 *    comes from an `IOException`, i.e. no answer at all.
 *  - [LookupOutcome.ERROR] is LRCLIB **answering**. `outcomeOf` builds it from a 503, a 4xx, a
 *    5xx, or a 200 that was not JSON (`classify`) — in every one of those the server talked to
 *    us. Saying "couldn't reach LRCLIB" here was false, in the same way the rate-limited text
 *    was, one level deeper.
 *  - [LookupOutcome.RATE_LIMITED] means it was reached and asked the client to wait, so it says
 *    so and asks for a minute rather than inviting an immediate retry: this client has no API
 *    key, so its only identity is its IP address, and retrying against an explicit wait is how a
 *    keyless client earns a longer ban that costs every later lookup (ledger L51).
 *
 * A pure function so it can be tested; it used to be an `if` inside the composable, where the
 * rate-limited case fell into the "couldn't reach LRCLIB" half and nothing could reach it.
 */
internal fun lookupFailureMessage(outcome: LookupOutcome): String? = when (outcome) {
    LookupOutcome.NO_ENTRY -> "LRCLIB has no lyrics for this song. Paste the words or import an .lrc."
    LookupOutcome.RATE_LIMITED ->
        "LRCLIB asked us to wait. Try again in a minute, or paste the words or import an .lrc."
    LookupOutcome.OFFLINE -> "Couldn't reach LRCLIB. Try again, paste the words, or import an .lrc."
    LookupOutcome.ERROR ->
        "LRCLIB answered with an error. Try again, paste the words, or import an .lrc."
    // A found record is stored, so the screen closes instead of saying anything about it.
    LookupOutcome.FOUND -> null
}

/**
 * Whether the screen may offer another search after [lastOutcome] (null before the first one).
 *
 * False for [LookupOutcome.RATE_LIMITED] alone. The harm a keyless client does is the **request**,
 * not the label: LRCLIB cannot tell whether a request was the user's idea or the app's, and the
 * ban mechanism in L51 counts requests. Leaving the button live would also contradict the player,
 * where `emptyPlayerAction` already refuses a retry for exactly this state. A disabled button
 * beside the "asked us to wait" text is an honest pair, as it already is on the player.
 */
internal fun searchAllowed(lastOutcome: LookupOutcome?): Boolean =
    lastOutcome != LookupOutcome.RATE_LIMITED
