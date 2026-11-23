package net.ninjaruss.utasync.japanese

import net.ninjaruss.utasync.data.DictionaryDao
import net.ninjaruss.utasync.data.DictionaryEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SenseSelectionTest {
    private fun entry(surface: String, reading: String, pos: String?, vararg glosses: String, index: Int = 0) =
        DictionaryEntity(surface, reading, pos, glosses.toList(), index)

    /** A dictionary held in memory: the real table's contract (ordered by senseIndex), no Room. */
    private class FakeDictionary(private val rows: List<DictionaryEntity>) : DictionaryDao {
        override suspend fun entriesFor(surface: String): List<DictionaryEntity> =
            rows.filter { it.surface == surface }.sortedBy { it.senseIndex }

        override suspend fun entriesFor(surface: String, reading: String): List<DictionaryEntity> =
            entriesFor(surface).filter { it.reading == reading }
    }

    private fun analyzed(text: String, rows: List<DictionaryEntity>, mode: ReadingMode = ReadingMode.DICTIONARY) =
        runSuspend { Analyzer(FakeDictionary(rows)) { emptyList() }.analyze(text, mode) }

    private fun analyzedWord(text: String, surface: String, rows: List<DictionaryEntity>) =
        analyzed(text, rows).first { it.token.surface == surface }

    // The same reading, three parts of speech: the dictionary's own order puts the particle first,
    // so anything that takes the first entry gets the particle every time.
    private val ga = listOf(
        entry("が", "が", "prt", "indicates the subject of a sentence", index = 0),
        entry("が", "が", "conj", "but", "however", index = 1),
        entry("が", "が", "n", "picture", "drawing", index = 2),
    )

    // Review Focus 5.
    @Test fun `a homograph picks the sense matching the token's part of speech`() {
        val noun = selectSenses(JaToken("が", "が", "名詞", "が", 0), ga)
        assertEquals(listOf("picture", "drawing"), noun.first().glosses)
        val conj = selectSenses(JaToken("が", "が", "接続詞", "が", 0), ga)
        assertEquals(listOf("but", "however"), conj.first().glosses)
        // The two disagree, so this cannot be passing because one answer suits every token.
        assertTrue(noun.first().glosses != conj.first().glosses)
    }

    // Review Focus 4 — the PWA's blanks went 18 -> 3; these are what kept them falling.
    @Test fun `a conjugated verb resolves through its dictionary form`() {
        // Real tokenisation: 降っ is what Kuromoji returns, and 降る is the baseForm it carries.
        val rows = listOf(entry("降る", "ふる", "v", "to fall", "to come down"))
        val word = analyzedWord("雨が降っている。", "降っ", rows)
        assertEquals("降る", word.token.baseForm)
        assertEquals(listOf("to fall", "to come down"), word.senses.single().glosses)
    }

    @Test fun `an adjective in a non-dictionary form resolves`() {
        val rows = listOf(
            entry("寒い", "さむい", "adj", "cold (e.g. weather)"),
            entry("美しい", "うつくしい", "adj", "beautiful", "pretty"),
        )
        // A past form and a negated adverbial form, each only reachable through its baseForm.
        assertEquals(listOf("cold (e.g. weather)"), analyzedWord("昨日の夜は寒かった。", "寒かっ", rows).senses.single().glosses)
        assertEquals(listOf("beautiful", "pretty"), analyzedWord("美しくない花。", "美しく", rows).senses.single().glosses)
    }

    @Test fun `a word with no entry yields no senses rather than a wrong one`() {
        // Derived: every word of the line, against a dictionary that knows one unrelated word.
        val words = analyzed("明白な事実だ。", listOf(entry("雨", "あめ", "n", "rain")))
        assertTrue("nothing was analysed, the test proves nothing", words.isNotEmpty())
        assertTrue("a word with no entry got senses: $words", words.all { it.senses.isEmpty() })
        // ...and the words are still returned, with their readings: a miss is not a dropped token.
        assertEquals("めいはく", words.first { it.token.surface == "明白" }.ruby?.reading)
    }

    // The two inherited rules (spec 7a.1).
    @Test fun `a plain noun keeps its own part of speech label`() {
        val unlabelled = entry("空", "そら", null, "sky")
        // A noun whose source gave no part of speech keeps none: nothing forces "n" onto it.
        assertNull(selectSenses(JaToken("空", "そら", "名詞", "空", 0), listOf(unlabelled)).single().posLabel)
        assertEquals("n", selectSenses(JaToken("空", "そら", "名詞", "空", 0), listOf(entry("空", "そら", "n", "sky"))).single().posLabel)
        // Derived over every corpus token and the labels the dictionary actually holds: no sense
        // may carry a label that was not in its own entries.
        val rows = ga + unlabelled
        val labels = rows.map { it.posLabel }.toSet()
        var seen = 0
        for (entryText in loadCorpus().entries) for (t in tokenize(entryText.text)) {
            for (s in selectSenses(t, rows)) { seen++; assertTrue("invented label ${s.posLabel}", s.posLabel in labels) }
        }
        assertTrue("no sense was selected, the test proves nothing", seen > 0)
    }

    @Test fun `a grammar word yields exactly one sense`() {
        // Derived over the whole grammar-word set, not one example: every one of them gets one sense.
        assertTrue(GRAMMAR_POS.isNotEmpty())
        for (pos in GRAMMAR_POS) {
            val senses = selectSenses(JaToken("が", "が", pos, "が", 0), ga)
            assertEquals("$pos got ${senses.size} senses", 1, senses.size)
        }
        // A word that is not a grammar word keeps the several it has: the cut is the rule, not a cap.
        assertTrue(selectSenses(JaToken("明白", "めいはく", "名詞", "明白", 0), listOf(
            entry("明白", "めいはく", "adj", "obvious", index = 0),
            entry("明白", "めいはく", "n", "clarity", index = 1),
        )).size > 1)
    }

    // Review Focus 2 — the consistency contract: one call, one token, one mode, one reading.
    @Test fun `the WordInfo's ruby and its senses describe the same reading`() {
        val alternates: (String) -> List<String> = { if (it == "人気") listOf("ひとけ") else emptyList() }
        val rows = listOf(
            entry("人気", "にんき", "n", "popularity", index = 0),
            entry("人気", "ひとけ", "n", "sign of life", index = 1),
        )
        // The reading on the ruby and the reading the senses came from are the same one: the
        // token's. Reading ひとけ must not be glossed "popularity" just because it comes first.
        for ((reading, gloss) in listOf("にんき" to "popularity", "ひとけ" to "sign of life")) {
            val senses = selectSenses(JaToken("人気", reading, "名詞", "人気", 0), rows)
            assertEquals(listOf(gloss), senses.single().glosses)
        }
        // And structurally: the ruby on a WordInfo is rubyFor's, for the same token and mode, so
        // the popover and the line cannot disagree. Derived over every corpus token, every mode.
        var rubies = 0
        for (corpusEntry in loadCorpus().entries) {
            for (mode in ReadingMode.values()) {
                val words = runSuspend { Analyzer(FakeDictionary(rows), alternates).analyze(corpusEntry.text, mode) }
                assertEquals(tokenize(corpusEntry.text).size, words.size)
                for (w in words) {
                    assertEquals(rubyFor(w.token, mode, alternates), w.ruby)
                    if (w.ruby != null) rubies++
                }
            }
        }
        assertTrue("no ruby was produced, the test proves nothing", rubies > 0)
        assertNotNull(analyzedWord("今日は雨が降っている。", "今日", rows).ruby)
    }

    @Test fun `a role is not invented here`() {
        // Task 6 fills roles in; until then every role is null rather than a placeholder.
        val words = analyzed("明白な事実だ。", ga)
        assertTrue(words.isNotEmpty())
        assertTrue(words.all { it.role == null })
    }
}
