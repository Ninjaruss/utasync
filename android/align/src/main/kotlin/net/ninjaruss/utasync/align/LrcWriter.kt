package net.ninjaruss.utasync.align

/** [text] is a plain LRC file; [droppedLines] counts the rows that had no time and were left out. */
data class LrcExport(val text: String, val droppedLines: Int)

/**
 * Writes line-level LRC from `(startMs, text)` rows, in the order given.
 *
 * The times must be the resolved ones (pins already folded in), so no `[offset:]` tag and no
 * metadata tags are written: an offset would double-count corrections that are already in the
 * times. Rows with a null time cannot be placed in a timed file and are counted, not written.
 * Times round to the nearest centisecond; minutes are not capped at 59, so a long track stays
 * correct (`[62:03.00]`). A line break inside a row's text becomes a space, since it would
 * otherwise split the row.
 */
fun writeLrc(rows: List<Pair<Long?, String>>): LrcExport {
    var dropped = 0
    val out = mutableListOf<String>()
    for ((ms, text) in rows) {
        if (ms == null) {
            dropped++
            continue
        }
        val cs = (ms.coerceAtLeast(0L) + 5) / 10
        val minutes = cs / 6000
        val seconds = cs % 6000 / 100
        val hundredths = cs % 100
        val tag = String.format(java.util.Locale.ROOT, "[%02d:%02d.%02d]", minutes, seconds, hundredths)
        out += tag + text.replace(Regex("""\s*[\r\n]+\s*"""), " ")
    }
    return LrcExport(out.joinToString("\n"), dropped)
}
