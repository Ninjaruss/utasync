package net.ninjaruss.utasync.align

/** One timed row of an LRC file. Rows with empty text (instrumental markers) are dropped. */
data class LrcLine(val timeSec: Double, val text: String)

private val TIME_TAG = Regex("""\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)]""")
private val OFFSET_TAG = Regex("""^\[offset:\s*([+-]?\d+)\s*]""", RegexOption.IGNORE_CASE)

/**
 * Parses line-level LRC. Handles several time tags on one row (`[00:12.00][01:30.00]text`,
 * used for repeated choruses), the `[offset:±ms]` tag (positive = lyrics shown earlier),
 * and ignores metadata tags such as `[ar:…]`. Enhanced word tags (`<mm:ss.xx>`) are
 * stripped from the text. The result is sorted by time.
 */
fun parseLrc(source: String): List<LrcLine> {
    var offsetSec = 0.0
    val rows = mutableListOf<LrcLine>()
    for (raw in source.lineSequence()) {
        val line = raw.trim()
        OFFSET_TAG.find(line)?.let { offsetSec = it.groupValues[1].toDouble() / 1000.0 }
        var rest = line
        val times = mutableListOf<Double>()
        while (true) {
            val m = TIME_TAG.matchAt(rest, 0) ?: break
            val minutes = m.groupValues[1].toDouble()
            val seconds = m.groupValues[2].replace(':', '.').toDouble()
            times += minutes * 60 + seconds
            rest = rest.substring(m.range.last + 1)
        }
        if (times.isEmpty()) continue
        val text = rest.replace(Regex("""<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>"""), "").trim()
        if (text.isEmpty()) continue
        for (t in times) rows += LrcLine((t - offsetSec).coerceAtLeast(0.0), text)
    }
    return rows.sortedBy { it.timeSec }
}
