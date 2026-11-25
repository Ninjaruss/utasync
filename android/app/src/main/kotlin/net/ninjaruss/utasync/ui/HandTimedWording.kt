package net.ninjaruss.utasync.ui

/**
 * The one warning for replacing lines the user timed by hand, shared by every screen that can do
 * it (tap along, choosing or pasting lyrics): one voice for one concept.
 */
fun replaceHandTimedTitle(count: Int): String = "Replace $count hand-timed line${plural(count)}?"

/** The consequence sentence of that warning. */
fun handTimedLossNote(count: Int): String =
    "That cannot be undone; the hand-placed time${plural(count)} will be gone."

/** What the user is told they replace: "N line(s) you placed by hand". */
fun handPlacedLines(count: Int): String = "$count line${plural(count)} you placed by hand"

private fun plural(count: Int) = if (count == 1) "" else "s"
