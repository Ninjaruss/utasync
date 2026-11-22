package net.ninjaruss.utasync.japanese

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UnderstandingAuditTest {
    private fun stub(text: String): List<WordInfo> = runSuspend { analyze(text, ReadingMode.DICTIONARY) }

    @Test fun `the audit reports every word wrong against a stub analyzer`() {
        val corpus = loadCorpus()
        val counts = auditAgainst(corpus, ::stub)
        assertTrue(counts.words > 0) // the corpus is not empty
        assertEquals(counts.words, counts.blank) // a stub supplies no meanings at all
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

    @Test fun `the counters score a hand-worked two-word case`() {
        // A fake analyzer pinned on a two-word corpus so the counters are
        // checked by a case worked out by hand rather than by the stub.
        val words = listOf(
            CorpusWord("明白", "めいはく", "obvious", listOf("あからさま")),
            CorpusWord("事実", "じじつ", "fact", emptyList()),
        )
        val corpus = Corpus(1, listOf(CorpusEntry("明白な事実", "hand-labelled", "test", words)))
        fun info(surface: String, reading: String, alts: List<String>, gloss: String) = WordInfo(
            JaToken(surface, reading, "noun", surface, 0),
            Ruby(surface, reading, alts),
            listOf(Sense(null, listOf(gloss))),
            null,
        )
        val counts = auditAgainst(corpus) {
            listOf(info("明白", "あきらか", emptyList(), "bright"), info("事実", "じじつ", emptyList(), "fact"))
        }
        assertEquals(AuditCounts(words = 2, wrongReading = 1, wrongSense = 1, blank = 0, unmarkedAlternates = 1), counts)
    }

    @Test fun `the committed baseline matches the current counts`() {
        val actual = auditAgainst(loadCorpus(), ::stub)
        val certified = auditAgainst(loadCorpus().certified(), ::stub)
        assertEquals("audit-baseline.json is stale: ${renderBaseline(actual, certified)}", loadBaseline(), actual to certified)
    }
}
