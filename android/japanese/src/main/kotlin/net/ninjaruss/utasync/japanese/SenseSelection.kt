package net.ninjaruss.utasync.japanese

import net.ninjaruss.utasync.data.DictionaryEntity

/**
 * IPADIC's level-1 part of speech, and the dictionary labels a token of that class may wear.
 * A label the dictionary never uses is not listed; the labels it does use are
 * n, v, adj, adv, int, suf, conj, aux, pref, prt and none at all.
 *
 * The mapping is wider than a translation table because IPADIC's 名詞 covers more than a noun:
 * 形容動詞語幹 (明白, 上手 — `adj` in the dictionary), 副詞可能 (`adv`) and 接尾 (時 as じ, `suf`)
 * are all 名詞 at level 1. Narrowing 名詞 to `n` is the same mistake as forcing `n` onto a noun,
 * one step earlier: it would gloss 上手 "flattery" rather than "skillful".
 */
private val LABELS_FOR_POS: Map<String, Set<String>> = mapOf(
    "名詞" to setOf("n", "adj", "adv", "suf"),
    "動詞" to setOf("v", "aux"),
    "形容詞" to setOf("adj"),
    "副詞" to setOf("adv", "n"),
    "連体詞" to setOf("adj", "pref"),
    "接続詞" to setOf("conj"),
    "助詞" to setOf("prt", "conj"),
    "助動詞" to setOf("aux", "v", "prt"),
    "感動詞" to setOf("int"),
    "接頭詞" to setOf("pref"),
)

/**
 * The parts of speech that get **one** sense rather than a list (spec 7a.1, rule 2). A particle
 * with five senses listed is noise at the point of reading: the reader wants to know what が is
 * doing here, not that it can also mean "picture".
 */
internal val GRAMMAR_POS = setOf("助詞", "助動詞")

/**
 * IPADIC's inflecting classes: a token of one of these has a surface that may be a conjugated
 * form, so its dictionary form is the headword and is looked up first (see `Analyzer.sensesFor`).
 */
internal val INFLECTING_POS = setOf("動詞", "形容詞", "助動詞")

/**
 * True where [entry] could be this [token]'s word. An entry with **no** label is always
 * compatible: the dictionary's own absence of a part of speech is information, and rule 1 of
 * spec 7a.1 is that nothing forces one on. So a labelless entry is never excluded, and
 * [selectSenses] passes its `null` through to [Sense.posLabel] unchanged.
 */
internal fun posMatches(token: JaToken, entry: DictionaryEntity): Boolean =
    entry.posLabel == null || entry.posLabel in LABELS_FOR_POS[token.pos].orEmpty()

/**
 * The senses [token] has **here**, from the dictionary groups of one headword — not JMdict's
 * first sense (spec 7a.1).
 *
 * Two filters, each applied only when it leaves something:
 * 1. **the reading**, which is what separates a homograph's words: 人気 read にんき is popularity
 *    and read ひとけ is a sign of life, and the dictionary lists にんき first. An inflected token
 *    looked up through its dictionary form matches no entry's reading (いっ against いう), so the
 *    filter stands aside rather than emptying the result.
 * 2. **the part of speech**, which separates words that share a reading as well: が is a particle,
 *    a conjunction and a noun, in that order, so taking the first entry glosses every が a
 *    particle. See [posMatches] for why a labelless entry survives this.
 *
 * Order is the dictionary's own (`senseIndex`, common first), never re-sorted. Empty only when
 * [entries] is empty: a word the dictionary does not have shows nothing rather than a guess.
 */
fun selectSenses(token: JaToken, entries: List<DictionaryEntity>): List<Sense> {
    if (entries.isEmpty()) return emptyList()
    val sameReading = entries.filter { it.reading == token.reading }
    val pool = sameReading.ifEmpty { entries }
    val compatible = pool.filter { posMatches(token, it) }
    val senses = compatible.ifEmpty { pool }.map { Sense(it.posLabel, it.glosses) }
    return if (token.pos in GRAMMAR_POS) senses.take(1) else senses
}
