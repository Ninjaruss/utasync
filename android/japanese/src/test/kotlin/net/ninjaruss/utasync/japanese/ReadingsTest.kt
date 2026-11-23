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

    @Test fun `a kana-only token needs no ruby`() {
        assertNull(rubyFor(token("です", "です"), DICTIONARY, none))
        // Katakana surface, hiragana reading (the tokenizer's output): still the same sounds.
        assertNull(rubyFor(token("ココロ", "こころ"), DICTIONARY, none))
    }

    @Test fun `a kana-only token is not marked even where the lookup knows alternates`() {
        assertNull(rubyFor(token("です", "です"), DICTIONARY) { listOf("でし") })
    }

    @Test fun `a kanji token with no reading needs no ruby`() {
        assertNull(rubyFor(token("雨", null), DICTIONARY) { listOf("あま") })
    }

    @Test fun `OFF yields no reading even where one exists`() {
        assertNull(rubyFor(token("明白", "めいはく"), OFF) { listOf("あからさま") })
    }

    @Test fun `OFF never consults the alternates source`() {
        var calls = 0
        rubyFor(token("明白", "めいはく"), OFF) { calls++; emptyList() }
        assertEquals(0, calls)
    }

    @Test fun `a surface with a known alternate reading is marked`() {
        val ruby = rubyFor(token("明白", "めいはく"), DICTIONARY) { listOf("あからさま") }
        assertNotNull(ruby)
        assertEquals("明白", ruby!!.base)
        assertEquals("めいはく", ruby.reading)
        assertEquals(listOf("あからさま"), ruby.alternates)
    }

    @Test fun `a surface with no alternates is not marked`() {
        val ruby = rubyFor(token("雨", "あめ"), DICTIONARY, none)
        assertEquals("あめ", ruby!!.reading)
        assertEquals(emptyList<String>(), ruby.alternates)
    }

    @Test fun `an inflected token is marked through its base form, keeping its own reading`() {
        val t = JaToken(surface = "行っ", reading = "いっ", pos = "動詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "行く", start = 0)
        val ruby = rubyFor(t, DICTIONARY) { if (it == "行く") listOf("ゆく") else emptyList() }!!
        assertEquals("いっ", ruby.reading)
        assertEquals(listOf("ゆく"), ruby.alternates)
        assertTrue(ruby.isAmbiguous)
    }

    @Test fun `the surface lookup wins and the base form is not asked when it answers`() {
        val asked = mutableListOf<String>()
        val t = JaToken(surface = "明白", reading = "めいはく", pos = "名詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "明白", start = 0)
        rubyFor(t, DICTIONARY) { asked += it; listOf("あからさま") }
        assertEquals(listOf("明白"), asked)
    }

    @Test fun `isAmbiguous follows the alternates`() {
        assertTrue(Ruby("明白", "めいはく", listOf("あからさま")).isAmbiguous)
        assertEquals(false, Ruby("雨", "あめ", emptyList()).isAmbiguous)
    }

    @Test fun `the alternates are asked about the surface, not the reading`() {
        val asked = mutableListOf<String>()
        rubyFor(token("明白", "めいはく"), DICTIONARY) { asked += it; emptyList() }
        assertEquals(listOf("明白"), asked)
    }

    @Test fun `the shown reading and duplicates are not listed as alternates`() {
        val ruby = rubyFor(token("明白", "めいはく"), DICTIONARY) { listOf("めいはく", "あからさま", "あからさま") }
        assertEquals(listOf("あからさま"), ruby!!.alternates)
    }

    @Test fun `SUNG gives exactly what DICTIONARY gives while no audio reading exists`() {
        val alts: (String) -> List<String> = { if (it == "明白") listOf("あからさま") else emptyList() }
        val tokens = listOf(token("明白", "めいはく"), token("雨", "あめ"), token("です", "です"), token("雨", null)) +
            loadCorpus().entries.flatMap { tokenize(it.text) }
        for (t in tokens) assertEquals(rubyFor(t, DICTIONARY, alts), rubyFor(t, SUNG, alts))
        assertEquals("めいはく", rubyFor(tokens[0], SUNG, alts)!!.reading)
    }

    @Test fun `the alternates lookup is never handed an empty surface`() {
        val asked = mutableListOf<String>()
        val lookup: (String) -> List<String> = { asked += it; emptyList() }
        // Derived set: every token of every corpus sentence, plus blank surfaces built by hand.
        val corpus = loadCorpus().entries.flatMap { tokenize(it.text) }
        assertTrue(corpus.isNotEmpty())
        val blanks = listOf(token("", "あ"), token(" ", "あ"), token("", null))
        for (t in corpus + blanks) for (m in ReadingMode.values()) rubyFor(t, m, lookup)
        assertTrue("lookup was never consulted, the test proves nothing", asked.isNotEmpty())
        assertTrue("blank surface reached the lookup", asked.none { it.isBlank() })
    }
}
