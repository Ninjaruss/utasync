package net.ninjaruss.utasync.align

/**
 * Times a song by tapping once at the start of each line while it plays. Pure logic, no Android
 * types. Every accepted tap becomes a USER [TimingAnchor] (seconds; the caller converts to the
 * milliseconds that storage uses). A rejected tap consumes no line, so an accidental double-tap
 * cannot push every later line off by one.
 */
class TapSession(val lineCount: Int) {
    private val times = mutableListOf<Long>()

    /** Accepted taps so far, one per line, in line order. */
    val taps: List<TimingAnchor>
        get() = times.mapIndexed { i, ms -> TimingAnchor(i, ms / 1000.0, AnchorSource.USER) }

    /** The line the next accepted tap will time, or null once every line is timed. */
    val nextLine: Int? get() = times.size.takeIf { it < lineCount }

    /**
     * Returns the line index this tap timed, or null if rejected: all lines already timed, earlier
     * than the previous tap, or closer than [DEBOUNCE_MS] to it.
     */
    fun tap(atMs: Long): Int? {
        val line = nextLine ?: return null
        val prev = times.lastOrNull()
        if (prev != null && atMs - prev < DEBOUNCE_MS) return null // also covers atMs < prev
        times.add(atMs)
        return line
    }

    /** Removes exactly the most recent tap; no-op when there is none. */
    fun undoLast() {
        if (times.isNotEmpty()) times.removeAt(times.lastIndex)
    }

    companion object {
        /**
         * Minimum spacing between accepted taps. A judgement, not a measurement (ledger L46): above
         * the usual gap between the two taps of an accidental double-tap, below any real gap between
         * sung lines.
         */
        const val DEBOUNCE_MS = 250L
    }
}
