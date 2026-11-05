package net.ninjaruss.utasync.align

enum class AnchorSource { USER, AUTO }

/** A hard pin on a line's start time. User anchors survive every re-alignment. */
data class TimingAnchor(val lineIndex: Int, val timeSec: Double, val source: AnchorSource = AnchorSource.USER)

/**
 * Applies anchors to computed line starts. Anchored lines take the anchor time exactly.
 * Unanchored lines keep their computed time unless it would break order against the
 * nearest anchors, in which case they are spread evenly inside the gap between those
 * anchors. Lines between two unanchored neighbours are never moved here: re-aligning them
 * is the aligner's job, not this function's.
 */
fun applyAnchors(computed: List<Double>, anchors: List<TimingAnchor>, minGapSec: Double = 0.05): List<Double> {
    if (anchors.isEmpty()) return computed
    val pins = anchors.filter { it.lineIndex in computed.indices }
        .groupBy { it.lineIndex }
        .mapValues { (_, list) -> list.firstOrNull { it.source == AnchorSource.USER } ?: list.last() }
    val out = computed.toMutableList()
    for ((i, a) in pins) out[i] = a.timeSec
    val pinned = pins.keys.sorted()
    // segments: [start of song .. first pin], [pin .. pin], [last pin .. end of song]
    val bounds = listOf(-1) + pinned + listOf(computed.size)
    for (k in 0 until bounds.size - 1) {
        val lo = bounds[k]
        val hi = bounds[k + 1]
        if (hi - lo <= 1) continue
        val loT = if (lo >= 0) out[lo] else Double.NEGATIVE_INFINITY
        val hiT = if (hi < out.size) out[hi] else Double.POSITIVE_INFINITY
        val inside = (lo + 1 until hi)
        val violates = inside.any { out[it] <= loT || out[it] >= hiT } ||
            inside.zipWithNext().any { (x, y) -> out[x] >= out[y] }
        if (!violates) continue
        if (loT.isInfinite() || hiT.isInfinite()) {
            // open-ended segment: push lines just past the pin, keeping their order
            if (loT.isInfinite()) {
                var t = hiT
                for (i in inside.reversed()) { t = minOf(out[i], t - minGapSec); out[i] = maxOf(0.0, t) }
            } else {
                var t = loT
                for (i in inside) { t = maxOf(out[i], t + minGapSec); out[i] = t }
            }
        } else {
            val step = (hiT - loT) / (hi - lo)
            for ((n, i) in inside.withIndex()) out[i] = loT + step * (n + 1)
        }
    }
    return out
}
