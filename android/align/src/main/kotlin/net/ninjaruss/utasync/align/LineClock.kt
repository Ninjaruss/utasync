package net.ninjaruss.utasync.align

/**
 * Index of the line being sung at [positionMs]: the last timed line whose start is at or
 * before the position, or -1 before the first line. Lines without a start (null) are never
 * active, so an untimed song highlights nothing (the PWA once highlighted its last line for
 * the whole song, ledger L27). Timed starts must be non-decreasing.
 */
fun activeLineIndex(startsMs: List<Long?>, positionMs: Long): Int {
    var best = -1
    var lo = 0
    var hi = startsMs.size - 1
    while (lo <= hi) {
        val mid = (lo + hi) ushr 1
        // Move mid to the nearest timed line at or before it; if none, search right.
        var probe = mid
        while (probe >= lo && startsMs[probe] == null) probe--
        if (probe < lo) { lo = mid + 1; continue }
        if (startsMs[probe]!! <= positionMs) { best = probe; lo = mid + 1 } else hi = probe - 1
    }
    return best
}
