package net.ninjaruss.utasync.japanese

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
        // The anti-goal (spec 4.1): the eye stays on the Japanese. A role on every token is the
        // failure mode this feature has to avoid, so the sparsity is asserted, not assumed.
        val tokens = tokenize("私は白い雪を見ながら静かに歩いた")
        val roles = tokens.mapIndexed { i, t -> roleOf(t, tokens.getOrNull(i + 1)) }
        assertTrue("no roles at all on this line", roles.any { it != null })
        assertTrue("every token got a role: ${tokens.map { it.surface }.zip(roles)}", roles.any { it == null })
    }
}
