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
        val noun = selectSenses(JaToken(surface = "が", reading = "が", pos = "名詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "が", start = 0), ga)
        assertEquals(listOf("picture", "drawing"), noun.first().glosses)
        val conj = selectSenses(JaToken(surface = "が", reading = "が", pos = "接続詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "が", start = 0), ga)
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
        assertNull(selectSenses(JaToken(surface = "空", reading = "そら", pos = "名詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "空", start = 0), listOf(unlabelled)).single().posLabel)
        assertEquals("n", selectSenses(JaToken(surface = "空", reading = "そら", pos = "名詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "空", start = 0), listOf(entry("空", "そら", "n", "sky"))).single().posLabel)
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
            val senses = selectSenses(JaToken(surface = "が", reading = "が", pos = pos, posDetail = null, conjugation = null, conjugationType = null, baseForm = "が", start = 0), ga)
            assertEquals("$pos got ${senses.size} senses", 1, senses.size)
        }
        // A word that is not a grammar word keeps the several it has: the cut is the rule, not a cap.
        assertTrue(selectSenses(JaToken(surface = "明白", reading = "めいはく", pos = "名詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "明白", start = 0), listOf(
            entry("明白", "めいはく", "adj", "obvious", index = 0),
            entry("明白", "めいはく", "n", "clarity", index = 1),
        )).size > 1)
    }

    // Review Focus 2 — the consistency contract: one call, one token, one mode, one reading.
    /**
     * The contract Review Focus 2 is actually about: a word's glosses must be the glosses of
     * entries read the way its ruby says, over REAL dictionary rows and real `Analyzer` output.
     *
     * The previous version of this test asserted `rubyFor(w.token, mode, alternates) == w.ruby`,
     * which `Analyzer` satisfies by calling `rubyFor` — it restated the implementation. And its
     * sense half called `selectSenses` directly against a two-row fake, so no assertion ever tied
     * a real `WordInfo`'s ruby to its senses. Both halves passed; neither tested the contract.
     */
    @Test fun `every analyzed word's senses come from entries read the way its ruby says`() {
        val corpus = loadCorpus()
        val dictionary = CorpusDictionary(corpusSurfaces(corpus))
        val alternates = shippedAlternates()
        val analyzer = Analyzer(dictionary, alternates)

        var checked = 0
        var throughDictionaryForm = 0
        var readingFilterStoodAside = 0
        for (corpusEntry in corpus.entries) {
            for (w in runSuspend { analyzer.analyze(corpusEntry.text, ReadingMode.DICTIONARY) }) {
                if (w.senses.isEmpty()) continue
                val reading = w.ruby?.reading ?: w.token.reading ?: continue
                val inflected = w.token.baseForm?.let { it.isNotBlank() && it != w.token.surface } == true
                val keys = listOfNotNull(w.token.surface, w.token.baseForm).distinct()
                val all = keys.flatMap { runSuspend { dictionary.entriesFor(it) } }
                val shown = w.senses.flatMap { it.glosses }.toSet()

                // Whatever happens, a gloss must come from the dictionary and not from nowhere.
                assertTrue(
                    "glosses for '${w.token.surface}' are not in the dictionary at all",
                    shown.isNotEmpty() && shown.all { g -> all.any { g in it.glosses } },
                )

                // An inflected word is glossed through its DICTIONARY FORM, whose reading differs
                // from the surface's by construction (な is the copula だ's attributive form, and
                // "be; is" is だ's gloss, correctly). The first version of this test required the
                // senses to sit at the ruby's reading for every word, which made it fail on な —
                // the contract was wrong, not the code. Readings.kt's KDoc draws the same
                // distinction for alternates.
                if (inflected) {
                    throughDictionaryForm++
                    continue
                }

                val atThatReading = all.filter { it.reading == reading }
                if (atThatReading.isEmpty()) {
                    // The documented fallback: no entry has this reading, so the filter stands
                    // aside rather than returning nothing. Counted, not asserted away.
                    readingFilterStoodAside++
                } else {
                    val allowed = atThatReading.flatMap { it.glosses }.toSet()
                    assertEquals(
                        "'${w.token.surface}' read $reading was glossed from another reading",
                        emptySet<String>(),
                        shown - allowed,
                    )
                    checked++
                }
            }
        }
        // Without these the loop could check nothing and still pass.
        assertTrue("no uninflected word exercised the contract, so this proved nothing", checked >= 20)
        assertTrue("no inflected word was seen, so that branch proved nothing", throughDictionaryForm > 0)
        println(
            "sense-reading contract: $checked checked, $throughDictionaryForm through a dictionary " +
                "form, $readingFilterStoodAside with no entry at the surface's reading",
        )
    }

    @Test fun `a homograph's senses follow the token's reading, not the dictionary's order`() {
        val alternates: (String) -> List<String> = { if (it == "人気") listOf("ひとけ") else emptyList() }
        val rows = listOf(
            entry("人気", "にんき", "n", "popularity", index = 0),
            entry("人気", "ひとけ", "n", "sign of life", index = 1),
        )
        // The reading on the ruby and the reading the senses came from are the same one: the
        // token's. Reading ひとけ must not be glossed "popularity" just because it comes first.
        for ((reading, gloss) in listOf("にんき" to "popularity", "ひとけ" to "sign of life")) {
            val senses = selectSenses(JaToken(surface = "人気", reading = reading, pos = "名詞", posDetail = null, conjugation = null, conjugationType = null, baseForm = "人気", start = 0), rows)
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
        // Task 5 asserted every role was null, which was true only until Task 6 existed. The
        // claim this test is named for survives: `analyze` invents no role of its own — the
        // roles on its words are exactly what `roleOf` names, and the words it has nothing
        // mechanical to say about keep a null role rather than a placeholder.
        val words = analyzed("明白な事実だ。", ga)
        assertTrue(words.isNotEmpty())
        assertEquals("links the adjective to the next noun", words.first { it.token.surface == "な" }.role)
        assertEquals("states 'is'", words.first { it.token.surface == "だ" }.role)
        assertNull(words.first { it.token.surface == "明白" }.role)
        assertNull(words.first { it.token.surface == "事実" }.role)
        assertNull(words.first { it.token.surface == "。" }.role)
    }
}
