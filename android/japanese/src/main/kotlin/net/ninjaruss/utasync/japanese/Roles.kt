package net.ninjaruss.utasync.japanese

/**
 * What each element of a line is *doing*, mechanically: "marks the topic", "past tense",
 * "i-adjective modifying the next noun" (spec 7.6).
 *
 * **Never why a lyricist chose a construction** (spec 4.1). The user's eye must stay on the
 * Japanese, so a role is read to decode the line, never instead of it — which also means a role
 * that adds nothing is `null`. "noun" on every noun would pass a naive test and make the screen
 * worse, and the spec ranks this the first feature to cut if it reads as noise. So the table is
 * deliberately short: only elements whose function is **structural and unambiguous in IPADIC**
 * get a role.
 *
 * Every tag below was observed from `tokenize` output on invented sentences, not taken from a
 * tagset document: a branch keyed on a string IPADIC never emits is a branch that never runs.
 *
 * Two deliberate omissions, both because the role would be a guess or a duplicate:
 * - **と and も** (both unambiguous tags, ambiguous functions). と 格助詞 is "with", "and" and the
 *   quotative at the same tag; も 係助詞 is "too" and "even". A wrong role is worse than none.
 * - **たい and う** (desiderative, volitional). Their function is already in the word's own gloss
 *   in the popover, so naming it again is the noise this feature is supposed to avoid.
 */

/** は and が and friends: keyed on **(surface, level-2 part of speech)**, because the tag alone is not enough. */
private val CASE_PARTICLE_ROLES: Map<Pair<String, String>, String> = mapOf(
    // は is 係助詞, and so are も and さえ — hence the surface in the key.
    ("は" to "係助詞") to "marks the topic",
    // が, を, に, で, から are all 格助詞; が is also 接続助詞 (below), which is the whole reason
    // posDetail exists on JaToken.
    ("が" to "格助詞") to "marks the subject",
    ("を" to "格助詞") to "marks the object",
    ("に" to "格助詞") to "marks the place or the target",
    ("で" to "格助詞") to "marks the means or the place",
    ("から" to "格助詞") to "marks the starting point",
    ("まで" to "副助詞") to "marks the end point",
    ("が" to "接続助詞") to "joins two clauses, as 'but'",
    ("て" to "接続助詞") to "joins this verb to what follows",
    ("で" to "接続助詞") to "joins this verb to what follows",
)

/**
 * Particles whose **level-2 tag alone** fixes the function, whatever the surface:
 * 連体化 is only ever の, 副詞化 only ever に, and every 終助詞 ends the sentence.
 * か is tagged 副助詞／並立助詞／終助詞 — one compound string, not 終助詞 — so it gets no role,
 * which is correct: IPADIC has not decided which one it is here.
 */
private val PARTICLE_DETAIL_ROLES: Map<String, String> = mapOf(
    "連体化" to "links this noun to the next",
    "副詞化" to "makes the word before it adverbial",
    "終助詞" to "ends the sentence",
)

/**
 * Auxiliaries, keyed on IPADIC's **conjugation class**, not on the surface and not on the base
 * form. This is forced by the data: the だ of 読んだ is 助動詞, 基本形, base form だ — identical to
 * the copula だ of 静かだ in every other field — and only the class (特殊・タ against 特殊・ダ)
 * separates them. Keying on the base form would put "states 'is'" on a past-tense verb.
 *
 * Only inflectional functions are listed: tense, negation, politeness, the copula. 特殊・タイ
 * (たい) and 不変化型 (う) are deliberately absent; see the omissions above.
 */
private val AUX_ROLES: Map<String, String> = mapOf(
    "特殊・タ" to "past tense",
    "特殊・ナイ" to "negative",
    "特殊・ヌ" to "negative",
    "特殊・マス" to "marks polite speech",
    "特殊・ダ" to "states 'is'",
    "特殊・デス" to "states 'is'",
)

/** 特殊・ダ in its 体言接続 form is the な of 静かな夜 — not a statement, a link. */
private const val ATTRIBUTIVE_COPULA = "links the adjective to the next noun"

/** 形容詞 in 基本形 whose following token is a 名詞. */
private const val ATTRIBUTIVE_ADJECTIVE = "i-adjective modifying the next noun"

/** 形容詞 in 連用テ接続 (早く of 早く走る): adverbial, so it modifies no noun. */
private const val ADVERBIAL_ADJECTIVE = "i-adjective used adverbially"

/**
 * **Every string [roleOf] can return.** Derived from the tables, so a role added to a table is a
 * role in here, and the test that keeps the vocabulary mechanical covers it automatically.
 */
internal val ROLE_VOCABULARY: Set<String> =
    CASE_PARTICLE_ROLES.values.toSet() + PARTICLE_DETAIL_ROLES.values + AUX_ROLES.values +
        setOf(ATTRIBUTIVE_COPULA, ATTRIBUTIVE_ADJECTIVE, ADVERBIAL_ADJECTIVE)

/**
 * The role [token] plays, or null where naming it adds nothing.
 *
 * [next] is **the token that immediately follows in the line** — the next token, not the next
 * word of interest, and it may be punctuation, a particle, or null at the end of a line. The
 * attributive cases therefore require [next] to actually be a 名詞 rather than merely to exist:
 * the 青い of "空は青い。" is followed by 記号 and claims to modify nothing.
 *
 * Nouns, verbs and adverbs get no role: their class is visible in the popover's sense label and
 * repeating it over the line is the noise spec 4.1 forbids.
 */
fun roleOf(token: JaToken, next: JaToken?): String? = when (token.pos) {
    "助詞" -> token.posDetail?.let { detail ->
        CASE_PARTICLE_ROLES[token.surface to detail] ?: PARTICLE_DETAIL_ROLES[detail]
    }
    "助動詞" -> when {
        token.conjugationType == "特殊・ダ" && token.conjugation == "体言接続" -> ATTRIBUTIVE_COPULA
        else -> AUX_ROLES[token.conjugationType]
    }
    "形容詞" -> when (token.conjugation) {
        "基本形" -> ATTRIBUTIVE_ADJECTIVE.takeIf { next?.pos == "名詞" }
        "連用テ接続" -> ADVERBIAL_ADJECTIVE
        else -> null
    }
    else -> null
}
