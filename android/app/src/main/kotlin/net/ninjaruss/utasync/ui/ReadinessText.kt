package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.data.Readiness

/** One line for a library row; null when there is nothing to add (the caller shows the artist). */
fun libraryStatus(readiness: Readiness): String? = when (readiness) {
    Readiness.FETCHING -> "Finding lyrics…"
    Readiness.NO_LYRICS -> "No lyrics yet"
    Readiness.NO_MATCH -> "No lyrics found"
    Readiness.FETCH_FAILED -> "Couldn't reach LRCLIB"
    Readiness.WORDS_ONLY -> "Words only — not timed yet"
    Readiness.SINGABLE -> null
}

/**
 * What the player says for a song with no lines at all. [Readiness.NO_MATCH] says LRCLIB had
 * nothing; [Readiness.FETCH_FAILED] says it could not be reached. They must never share a text.
 */
fun emptyPlayerMessage(readiness: Readiness): String = when (readiness) {
    Readiness.FETCHING -> "Finding lyrics…"
    Readiness.NO_MATCH -> "No lyrics found for this song. Tap Lyrics… to load a synced .lrc file."
    Readiness.FETCH_FAILED -> "Couldn't reach LRCLIB, so no lyrics were looked up."
    else -> "No lyrics yet. Tap Lyrics… to load a synced .lrc file."
}

const val WORDS_ONLY_NOTICE = "These lyrics are not timed yet, so nothing is highlighted."
