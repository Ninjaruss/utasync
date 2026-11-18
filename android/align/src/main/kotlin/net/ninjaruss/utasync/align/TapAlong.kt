package net.ninjaruss.utasync.align

/**
 * Times a song by tapping once at the start of each line while it plays. Pure logic, no Android
 * types. Every accepted tap becomes a USER [TimingAnchor] (seconds; the caller converts to the
 * milliseconds that storage uses). A rejected tap consumes no line, so an accidental double-tap
 * cannot push every later line off by one.
 *
 * Partial sessions are deliberate: saving writes anchors for the tapped lines only. Untapped lines
 * keep whatever anchors they already had; if those now sit out of order against the new taps,
 * [applyAnchors] (the resolver) is what reconciles them, not this class. Tapped lines REPLACE any
 * existing anchor for that line, including a nudged one; [countReplaced] lets the UI say so first.
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

    /** Raw accepted tap times in ms, in line order. Lets a caller persist the session across rotation. */
    val tapTimesMs: List<Long> get() = times.toList()

    /** Removes exactly the most recent tap; no-op when there is none. */
    fun undoLast() {
        if (times.isNotEmpty()) times.removeAt(times.lastIndex)
    }

    companion object {
        /** Rebuilds a session by replaying [timesMs] through [tap], so every invariant still holds. */
        fun fromTimes(lineCount: Int, timesMs: List<Long>): TapSession =
            TapSession(lineCount).also { s -> timesMs.forEach { s.tap(it) } }

        /**
         * Minimum spacing between accepted taps. A judgement, not a measurement (ledger L46): above
         * the usual gap between the two taps of an accidental double-tap, below any real gap between
         * sung lines.
         */
        const val DEBOUNCE_MS = 250L
    }
}

/** How many of [taps] would overwrite a line that already has a user anchor ([userAnchoredLines]). */
fun countReplaced(taps: List<TimingAnchor>, userAnchoredLines: Set<Int>): Int =
    taps.count { it.lineIndex in userAnchoredLines }
