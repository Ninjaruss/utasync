package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.prepare.LookupOutcome

/**
 * What the lyrics screen says when a lookup came back with no usable record, or null when there
 * is nothing to report (a found record is adopted, never described).
 *
 * The three answers are kept apart for the same reason `Readiness` keeps them apart. Only
 * [LookupOutcome.OFFLINE] and [LookupOutcome.ERROR] may say the service was not reached;
 * [LookupOutcome.RATE_LIMITED] means it **was** reached and asked the client to wait, so it says
 * so and asks for a minute rather than inviting an immediate retry: this client has no API key,
 * so its only identity is its IP address, and retrying against an explicit wait is how a keyless
 * client earns a longer ban that costs every later lookup (ledger L51).
 *
 * A pure function so it can be tested; it used to be an `if` inside the composable, where the
 * rate-limited case fell into the "couldn't reach LRCLIB" half and nothing could reach it.
 */
internal fun lookupFailureMessage(outcome: LookupOutcome): String? = when (outcome) {
    LookupOutcome.NO_ENTRY -> "LRCLIB has no lyrics for this song. Paste the words or import an .lrc."
    LookupOutcome.RATE_LIMITED ->
        "LRCLIB asked us to wait. Try again in a minute, or paste the words or import an .lrc."
    LookupOutcome.OFFLINE, LookupOutcome.ERROR ->
        "Couldn't reach LRCLIB. Try again, paste the words, or import an .lrc."
    // A found record is stored, so the screen closes instead of saying anything about it.
    LookupOutcome.FOUND -> null
}
