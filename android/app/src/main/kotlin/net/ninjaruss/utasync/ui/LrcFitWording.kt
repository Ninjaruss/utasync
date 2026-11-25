package net.ninjaruss.utasync.ui

import kotlin.math.abs
import kotlin.math.roundToLong
import net.ninjaruss.utasync.align.PastEnd

/**
 * How the app talks about whether a lyric sheet belongs to this audio file.
 *
 * Both of these say only what arithmetic knows. Neither says the fit was checked, because it
 * cannot be: a record for a cut within 30 s of the user's file is caught 13% of the time, and no
 * threshold measured in `experiments/fit/` closes that hole (ledger L66). The one instrument that
 * settles it is the user pressing play, so the wording points there instead of reassuring.
 */

/** mm:ss, or h:mm:ss past an hour. Never "0:00" for an unknown. */
internal fun clock(ms: Long): String {
    val total = (ms / 1000.0).roundToLong().coerceAtLeast(0)
    val s = total % 60
    val m = (total / 60) % 60
    val h = total / 3600
    val mm = if (h > 0) m.toString().padStart(2, '0') else m.toString()
    return if (h > 0) "$h:$mm:${s.toString().padStart(2, '0')}" else "$mm:${s.toString().padStart(2, '0')}"
}

/**
 * The banner over a song whose sheet runs past the end of its audio. It states the fact, names the
 * likeliest cause and says what to do; it never offers to fix the timing, because nothing here can.
 */
fun pastEndWarning(past: PastEnd): String {
    val lines = if (past.count == 1) "1 line starts" else "${past.count} lines start"
    return "$lines after this file ends — the first at ${clock(past.firstStartMs)}, " +
        "and the file is ${clock(past.audioDurationMs)} long. These lyrics are probably timed for a " +
        "different version of the song. The words are still here; the times are not to be trusted."
}

/**
 * How a catalogue record's length compares with the user's file, for the line that tells
 * candidates apart. Information, not a verdict: there is no cut-off above which a record is
 * rejected and none below which it is endorsed, so every answer is a plain statement of the gap.
 *
 * Null when either length is unknown — the label already says "length unknown" in that case, and
 * a comparison with nothing to compare would be a guess.
 */
fun lengthComparison(recordDurationSec: Int?, audioDurationMs: Long?): String? {
    if (recordDurationSec == null || recordDurationSec <= 0) return null
    if (audioDurationMs == null || audioDurationMs <= 0L) return null
    val audioSec = (audioDurationMs / 1000.0).roundToLong()
    val diff = recordDurationSec - audioSec
    if (diff == 0L) return "same length as your file"
    val size = if (abs(diff) < 60) "${abs(diff)} s" else clock(abs(diff) * 1000)
    return if (diff > 0) "$size longer than your file" else "$size shorter than your file"
}
