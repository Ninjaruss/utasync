package net.ninjaruss.utasync.japanese

import net.ninjaruss.utasync.japanese.ReadingMode.DICTIONARY
import net.ninjaruss.utasync.japanese.ReadingMode.OFF
import net.ninjaruss.utasync.japanese.ReadingMode.SUNG
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReadingsTest {
    private fun token(surface: String, reading: String?) = JaToken(surface = surface, reading = reading, pos = "名詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = null, start = 0)
    private val none: (String) -> List<String> = { emptyList() }

    /** No base-form reading known: the base-form filter is off, which is most tests here. */
    private val noBaseReading: (String) -> String? = { null }

    @Test fun `a kana-only token needs no ruby`() {
        assertNull(rubyFor(token("です", "です"), DICTIONARY, none, noBaseReading))
        // Katakana surface, hiragana reading (the tokenizer's output): still the same sounds.
        assertNull(rubyFor(token("ココロ", "こころ"), DICTIONARY, none, noBaseReading))
    }

    @Test fun `a kana-only token is not marked even where the lookup knows alternates`() {
        assertNull(rubyFor(token("です", "です"), DICTIONARY, { listOf("でし") }, noBaseReading))
    }

    @Test fun `a kanji token with no reading needs no ruby`() {
        assertNull(rubyFor(token("雨", null), DICTIONARY, { listOf("あま") }, noBaseReading))
    }

    @Test fun `OFF yields no reading even where one exists`() {
        assertNull(rubyFor(token("明白", "めいはく"), OFF, { listOf("あからさま") }, noBaseReading))
    }

    @Test fun `OFF never consults the alternates source`() {
        var calls = 0
        rubyFor(token("明白", "めいはく"), OFF, { calls++; emptyList() }, noBaseReading)
        assertEquals(0, calls)
    }

    @Test fun `a surface with a known alternate reading is marked`() {
        val ruby = rubyFor(token("明白", "めいはく"), DICTIONARY, { listOf("あからさま") }, noBaseReading)
        assertNotNull(ruby)
        assertEquals("明白", ruby!!.base)
        assertEquals("めいはく", ruby.reading)
        assertEquals(listOf("あからさま"), ruby.alternates)
    }

    @Test fun `a surface with no alternates is not marked`() {
        val ruby = rubyFor(token("雨", "あめ"), DICTIONARY, none, noBaseReading)
        assertEquals("あめ", ruby!!.reading)
        assertEquals(emptyList<String>(), ruby.alternates)
    }

    @Test fun `an inflected token is marked through its base form, keeping its own reading`() {
        val t = JaToken(surface = "行っ", reading = "いっ", pos = "動詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "行く", start = 0)
        val ruby = rubyFor(t, DICTIONARY, { if (it == "行く") listOf("ゆく") else emptyList() }, noBaseReading)!!
        assertEquals("いっ", ruby.reading)
        assertEquals(listOf("ゆく"), ruby.alternates)
        assertTrue(ruby.isAmbiguous)
    }

    @Test fun `the surface lookup wins and the base form is not asked when it answers`() {
        val asked = mutableListOf<String>()
        val t = JaToken(surface = "明白", reading = "めいはく", pos = "名詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "明白", start = 0)
        rubyFor(t, DICTIONARY, { asked += it; listOf("あからさま") }, noBaseReading)
        assertEquals(listOf("明白"), asked)
    }

    @Test fun `isAmbiguous follows the alternates`() {
        assertTrue(Ruby("明白", "めいはく", listOf("あからさま")).isAmbiguous)
        assertEquals(false, Ruby("雨", "あめ", emptyList()).isAmbiguous)
    }

    @Test fun `the alternates are asked about the surface, not the reading`() {
        val asked = mutableListOf<String>()
        rubyFor(token("明白", "めいはく"), DICTIONARY, { asked += it; emptyList() }, noBaseReading)
        assertEquals(listOf("明白"), asked)
    }

    @Test fun `the shown reading and duplicates are not listed as alternates`() {
        val ruby = rubyFor(token("明白", "めいはく"), DICTIONARY, { listOf("めいはく", "あからさま", "あからさま") }, noBaseReading)
        assertEquals(listOf("あからさま"), ruby!!.alternates)
    }

    @Test fun `SUNG gives exactly what DICTIONARY gives while no audio reading exists`() {
        val alts: (String) -> List<String> = { if (it == "明白") listOf("あからさま") else emptyList() }
        val tokens = listOf(token("明白", "めいはく"), token("雨", "あめ"), token("です", "です"), token("雨", null)) +
            loadCorpus().entries.flatMap { tokenize(it.text) }
        for (t in tokens) assertEquals(rubyFor(t, DICTIONARY, alts, ::dictionaryReading), rubyFor(t, SUNG, alts, ::dictionaryReading))
        assertEquals("めいはく", rubyFor(tokens[0], SUNG, alts, ::dictionaryReading)!!.reading)
    }

    @Test fun `neither lookup is ever handed an empty surface`() {
        val asked = mutableListOf<String>()
        val readingAsked = mutableListOf<String>()
        // Answers something, so the base-form level is actually reached and its reading asked for.
        val lookup: (String) -> List<String> = { asked += it; listOf("なに") }
        val baseReading: (String) -> String? = { readingAsked += it; null }
        // Derived set: every token of every corpus sentence, plus blank surfaces built by hand.
        val corpus = loadCorpus().entries.flatMap { tokenize(it.text) }
        assertTrue(corpus.isNotEmpty())
        val blanks = listOf(token("", "あ"), token(" ", "あ"), token("", null))
        for (t in corpus + blanks) for (m in ReadingMode.values()) rubyFor(t, m, lookup, baseReading)
        assertTrue("lookup was never consulted, the test proves nothing", asked.isNotEmpty())
        assertTrue("blank surface reached the lookup", asked.none { it.isBlank() })
        assertTrue("blank base form reached the reading lookup", readingAsked.none { it.isBlank() })
    }

    @Test fun `a base-form alternate that is the word's own reading is not listed`() {
        // 降っ is read ふっ; its base form 降る is read ふる, so ふる is this word's own reading and
        // くだる is the only real rival. Equality with the shown reading cannot tell them apart.
        val t = JaToken(surface = "降っ", reading = "ふっ", pos = "動詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "降る", start = 0)
        val alts: (String) -> List<String> = { if (it == "降る") listOf("ふる", "くだる") else emptyList() }
        val ruby = rubyFor(t, DICTIONARY, alts) { if (it == "降る") "ふる" else null }!!
        assertEquals("ふっ", ruby.reading)
        assertEquals(listOf("くだる"), ruby.alternates)
    }

    @Test fun `a word whose only base-form alternate is its own reading is not marked at all`() {
        val t = JaToken(surface = "言っ", reading = "いっ", pos = "動詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "言う", start = 0)
        val alts: (String) -> List<String> = { if (it == "言う") listOf("いう") else emptyList() }
        val ruby = rubyFor(t, DICTIONARY, alts) { "いう" }!!
        assertEquals(emptyList<String>(), ruby.alternates)
        assertEquals(false, ruby.isAmbiguous)
    }

    @Test fun `the surface level keeps a rival that happens to be the surface's other reading`() {
        // The filter must NOT reach the surface level: 時 shown じ has とき as a genuine rival, and
        // とき is also what 時 reads alone. A lookup told to drop "the key's own reading" would
        // delete the mark from every word shown in its less common reading.
        val t = JaToken(surface = "時", reading = "じ", pos = "名詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "時", start = 0)
        val ruby = rubyFor(t, DICTIONARY, { listOf("とき", "じ") }) { "とき" }!!
        assertEquals(listOf("とき"), ruby.alternates)
    }

    @Test fun `the base form's reading is not asked for where the base form has no alternates`() {
        val asked = mutableListOf<String>()
        val t = JaToken(surface = "行っ", reading = "いっ", pos = "動詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "行く", start = 0)
        rubyFor(t, DICTIONARY, { emptyList() }) { asked += it; null }
        assertEquals(emptyList<String>(), asked)
    }

    /**
     * **No word may name its own reading as a rival.** An alternates list reached through the
     * base form holds dictionary-form readings (いく, ゆく for 行く), while the shown reading is the
     * surface's (いっ). The two are the same word, but never the same string, so filtering the
     * shown reading by equality cannot remove it -- and the popover prints that list to the
     * reader: "also read ふる" over a word already read ふっ.
     *
     * The base form's reading is derived here from EVERY token it splits into, not from the one
     * token a headword usually is: a derivation that gives up on a multi-token base form would
     * leave the defect alive exactly where it could not be seen.
     */
    @Test fun `no word lists the reading of its own dictionary form as an alternate`() {
        val analyze = corpusAnalyzer(loadCorpus())
        val offenders = mutableListOf<String>()
        var marked = 0
        for (entry in loadCorpus().entries) {
            for (w in analyze(entry.text)) {
                val alternates = w.ruby?.alternates.orEmpty()
                if (alternates.isEmpty()) continue
                marked++
                val base = w.token.baseForm?.takeIf { it.isNotBlank() && it != w.token.surface } ?: continue
                val pieces = tokenize(base).map { it.reading }
                if (pieces.any { it == null }) continue // no reading to compare against
                val own = pieces.joinToString("")
                if (own in alternates) offenders += "${w.token.surface} (${w.ruby?.reading}) lists $own, its own ${base} reading"
            }
        }
        assertTrue("no word was marked, the test proves nothing", marked > 0)
        assertEquals(offenders.joinToString("\n"), emptyList<String>(), offenders)
    }
}
