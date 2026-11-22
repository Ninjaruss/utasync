package net.ninjaruss.utasync.japanese

/** One token of analysed Japanese text. [start] is the offset of [surface] in the analysed text. */
data class JaToken(
    val surface: String,
    val reading: String?,
    val pos: String,
    val baseForm: String?,
    val start: Int,
)

/** One sense of a word: an optional part-of-speech label and its English glosses. */
data class Sense(val posLabel: String?, val glosses: List<String>)

/**
 * Furigana for one word. [reading] is the one shown; [alternates] are other readings the
 * surface is known to take, so the UI can say "this one usually, and these others exist"
 * rather than assert the reading being sung (spec 4.2).
 */
data class Ruby(val base: String, val reading: String?, val alternates: List<String>) {
    /** The one predicate for "mark this word"; every surface that marks readings must use it. */
    val isAmbiguous: Boolean get() = alternates.isNotEmpty()
}

enum class ReadingMode { OFF, DICTIONARY, SUNG }

/** Everything the UI shows for one word. [role] is what the word is doing in the line. */
data class WordInfo(
    val token: JaToken,
    val ruby: Ruby?,
    val senses: List<Sense>,
    val role: String?,
)
