package net.ninjaruss.utasync.japanese

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TokenizerTest {
    private fun isKatakana(c: Char) = c in 'ァ'..'ヺ'

    @Test fun `a kanji word carries its surface, reading and part of speech`() {
        val t = tokenize("今日は雨").first { it.surface == "雨" }
        assertEquals("あめ", t.reading)
        assertEquals("名詞", t.pos)
    }

    @Test fun `the reading comes back as hiragana, not katakana`() {
        val readings = tokenize("明日会いましょう").mapNotNull { it.reading }
        assertTrue(readings.isNotEmpty())
        for (r in readings) assertFalse("katakana in reading '$r'", r.any(::isKatakana))
        assertTrue(tokenize("明日").any { it.reading == "あした" || it.reading == "あす" })
    }

    @Test fun `no corpus sentence yields a katakana reading, so the audit fallback cannot see one`() {
        // Derived set: every token of every corpus sentence. The audit compares token.reading
        // directly when a ruby is absent; katakana there would score every word wrongReading.
        val tokens = loadCorpus().entries.flatMap { tokenize(it.text) }
        assertTrue(tokens.isNotEmpty())
        for (t in tokens) assertFalse("katakana reading '${t.reading}' on '${t.surface}'", t.reading.orEmpty().any(::isKatakana))
    }

    @Test fun `a conjugated verb carries its dictionary form`() {
        val t = tokenize("雨が降っている").first { it.surface == "降っ" }
        assertEquals("降る", t.baseForm)
    }

    @Test fun `character offsets let a tap find its token`() {
        val text = "今日は雨が降る"
        val tokens = tokenize(text)
        assertTrue(tokens.size > 1)
        for (t in tokens) assertEquals(t.surface, text.substring(t.start, t.start + t.surface.length))
        assertEquals(0, tokens.first().start)
        assertEquals(text.indexOf("雨"), tokens.first { it.surface == "雨" }.start)
    }

    @Test fun `an ASCII line tokenises without crashing and yields no readings`() {
        val tokens = tokenize("hello world")
        assertTrue(tokens.isNotEmpty())
        assertTrue(tokens.all { it.reading == null })
        assertEquals(listOf("hello", "world"), tokens.map { it.surface }.filter { it.isNotBlank() })
    }

    @Test fun `an empty string yields no tokens`() {
        assertEquals(emptyList<JaToken>(), tokenize(""))
    }

    @Test fun `a mixed Japanese and English line keeps both, in order`() {
        val text = "雨 is rain"
        val tokens = tokenize(text)
        val surfaces = tokens.map { it.surface }
        assertTrue(surfaces.indexOf("雨") < surfaces.indexOf("is"))
        assertTrue(surfaces.indexOf("is") < surfaces.indexOf("rain"))
        assertEquals("あめ", tokens.first { it.surface == "雨" }.reading)
        assertNull(tokens.first { it.surface == "rain" }.reading)
    }

    @Test fun `a sentence with spaces yields no blank token and offsets still index the original text`() {
        val text = "今日は  雨 が 降る hello  world"
        val tokens = tokenize(text)
        assertTrue(tokens.none { it.surface.isBlank() })
        assertTrue(tokens.size > 3)
        for (t in tokens) assertEquals(t.surface, text.substring(t.start, t.start + t.surface.length))
        assertEquals(text.indexOf("雨"), tokens.first { it.surface == "雨" }.start)
        assertEquals(text.indexOf("world"), tokens.first { it.surface == "world" }.start)
    }
}
