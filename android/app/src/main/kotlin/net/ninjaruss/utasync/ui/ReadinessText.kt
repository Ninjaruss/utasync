package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.data.Readiness

/** One line for a library row; null when there is nothing to add (the caller shows the artist). */
fun libraryStatus(readiness: Readiness): String? = when (readiness) {
    Readiness.FETCHING -> "Finding lyrics…"
    Readiness.NO_LYRICS -> "No lyrics yet"
    Readiness.NO_MATCH -> "No lyrics found"
    Readiness.FETCH_FAILED -> "Couldn't reach LRCLIB"
    Readiness.RATE_LIMITED -> "LRCLIB asked us to wait"
    Readiness.WORDS_ONLY -> "Words only — not timed yet"
    Readiness.SINGABLE -> null
}

/**
 * What the player says for a song with no lines at all. [Readiness.NO_MATCH] says LRCLIB had
 * nothing; [Readiness.FETCH_FAILED] says it could not be reached; [Readiness.RATE_LIMITED] says it
 * was reached and asked us to wait. No two of them may share a text.
 */
fun emptyPlayerMessage(readiness: Readiness): String = when (readiness) {
    Readiness.FETCHING -> "Finding lyrics…"
    Readiness.NO_MATCH ->
        "No lyrics found for this song. Tap Lyrics… to search, paste the words, or import an .lrc."
    Readiness.FETCH_FAILED -> "Couldn't reach LRCLIB, so no lyrics were looked up."
    Readiness.RATE_LIMITED -> "LRCLIB asked us to wait — try again in a minute."
    else -> "No lyrics yet. Tap Lyrics… to search, paste the words, or import an .lrc."
}

/**
 * The one button a player with no lines offers, or null for none. Every action opens the lyrics
 * screen, which searches on request whatever the automatic-lookup setting says — so the label is
 * true even with lookup switched off, which is what the button for [Readiness.FETCH_FAILED] used
 * to get wrong (it started a lookup that immediately returned "disabled" and did nothing).
 *
 * [Readiness.RATE_LIMITED] deliberately gets **no** button. LRCLIB asked the client to wait, and
 * this client has no API key, so its only identity is its IP address: retrying early risks a ban
 * that would cost the user every later lookup (ledger L51). The message says to wait instead.
 */
fun emptyPlayerAction(readiness: Readiness): String? = when (readiness) {
    Readiness.FETCH_FAILED -> "Try again"
    // Also covers lookup switched off, and a song nothing has been attempted for yet.
    Readiness.NO_LYRICS -> "Find lyrics"
    // FETCHING (a lookup is running), NO_MATCH (the lyrics screen is named in the message, and
    // asking again would change nothing), RATE_LIMITED (see above), and the two states a song
    // with no lines cannot be in.
    else -> null
}

const val WORDS_ONLY_NOTICE = "These lyrics are not timed yet, so nothing is highlighted."
