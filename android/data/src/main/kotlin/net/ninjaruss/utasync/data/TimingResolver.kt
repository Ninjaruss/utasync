package net.ninjaruss.utasync.data

import net.ninjaruss.utasync.align.AnchorSource
import net.ninjaruss.utasync.align.TimingAnchor
import net.ninjaruss.utasync.align.applyAnchors
import kotlin.math.roundToLong

/** Smallest gap kept between two consecutive pinned starts in the resolved view. */
const val MIN_PIN_GAP_MS = 50L

/**
 * THE way to read a song's line timings. No screen may read [LineEntity.startMs] directly: that
 * value is only the latest COMPUTED time, and a screen that uses it silently ignores the user's
 * pins (ADR-0002: no re-alignment, re-fetch or version bump may overwrite a user's fix).
 *
 * Returns one start per entry of [lines] (same order; [lines] must be in ascending lineIndex
 * order), in milliseconds. A line with neither a pin nor a computed time stays null.
 *
 * Precedence, per line: a "user" anchor, then an "auto" anchor, then the computed time. The
 * database holds one anchor row per line, so a user-and-auto pair on one line cannot come from
 * stored data: [SongDao.upsertAuto] refuses to overwrite a user pin. The rule here is
 * defence in depth for a state the DAO must prevent, not a state it produces.
 * Anchors on line indexes that are not in [lines] (a shorter sheet after re-import) are ignored.
 *
 * Stored anchors are the source of truth and are NEVER changed by this function; it returns a
 * monotonic VIEW for playback and display. Where pins disagree about order, the view is repaired:
 *  - Among user pins, the EARLIER LINE wins and a later line whose pin is not at least
 *    [MIN_PIN_GAP_MS] after it is clamped forward to that. A user pin is never dropped.
 *  - An auto pin is kept only if it fits between its neighbouring pins; otherwise the view
 *    ignores it (it is a guess, not a correction).
 * "Earlier line wins" is a choice, not the only rule available. [AnchorEntity.writtenAtMs] now
 * records when each pin was written, so "the most recent correction wins" COULD be implemented
 * here. It deliberately is not, yet: which rule a user expects when two of their own pins cross
 * has not been observed, and switching would change resolved times with nothing measured to say
 * it is better (CLAUDE.md rule 2). Earlier-line-wins is kept because it is order-stable — the
 * view depends only on the pins, not on the sequence they were saved in — and because nothing
 * stored is changed, so a conflict is recoverable: re-nudging either line fixes it. The data to
 * change this rule exists from the day the first pin is written (ledger L45).
 *
 * Units: [applyAnchors] works in seconds, the database in milliseconds. This function is the
 * only place the two meet and converts both ways; seconds never leave it.
 */
fun resolveStarts(lines: List<LineEntity>, anchors: List<AnchorEntity>): List<Long?> {
    require(lines.zipWithNext().all { (a, b) -> a.lineIndex < b.lineIndex }) {
        "lines must be in strictly ascending lineIndex order"
    }
    val present = lines.map { it.lineIndex }.toSet()
    // One pin per line, user over auto. Pins on vanished lines are ignored.
    val byLine = anchors.filter { it.lineIndex in present }
        .groupBy { it.lineIndex }
        .mapValues { (_, l) -> l.firstOrNull { it.source == SOURCE_USER } ?: l.last() }
    val pins = monotonicPins(byLine)

    // Only lines with a time (computed or pinned) take part; the rest stay null.
    val timed = lines.indices.filter { lines[it].startMs != null || lines[it].lineIndex in pins }
    val position = timed.withIndex().associate { (pos, i) -> lines[i].lineIndex to pos }
    val resolved = applyAnchors(
        computed = timed.map { (pins[lines[it].lineIndex] ?: lines[it].startMs!!) / 1000.0 },
        anchors = pins.map { (line, ms) ->
            TimingAnchor(position.getValue(line), ms / 1000.0, AnchorSource.USER)
        },
        minGapSec = MIN_PIN_GAP_MS / 1000.0,
    )
    val out = arrayOfNulls<Long>(lines.size)
    for ((pos, i) in timed.withIndex()) out[i] = (resolved[pos] * 1000).roundToLong()
    return out.toList()
}

/** Pin times (ms) by line, made strictly increasing as described on [resolveStarts]. */
private fun monotonicPins(byLine: Map<Int, AnchorEntity>): Map<Int, Long> {
    val users = byLine.values.filter { it.source == SOURCE_USER }.sortedBy { it.lineIndex }
    val userTimes = HashMap<Int, Long>()
    var prev = Long.MIN_VALUE
    for (a in users) {
        val t = if (prev == Long.MIN_VALUE) a.timeMs else maxOf(a.timeMs, prev + MIN_PIN_GAP_MS)
        userTimes[a.lineIndex] = t
        prev = t
    }
    val out = sortedMapOf<Int, Long>()
    var last = Long.MIN_VALUE
    for (a in byLine.values.sortedBy { it.lineIndex }) {
        if (a.source == SOURCE_USER) {
            out[a.lineIndex] = userTimes.getValue(a.lineIndex); last = out.getValue(a.lineIndex)
            continue
        }
        val nextUser = users.firstOrNull { it.lineIndex > a.lineIndex }?.let { userTimes.getValue(it.lineIndex) }
        val fitsAfter = last == Long.MIN_VALUE || a.timeMs >= last + MIN_PIN_GAP_MS
        val fitsBefore = nextUser == null || a.timeMs + MIN_PIN_GAP_MS <= nextUser
        if (fitsAfter && fitsBefore) { out[a.lineIndex] = a.timeMs; last = a.timeMs }
    }
    return out
}

private const val SOURCE_USER = "user"
