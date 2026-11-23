package net.ninjaruss.utasync.japanese

import net.ninjaruss.utasync.data.DictionaryDao
import net.ninjaruss.utasync.data.DictionaryEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Roles are read off real tokenizer output, never off hand-built [JaToken]s: a role keyed on an
 * IPADIC tag the tokenizer never emits is a branch that never runs, and a hand-built token would
 * hide exactly that. Every sentence here is invented for the test (CLAUDE.md rule 6).
 */
class RolesTest {
    /** The role of [surface] in [line], with the *following token* as `next`, as `roleOf` takes it. */
    private fun roleIn(line: String, surface: String, occurrence: Int = 0): String? {
        val tokens = tokenize(line)
        val i = tokens.withIndex().filter { it.value.surface == surface }.map { it.index }[occurrence]
        return roleOf(tokens[i], tokens.getOrNull(i + 1))
    }

    @Test fun `the topic particle is named as such`() {
        val role = roleIn("私は海が好きだ", "は")
        assertNotNull("は got no role at all", role)
        assertTrue("は role was '$role'", role!!.contains("topic"))
    }

    @Test fun `a past-tense auxiliary is named`() {
        assertEquals("past tense", roleIn("雨が降った", "た"))
        // 読んだ voices the auxiliary: the surface is だ, the base form is だ, and the conjugation
        // form is 基本形 — every field the copula だ of 静かだ has. Only the conjugation class
        // separates them, so this case is what makes keying on the base form wrong.
        assertEquals("past tense", roleIn("本を読んだ", "だ"))
    }

    @Test fun `the copula da and the voiced past da do not get the same role`() {
        val past = roleIn("本を読んだ", "だ")
        val copula = roleIn("とても静かだ", "だ")
        assertEquals("past tense", past)
        assertNotNull("the copula だ got no role", copula)
        assertFalse("copula だ was called '$copula'", copula!!.contains("past"))
    }

    @Test fun `the na that links a na-adjective to its noun is not called a statement`() {
        val role = roleIn("静かな夜", "な")
        assertEquals("links the adjective to the next noun", role)
    }

    @Test fun `an i-adjective before a noun says it modifies it`() {
        val role = roleIn("白い雪", "白い")
        assertNotNull("白い before 雪 got no role", role)
        assertTrue("白い role was '$role'", role!!.contains("modif") && role.contains("noun"))
    }

    @Test fun `an i-adjective at the end of a line does not claim to modify anything`() {
        // next == null.
        assertNull(roleIn("空は青い", "青い"))
        // `next` is the following *token*, which here is punctuation, not a noun (brief case 4).
        assertNull(roleIn("空は青い。", "青い"))
    }

    @Test fun `an i-adjective before a non-noun does not claim noun modification`() {
        // 早く走る: adverbial, so claiming it modifies a noun would be wrong.
        val adverbial = roleIn("早く走る", "早く")
        assertFalse("早く role was '$adverbial'", adverbial.orEmpty().contains("noun"))
        // A dictionary-form adjective followed by a particle is not attributive either.
        val beforeParticle = roleIn("空は青いが寒い", "青い")
        assertFalse("青い role was '$beforeParticle'", beforeParticle.orEmpty().contains("noun"))
    }

    @Test fun `the conjunctive ga is not called the subject marker`() {
        val subject = roleIn("雨が降ったが、空は青い", "が", occurrence = 0)
        val conjunctive = roleIn("雨が降ったが、空は青い", "が", occurrence = 1)
        assertTrue("case が role was '$subject'", subject.orEmpty().contains("subject"))
        assertFalse("conjunctive が role was '$conjunctive'", conjunctive.orEmpty().contains("subject"))
        assertTrue("conjunctive が role was '$conjunctive'", conjunctive.orEmpty().contains("but"))
    }

    @Test fun `a word with no interesting role yields null rather than filler`() {
        assertNull("a plain noun was given a role", roleIn("白い雪", "雪"))
        assertNull("a plain verb was given a role", roleIn("夜が明ける", "明ける"))
    }

    @Test fun `a particle with no entry in the table yields null rather than a generic particle label`() {
        assertNull(roleIn("君さえ笑う", "さえ"))
        assertNull(roleIn("君さえ笑うばかり", "ばかり"))
    }

    @Test fun `no role text explains a choice, only names a function`() {
        // Derived over the COMPLETE vocabulary — every string roleOf can return — not over
        // examples, so adding "suggests longing" to the table fails this test.
        val banned = listOf(
            "because", "so that", "in order to", "why", "suggest", "suggests", "imply", "implies",
            "emphasis", "emphasise", "emphasises", "emphasize", "emphasizes", "feeling", "feelings",
            "emotion", "emotional", "mood", "tone", "atmosphere", "poetic", "poetically", "lyrical",
            "metaphor", "imagery", "image", "singer", "writer", "lyricist", "narrator", "author",
            "conveys", "convey", "evokes", "evoke", "nuance", "intent", "intention", "longing",
            "beautiful", "sad", "happy", "romantic", "chose", "choice", "wants to say", "feels",
        )
        assertTrue("the role vocabulary is empty", ROLE_VOCABULARY.isNotEmpty())
        for (role in ROLE_VOCABULARY) {
            val words = role.lowercase().split(Regex("[^a-z]+")).filter { it.isNotEmpty() }
            for (bad in banned) {
                val hit = if (" " in bad) bad in role.lowercase() else bad in words
                assertFalse("role '$role' uses explanatory or affective word '$bad'", hit)
            }
            assertFalse("role '$role' is a sentence, not a function name", role.contains('.'))
            assertTrue("role '$role' is too long to be a function name", role.length <= 48)
            assertEquals("role '$role' is not trimmed", role.trim(), role)
        }
    }

    @Test fun `every role roleOf returns is in the published vocabulary`() {
        // Without this, the vocabulary test above could pass over a table that roleOf does not
        // actually draw from.
        val lines = listOf(
            "私は海が好きだ", "雨が降ったが、空は青い", "早い電車に乗る", "早く走る", "本を読んだ",
            "学校に行くよ", "友達と話すね", "犬も猫も好きか", "君の名前は", "家から駅まで歩いて行こう",
            "静かな夜", "とても静かだ", "歌を歌わない", "行きたい", "美しかった", "窓を開けて",
            "大きな声で", "静かに歩く", "歌います", "これです", "知らぬ", "廊下を走るな",
            "君さえ笑うばかり", "一人で二人を待つ", "白い雪", "hello world",
        )
        var seen = 0
        for (line in lines) {
            val tokens = tokenize(line)
            for ((i, t) in tokens.withIndex()) {
                val role = roleOf(t, tokens.getOrNull(i + 1)) ?: continue
                seen++
                assertTrue("roleOf returned '$role' for '${t.surface}', which is not in ROLE_VOCABULARY", role in ROLE_VOCABULARY)
            }
        }
        assertTrue("no role was produced at all, so this proves nothing", seen > 10)
    }

    @Test fun `most words on an ordinary line get no role`() {
        // This asserted only that at least one token had a role and at least one did not, which is
        // true of almost any line and does not check "most". It now counts.
        val words = tokenize("白い雪が静かに降っている。")
        val roles = words.indices.map { roleOf(words[it], words.getOrNull(it + 1)) }
        val named = roles.count { it != null }
        assertTrue("expected a role on at least one word, got none", named > 0)
        assertTrue("expected most words to have NO role, got $named of ${words.size}", named * 2 < words.size)
    }

    // ---- the four false roles the Task 6 review found, each settled by probing IPADIC ----
    //
    // 連用テ接続 is byte-identical for three different functions, so the tag alone cannot tell them
    // apart and the role is only given before a verb.

    @Test fun `an i-adjective before a verb is adverbial`() {
        assertEquals("i-adjective used adverbially", roleIn("早く走る。", "早く"))
    }

    @Test fun `the stem of a negation is not called adverbial`() {
        // 高く of 空は高くない carries the SAME tag as 早く of 早く走る. The negation is named on the
        // ない that follows, so the stem is owed nothing.
        assertNull(roleIn("空は高くない。", "高く"))
        assertEquals("negative", roleIn("空は高くない。", "ない"))
    }

    @Test fun `an i-adjective joined by te is not called adverbial`() {
        assertNull(roleIn("高くて白い山。", "高く"))
    }

    @Test fun `the past copula does not claim to state 'is'`() {
        // だっ of 静かだった is 特殊・ダ like the copula, but 連用タ接続: the た after it is the tense.
        assertNull(roleIn("とても静かだった。", "だっ"))
        assertEquals("past tense", roleIn("とても静かだった。", "た"))
        assertEquals("states 'is'", roleIn("とても静かだ。", "だ"))
    }

    @Test fun `a sentence-final particle mid-line does not claim to end the sentence`() {
        assertEquals("ends the sentence", roleIn("行くよ。", "よ"))
        assertNull(roleIn("行くよ、そして帰る。", "よ"))
    }

    @Test fun `the te particle does not claim what precedes it is a verb`() {
        // Same 接続助詞 tag after a verb, an adjective and an auxiliary; roleOf cannot see which.
        // 読んで voices the particle to で, which is why the verb case here is 食べて and not 読んで:
        // both are in the table, and picking the wrong one tested the tokenizer, not the role.
        for (line in listOf("パンを食べて帰る。", "高くて白い山。", "食べたくて困る。")) {
            assertEquals("joins what comes before to what follows", roleIn(line, "て"))
        }
        assertEquals("joins what comes before to what follows", roleIn("本を読んで帰る。", "で"))
    }

    // ---- null discipline, over a derived set rather than examples ----

    @Test fun `no content word on a mixed line is given a role`() {
        val words = tokenize("とても白い雪がhello world静かに降る。")
        val content = words.indices.filter { words[it].pos in setOf("名詞", "動詞", "副詞", "記号") }
        assertTrue("no content words found, so this proved nothing", content.size >= 5)
        for (i in content) {
            assertNull(
                "'${words[i].surface}' (${words[i].pos}) was given a role",
                roleOf(words[i], words.getOrNull(i + 1)),
            )
        }
    }

    // ---- the next-token wiring, through analyze rather than roleOf ----

    @Test fun `analyze passes each word's following token, so attributive roles work end to end`() {
        // roleOf's attributive cases depend entirely on `next`. Every other analyze-level test uses
        // a line with no i-adjective, so an off-by-one in analyze's `next` would have passed them
        // all while breaking the one role that needs it.
        val words = runSuspend {
            Analyzer(NoDictionary) { emptyList() }.analyze("白い雪が降る。", ReadingMode.DICTIONARY)
        }
        assertEquals("i-adjective modifying the next noun", words.first { it.token.surface == "白い" }.role)
        assertEquals("marks the subject", words.first { it.token.surface == "が" }.role)
        assertNull(words.first { it.token.surface == "雪" }.role)
    }

    /** Roles do not depend on the dictionary, so this task's analyze test needs no rows. */
    private object NoDictionary : DictionaryDao {
        override suspend fun entriesFor(surface: String): List<DictionaryEntity> = emptyList()
        override suspend fun entriesFor(surface: String, reading: String): List<DictionaryEntity> = emptyList()
    }

    /** The role of [surface] in [text], tokenized for real so no assertion rests on a built token. */
    private fun roleIn(text: String, surface: String): String? {
        val words = tokenize(text)
        val i = words.indexOfFirst { it.surface == surface }
        assertTrue("'$surface' is not a token of '$text'; the tokenizer split it differently", i >= 0)
        return roleOf(words[i], words.getOrNull(i + 1))
    }
}
