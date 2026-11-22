package net.ninjaruss.utasync.japanese

import com.atilika.kuromoji.ipadic.Tokenizer

/** Holds the Kuromoji tokenizer, built on first use so the dictionary loads once. */
object Ja {
    val tokenizer: Tokenizer by lazy { Tokenizer() }
}

/** Kuromoji's marker for a field it has no value for. */
private const val NONE = "*"

/** Katakana to hiragana (U+30A1..U+30F6 sit exactly 0x60 above their hiragana); the long-vowel mark stays. */
private fun toHiragana(katakana: String): String =
    katakana.map { if (it in 'ァ'..'ヶ') it - 0x60 else it }.joinToString("")

/**
 * Split [text] into tokens. `reading` is hiragana (Kuromoji's katakana, converted) and null where
 * Kuromoji has none, as for ASCII. `baseForm` is the dictionary form, null where there is none.
 * `start` indexes into [text].
 */
fun tokenize(text: String): List<JaToken> = Ja.tokenizer.tokenize(text).map { t ->
    JaToken(
        surface = t.surface,
        reading = t.reading?.takeIf { it != NONE }?.let(::toHiragana),
        pos = t.partOfSpeechLevel1,
        baseForm = t.baseForm?.takeIf { it != NONE },
        start = t.position,
    )
}
