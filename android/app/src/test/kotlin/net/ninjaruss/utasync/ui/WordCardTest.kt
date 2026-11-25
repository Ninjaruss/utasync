package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.japanese.Sense
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WordCardTest {
    @Test fun `the alternates mark travels with its word into the popover`() {
        // 明白 is read めいはく and also あからさま: the ruby marks it, and the popover has to say
        // what the other reading is rather than merely that one exists (spec 4.2).
        val word = testWord("明白", "めいはく", alternates = listOf("あからさま"), senses = listOf(Sense("adj-na", listOf("obvious"))))
        assertTrue(word.ruby!!.isAmbiguous)
        val card = wordCard(word)
        assertEquals("めいはく", card.reading)
        assertEquals("Also read あからさま", card.alternates)
    }

    @Test fun `a word with one known reading shows no alternates line`() {
        val card = wordCard(testWord("空", "そら", senses = listOf(Sense("n", listOf("sky")))))
        assertNull(card.alternates)
    }

    @Test fun `a kana word shows no reading line`() {
        // ruby == null is correct for a word already written in kana, not missing data.
        val card = wordCard(testWord("きみ", senses = listOf(Sense("n", listOf("you")))))
        assertNull(card.reading)
        assertNull(card.alternates)
        assertEquals("きみ", card.headword)
    }

    @Test fun `a word with no role shows no role line`() {
        assertNull(wordCard(testWord("空", "そら")).role)
        assertEquals("marks the topic", wordCard(testWord("は", role = "marks the topic")).role)
    }

    @Test fun `a word the dictionary does not have says so instead of showing an empty list`() {
        val card = wordCard(testWord("Hello"))
        assertEquals(emptyList<String>(), card.senses)
        assertEquals(NO_ENTRY_NOTE, card.note)
        assertNull(shortMeaning(testWord("Hello")))
    }

    @Test fun `a sense keeps its part-of-speech label and all of its glosses`() {
        val word = testWord("空", "そら", senses = listOf(Sense("n", listOf("sky", "the heavens")), Sense(null, listOf("empty"))))
        val card = wordCard(word)
        assertEquals(listOf("n — sky; the heavens", "empty"), card.senses)
        assertNull(card.note)
        // The line sheet shows one meaning per word: the first sense, which is the one selected
        // for this line by selectSenses, not a list.
        assertEquals("sky; the heavens", shortMeaning(word))
    }

    @Test fun `the line sheet's own heading and note name it a word list, not a translation`() {
        // Checks these two strings only, which is the whole point: the 4_1 anti-goal is that the
        // surface never calls itself a translation.
        assertTrue(LINE_WORDS_HEADING.contains("Words"))
        assertFalse(LINE_WORDS_HEADING.lowercase().contains("translat"))
        assertFalse(LINE_WORDS_NOTE.lowercase().contains("translation of"))
        assertTrue(LINE_WORDS_NOTE.lowercase().contains("not a translation"))
    }
}
