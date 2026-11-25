package net.ninjaruss.utasync.align

/**
 * Lines whose start lies past the end of the audio they are stored against.
 *
 * [count] of them, the earliest at [firstStartMs], against an audio file of [audioDurationMs].
 */
data class PastEnd(val count: Int, val firstStartMs: Long, val audioDurationMs: Long)

/**
 * The one thing that can be said about whether a timed sheet belongs to a given audio file
 * without listening to it: **a line cannot start after the file ends.** Null means there is
 * nothing to object to — which is not a claim that the timings are right.
 *
 * There is deliberately no tolerance. A tolerance would be a threshold gating behaviour, which
 * rule 2 would want measured, and there is nothing to measure: the statement is arithmetic. The
 * cost of having none was measured instead — of 105 real LRCLIB records checked against their own
 * declared length, none has a line past the end, so a strict comparison cried wolf on none of
 * them (ledger L66).
 *
 * What this does NOT catch is the failure that matters more. A record for a cut that differs from
 * the user's file by under 30 s is caught 13% of the time; the same screen measured that a
 * trailing-gap and a span-ratio test cannot close that hole at any usable false-alarm rate
 * (L66, `experiments/fit/`). So nothing built on this may say the fit has been *verified*. It can
 * only say when the sheet is impossible.
 */
fun pastEndLines(startsMs: List<Long>, audioDurationMs: Long?): PastEnd? {
    if (audioDurationMs == null || audioDurationMs <= 0L) return null
    val past = startsMs.filter { it > audioDurationMs }
    if (past.isEmpty()) return null
    return PastEnd(count = past.size, firstStartMs = past.min(), audioDurationMs = audioDurationMs)
}
