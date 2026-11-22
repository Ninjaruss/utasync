package net.ninjaruss.utasync.japanese

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UnderstandingAuditTest {
    private fun stub(text: String): List<WordInfo> = runSuspend { analyze(text, ReadingMode.DICTIONARY) }

    @Test fun `the audit reports every word unmatched against a stub analyzer`() {
        val corpus = loadCorpus()
        val counts = auditAgainst(corpus, ::stub)
        assertTrue(counts.words > 0) // the corpus is not empty
        assertEquals(counts.words, counts.unmatched) // a stub returns no words at all
        assertEquals(0, counts.right)
        assertEquals(counts.words, counts.verdictSum)
        // The corpus's own word count, derived rather than restated, so a short-circuit that
        // returns zeros or the analyzer's count cannot pass.
        assertEquals(corpus.entries.sumOf { it.words.size }, counts.words)
    }

    @Test fun `only hand-labelled entries count toward the gate`() {
        val word = CorpusWord("今", "いま", "now", emptyList())
        fun entry(kind: String) = CorpusEntry("今", kind, "test", listOf(word))
        val corpus = Corpus(1, listOf(entry("hand-labelled"), entry("generated"), entry("unverified")))
        // Scored: every kind that can be scored contributes to the full count...
        assertEquals(3, auditAgainst(corpus, ::stub).words)
        // ...but the gate sees only the one that certifies.
        assertEquals(1, auditAgainst(corpus.certified(), ::stub).words)
        assertEquals(listOf("hand-labelled"), corpus.certified().entries.map { it.kind })
        assertFalse(canCertify("generated"))
        assertFalse(canCertify("unverified"))
        assertTrue(canCertify("hand-labelled"))
        assertFalse(canCertify("not-a-kind")) // an unknown kind never certifies
    }

    @Test fun `every committed entry names a known kind and a source`() {
        for (e in loadCorpus().entries) {
            assertTrue("unknown kind '${e.kind}'", isKnownKind(e.kind))
            assertTrue("entry has no source", e.source.isNotBlank())
        }
    }

    @Test fun `the corpus carries no Latin-script song text`() {
        // Rule 6 by shape: a sentence containing any Latin letter is rejected, so an
        // English or romanised lyric line cannot be committed here by accident.
        for (e in loadCorpus().entries) {
            assertFalse("Latin letters in a corpus sentence", e.text.any { it in 'A'..'Z' || it in 'a'..'z' })
        }
    }

    @Test fun `the counters give each word exactly one verdict in a hand-worked case`() {
        fun w(s: String, r: String, g: String, alts: List<String> = emptyList()) = CorpusWord(s, r, g, alts)
        val words = listOf(
            w("明白", "めいはく", "obvious", listOf("あからさま")), // wrong reading, unmarked (the only one)
            w("事実", "じじつ", "fact"), // wrong sense
            w("今日", "きょう", "today", listOf("こんにち")), // right, marked
            w("雨", "あめ", "rain"), // blank
            w("道", "みち", "road"), // unmatched
        )
        val corpus = Corpus(1, listOf(CorpusEntry("x", "hand-labelled", "test", words)))
        fun info(surface: String, reading: String, alts: List<String>, gloss: String?) = WordInfo(
            JaToken(surface, reading, "noun", surface, 0),
            Ruby(surface, reading, alts),
            if (gloss == null) emptyList() else listOf(Sense(null, listOf(gloss))),
            null,
        )
        val counts = auditAgainst(corpus) {
            listOf(
                info("明白", "あきらか", emptyList(), "obvious"),
                info("事実", "じじつ", emptyList(), "truth"),
                info("今日", "きょう", listOf("こんにち"), "today"),
                info("雨", "あめ", emptyList(), null),
            )
        }
        assertEquals(
            AuditCounts(words = 5, right = 1, wrongReading = 1, wrongSense = 1, blank = 1, unmatched = 1, unmarkedAlternates = 1),
            counts,
        )
        assertEquals(counts.words, counts.verdictSum)
    }

    @Test fun `the committed baseline matches the current counts`() {
        val actual = auditAgainst(loadCorpus(), ::stub)
        val certified = auditAgainst(loadCorpus().certified(), ::stub)
        assertEquals(actual.words, actual.verdictSum)
        assertEquals(certified.words, certified.verdictSum)
        assertEquals("audit-baseline.json is stale: ${renderBaseline(actual, certified)}", loadBaseline(), actual to certified)
    }
}
