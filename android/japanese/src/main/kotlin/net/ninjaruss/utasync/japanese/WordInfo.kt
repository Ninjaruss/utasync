package net.ninjaruss.utasync.japanese

/**
 * One token of analysed Japanese text. [start] is the offset of [surface] in the analysed text.
 *
 * [pos] is IPADIC's part of speech at level 1 (名詞, 助詞, 動詞, …) and [posDetail] at level 2
 * (格助詞 vs 接続助詞 for が, 係助詞 for は). [conjugation] is IPADIC's conjugation **form**
 * (基本形, 体言接続, 連用テ接続, …), which separates 早い before a noun from 早く before a verb,
 * and [conjugationType] its conjugation **class** (特殊・タ, 特殊・ダ, 五段・ラ行, …), which is the
 * only field that separates the voiced past だ of 読んだ from the copula だ: both are 助動詞,
 * both are 基本形, and both have base form だ. All four carry IPADIC's own strings; null where
 * Kuromoji has no value ("*").
 */
data class JaToken(
    val surface: String,
    val reading: String?,
    val pos: String,
    val posDetail: String?,
    val conjugation: String?,
    val conjugationType: String?,
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
