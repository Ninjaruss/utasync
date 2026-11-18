package net.ninjaruss.utasync.ui

/**
 * The span a "repeat this line" loop plays: from the line's start to the next TIMED line's
 * start (inclusive), or to [durationMs] for the last timed line. Ends are implied, never
 * stored, so a line that ends on a held note before an instrumental passage runs through
 * that silence; that is the accepted cost of one-timestamp-per-line, not a bug.
 *
 * A line with no start (or an index out of range) has no range: [LongRange.EMPTY].
 * Untimed lines in between are skipped when looking for the next start.
 */
fun repeatRange(startsMs: List<Long?>, lineIndex: Int, durationMs: Long): LongRange {
    val start = startsMs.getOrNull(lineIndex) ?: return LongRange.EMPTY
    val next = (lineIndex + 1 until startsMs.size).firstNotNullOfOrNull { startsMs[it] } ?: durationMs
    return if (next > start) start..next else LongRange.EMPTY
}
