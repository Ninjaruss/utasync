package net.ninjaruss.utasync.align

/**
 * The audio window and text context used to refine one line against a prior.
 * [contextFrom]..[contextTo] are sheet line indices aligned together; [position] is the
 * target line's offset inside that context.
 */
data class AlignWindow(
    val lineIndex: Int,
    val startSec: Double,
    val endSec: Double,
    val contextFrom: Int,
    val contextTo: Int,
) {
    val position: Int get() = lineIndex - contextFrom
}

data class WindowParams(
    val leadSec: Double = 1.0,
    val tailSec: Double = 0.5,
    val maxWindowSec: Double = 30.0,
    val fallbackLineSec: Double = 3.0,
)

/**
 * Fills prior gaps by linear interpolation between known neighbours (or a fixed spacing at
 * the ends). Throws when fewer than two lines have a prior, because a window cannot be
 * placed from nothing.
 */
fun fillPrior(prior: List<Double?>, durationSec: Double, params: WindowParams = WindowParams()): DoubleArray {
    val known = prior.indices.filter { prior[it] != null }
    require(known.size >= 2) { "prior covers fewer than 2 lines" }
    return DoubleArray(prior.size) { i ->
        prior[i] ?: run {
            val a = known.lastOrNull { it < i }
            val b = known.firstOrNull { it > i }
            when {
                a == null -> maxOf(0.0, prior[b!!]!! - params.fallbackLineSec * (b - i))
                b == null -> minOf(durationSec - 1, prior[a]!! + params.fallbackLineSec * (i - a))
                else -> prior[a]!! + (prior[b]!! - prior[a]!!) * (i - a) / (b - a)
            }
        }
    }
}

/**
 * One window per line: from the previous line's prior start minus [WindowParams.leadSec] to
 * the start of the line after next plus [WindowParams.tailSec], aligning previous, target and
 * next line together. Windows come only from the prior, never from earlier alignment output,
 * so one bad line cannot cascade into the next. Mirrors `experiments/phase0/knownTextAlign.mjs`.
 */
fun planWindows(filledPrior: DoubleArray, durationSec: Double, params: WindowParams = WindowParams()): List<AlignWindow> {
    val n = filledPrior.size
    return (0 until n).map { i ->
        val a = maxOf(0, i - 1)
        val b = minOf(n - 1, i + 1)
        val after = if (b + 1 < n) filledPrior[b + 1] else minOf(durationSec, filledPrior[b] + 8.0)
        var t0 = maxOf(0.0, filledPrior[a] - params.leadSec)
        var t1 = minOf(durationSec, after + params.tailSec)
        var from = a
        if (t1 - t0 > params.maxWindowSec) {
            from = i
            t0 = maxOf(0.0, filledPrior[i] - 3.0)
            t1 = minOf(durationSec, t0 + params.maxWindowSec, after + params.tailSec)
        }
        if (t1 - t0 < 1.0) t1 = minOf(durationSec, t0 + 4.0)
        AlignWindow(lineIndex = i, startSec = t0, endSec = t1, contextFrom = from, contextTo = b)
    }
}
