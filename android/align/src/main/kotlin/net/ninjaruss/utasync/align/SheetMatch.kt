package net.ninjaruss.utasync.align

import java.text.Normalizer

/**
 * Maps each line of a lyric sheet to a time from LRC rows, monotonically, maximising total
 * text similarity (character-bigram overlap after NFKC normalisation). A sheet line with no
 * row at least [minSimilarity] similar gets `null`. Same algorithm as
 * `experiments/phase0/knownTextAlign.mjs` so desktop and device produce the same prior.
 */
fun matchSheetToLrc(sheet: List<String>, rows: List<LrcLine>, minSimilarity: Double = 0.5): List<Double?> {
    val n = sheet.size
    val m = rows.size
    val dp = Array(n + 1) { DoubleArray(m + 1) }
    val choice = Array(n + 1) { ByteArray(m + 1) }
    for (i in 1..n) for (j in 1..m) {
        var best = dp[i - 1][j]
        var c: Byte = 1
        if (dp[i][j - 1] > best) { best = dp[i][j - 1]; c = 2 }
        val s = bigramSimilarity(sheet[i - 1], rows[j - 1].text)
        if (s >= minSimilarity && dp[i - 1][j - 1] + s > best) { best = dp[i - 1][j - 1] + s; c = 3 }
        dp[i][j] = best
        choice[i][j] = c
    }
    val out = arrayOfNulls<Double>(n)
    var i = n
    var j = m
    while (i > 0 && j > 0) {
        when (choice[i][j]) {
            3.toByte() -> { out[i - 1] = rows[j - 1].timeSec; i--; j-- }
            2.toByte() -> j--
            else -> i--
        }
    }
    return out.toList()
}

private val STRIP = Regex("""[\s\p{P}\p{S}]""")

internal fun normalizeForMatch(s: String): String =
    STRIP.replace(Normalizer.normalize(s, Normalizer.Form.NFKC).lowercase(), "")

internal fun bigramSimilarity(a: String, b: String): Double {
    val na = normalizeForMatch(a)
    val nb = normalizeForMatch(b)
    if (na.length < 2 || nb.length < 2) return if (na.isNotEmpty() && na == nb) 1.0 else 0.0
    val grams = HashMap<String, Int>()
    for (k in 0 until na.length - 1) grams.merge(na.substring(k, k + 2), 1, Int::plus)
    var inter = 0
    for (k in 0 until nb.length - 1) {
        val g = nb.substring(k, k + 2)
        val c = grams[g] ?: 0
        if (c > 0) { inter++; grams[g] = c - 1 }
    }
    return inter.toDouble() / (maxOf(na.length, nb.length) - 1)
}
