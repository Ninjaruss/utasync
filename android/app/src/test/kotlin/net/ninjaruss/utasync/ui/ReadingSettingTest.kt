package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.japanese.ReadingMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The setting's **mapping**, which is the part that can be wrong quietly. The class that reads
 * `SharedPreferences` is not exercised here: that needs a `Context`, and `:app` carries no
 * Robolectric (CLAUDE.md rule 5). So these tests cover what a stored string means, and the words
 * the control says; the storage itself is covered by the compiler and by running the app.
 */
class ReadingSettingTest {
    @Test fun `the default is the dictionary reading, never off`() {
        assertEquals(ReadingMode.DICTIONARY, DEFAULT_READING_MODE)
        assertEquals(DEFAULT_READING_MODE, readingModeFrom(null))
    }

    @Test fun `every ReadingMode round-trips through the setting`() {
        // Derived over the enum, so a mode added later is covered without an edit here.
        for (mode in ReadingMode.entries) assertEquals(mode, readingModeFrom(mode.name))
        assertTrue(ReadingMode.entries.size >= 3)
    }

    @Test fun `a stored value the app no longer knows falls back to the default`() {
        for (stored in listOf("", " ", "dictionary", "ROMAJI", "SUNG_WHEN_KNOWN", "0")) {
            assertEquals("'$stored' should not be a mode", DEFAULT_READING_MODE, readingModeFrom(stored))
        }
    }

    @Test fun `every state has its own label and none of them says romaji`() {
        val labels = ReadingMode.entries.map { readingModeLabel(it) }
        assertEquals(labels.distinct(), labels)
        assertTrue(labels.none { it.isBlank() })
        // Romaji is absent from the product (spec section 3), not a state of this control.
        assertTrue(labels.none { it.contains("romaji", ignoreCase = true) })
    }

    @Test fun `the sung state says it is not hearing anything yet`() {
        // The state must not read as a feature that works: section 4.2's anti-goal is furigana
        // asserting a reading it cannot know, and a label alone would do exactly that.
        assertTrue(SUNG_READING_CAVEAT.contains("dictionary reading today"))
        assertTrue(SUNG_READING_CAVEAT.contains("hears the singing yet"))
    }

    @Test fun `the attribution names each work and the licence it is used under`() {
        val text = DICTIONARY_ATTRIBUTION.joinToString(" ")
        // CC BY-SA requires the credit and the licence by name; both dictionaries get theirs.
        for (required in listOf("JMdict", "Electronic Dictionary Research", "CC BY-SA", "Kuromoji", "Apache", "IPADIC", "Nara Institute")) {
            assertTrue("the attribution no longer names '$required'", text.contains(required))
        }
    }
}
