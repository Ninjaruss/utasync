package net.ninjaruss.utasync.align

/** What a lyric source turned out to be: singable now, words only, or nothing usable. */
sealed interface Sheet {
    /** Lyrics with timings; the song is ready to sing. */
    data class Timed(val lines: List<LrcLine>) : Sheet

    /** Lyrics without timings; the words are known, the timing comes later. */
    data class Untimed(val lines: List<String>) : Sheet

    data object None : Sheet
}

/**
 * Decides what a lyric source is. An instrumental is [Sheet.None] whatever its fields hold.
 * Synced lyrics count only if they parse to at least one timed row: a "synced" field with
 * no time tags falls back to [plain], never to an empty [Sheet.Timed].
 */
fun sheetFrom(synced: String?, plain: String?, instrumental: Boolean): Sheet {
    if (instrumental) return Sheet.None
    synced?.let(::parseLrc)?.takeIf { it.isNotEmpty() }?.let { return Sheet.Timed(it) }
    plain?.let(::splitPastedLyrics)?.takeIf { it.isNotEmpty() }?.let { return Sheet.Untimed(it) }
    return Sheet.None
}

/** Splits pasted or plain lyrics into lines: trims each, drops blanks, keeps interior spacing. */
fun splitPastedLyrics(text: String): List<String> =
    text.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.toList()
