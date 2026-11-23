package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.japanese.JaToken
import net.ninjaruss.utasync.japanese.Ruby
import net.ninjaruss.utasync.japanese.Sense
import net.ninjaruss.utasync.japanese.WordInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * One analysed word, for tests. Invented text only: no song lyrics anywhere in this repository
 * (CLAUDE.md rule 6).
 */
internal fun testWord(
    surface: String,
    reading: String? = null,
    start: Int = 0,
    pos: String = "名詞",
    alternates: List<String> = emptyList(),
    senses: List<Sense> = emptyList(),
    role: String? = null,
): WordInfo = WordInfo(
    token = JaToken(surface, reading, pos, null, null, null, null, start),
    ruby = reading?.let { Ruby(surface, it, alternates) },
    senses = senses,
    role = role,
)

/** The words of an invented line, with the start offsets the tokeniser would give them. */
internal fun testLine(vararg pairs: Pair<String, String?>): List<WordInfo> {
    var at = 0
    return pairs.map { (surface, reading) ->
        testWord(surface, reading, start = at).also { at += surface.length }
    }
}

class RubyLayoutTest {
    // 空 (そら) は 青い (あおい) — invented, and the readings are unambiguous.
    private val sky = testLine("空" to "そら", "は" to "は", "青い" to "あおい")

    @Test fun `a line too long for one row breaks between words, never inside a ruby group`() {
        // Each word is 10 wide; the row holds 25. Widths are supplied, so this test measures the
        // breaking rule and nothing about fonts.
        val runs = rubyRuns(sky, maxWidthSp = 25f) { 10f }

        assertEquals(listOf(listOf(sky[0], sky[1]), listOf(sky[2])), runs)
        // Nothing lost, nothing reordered, nothing split: a word is the unit, so a break can
        // never fall between a base and the ruby above it.
        assertEquals(sky, runs.flatten())
        assertTrue(runs.all { it.size * 10f <= 25f })
    }

    @Test fun `a word wider than the whole row gets its own run rather than being dropped`() {
        val runs = rubyRuns(sky, maxWidthSp = 5f) { 10f }
        assertEquals(3, runs.size)
        assertEquals(sky, runs.flatten())
    }

    @Test fun `a word's footprint is the wider of its base and its ruby`() {
        // This is why the breaking rule cannot be left to Compose's own text layout: ちから is
        // three half-width characters over a single-character base, so the ruby is what decides
        // where the row runs out.
        val wide = testWord("力", "ちから")
        val narrow = wide.copy(ruby = null)
        assertTrue(nominalWidthSp(wide) > nominalWidthSp(narrow))
        // And a base wider than its ruby keeps the base's width.
        assertEquals(nominalWidthSp(testWord("青い", "あおい").copy(ruby = null)), nominalWidthSp(testWord("青い", "あおい")), 0.01f)
    }

    @Test fun `a word with no reading occupies no ruby row`() {
        val kana = testLine("きみ" to null, "は" to null)
        assertFalse(runHasRuby(kana))
        // A kana word costs only its base: no ruby row is reserved above it.
        assertEquals(nominalWidthSp(kana[0].copy(ruby = null)), nominalWidthSp(kana[0]), 0.01f)
        // One word with a reading is enough to give the whole run its ruby row, so the words of
        // a run keep a common baseline.
        assertTrue(runHasRuby(kana + testWord("空", "そら")))
    }

    @Test fun `an all-ASCII line produces one run and no ruby`() {
        val latin = testLine("Hello" to null, "world" to null)
        val runs = rubyRuns(latin, maxWidthSp = 1_000f)
        assertEquals(1, runs.size)
        assertEquals(latin, runs.single())
        assertFalse(runHasRuby(runs.single()))
        // Not Japanese, so it is not a word to tap either (spec 7 item 8).
        assertFalse(isJapanese(latin[0].token.surface))
        assertTrue(isJapanese("空"))
        assertTrue(isJapanese("きみ"))
        assertTrue(isJapanese("カタカナ"))
    }

    @Test fun `a Latin word keeps the space the tokeniser dropped after it`() {
        // tokenize() drops blank surfaces, so "Hello world" arrives as two words with a gap
        // between their start offsets. Rendered word-by-word without that gap it reads as
        // "Helloworld"; the gap is restored from the offsets, and it is measured, so the row
        // that holds it accounts for it.
        var at = 0
        val latin = listOf("Hello", "world").map { testWord(it, start = at).also { _ -> at += it.length + 1 } }
        assertEquals("Hello ", spacedBase(latin, 0))
        assertEquals("world", spacedBase(latin, 1))
        // Japanese has no spaces to restore: consecutive offsets mean no gap.
        assertEquals("空", spacedBase(sky, 0))
    }

    @Test fun `an empty line produces no runs`() {
        assertEquals(emptyList<List<WordInfo>>(), rubyRuns(emptyList(), maxWidthSp = 100f))
    }
}
