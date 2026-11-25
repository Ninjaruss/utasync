package net.ninjaruss.utasync.japanese

import com.atilika.kuromoji.ipadic.Tokenizer

/** Holds the Kuromoji tokenizer, built on first use so the dictionary loads once. */
object Ja {
    // internal: nothing outside :japanese should hold a Kuromoji object; `tokenize` is the public surface.
    internal val tokenizer: Tokenizer by lazy { Tokenizer() }
}

/** Kuromoji's marker for a field it has no value for. */
private const val NONE = "*"

/** Katakana to hiragana (U+30A1..U+30F6 sit exactly 0x60 above their hiragana); the long-vowel mark stays. */
internal fun toHiragana(katakana: String): String =
    katakana.map { if (it in 'ァ'..'ヶ') it - 0x60 else it }.joinToString("")

/**
 * Split [text] into tokens. `reading` is hiragana (Kuromoji's katakana, converted) and null where
 * Kuromoji has none, as for ASCII. `baseForm` is the dictionary form, null where there is none.
 * `start` indexes into [text]. `posDetail`, `conjugation` and `conjugationType` are IPADIC's
 * level-2 part of speech, conjugation form and conjugation class, null where Kuromoji has none,
 * as `reading` and `baseForm` are.
 * Tokens with a blank surface (whitespace) are dropped here, once;
 * dropping removes entries and does not renumber, so `start` still indexes the original text.
 */
fun tokenize(text: String): List<JaToken> = Ja.tokenizer.tokenize(text).filter { it.surface.isNotBlank() }.map { t ->
    JaToken(
        surface = t.surface,
        reading = t.reading?.takeIf { it != NONE }?.let(::toHiragana),
        pos = t.partOfSpeechLevel1,
        posDetail = t.partOfSpeechLevel2?.takeIf { it != NONE },
        conjugation = t.conjugationForm?.takeIf { it != NONE },
        conjugationType = t.conjugationType?.takeIf { it != NONE },
        baseForm = t.baseForm?.takeIf { it != NONE },
        start = t.position,
    )
}
