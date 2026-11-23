package net.ninjaruss.utasync.japanese

import net.ninjaruss.utasync.data.DictionaryDao
import net.ninjaruss.utasync.data.DictionaryEntity

/**
 * Turns a line into words with readings and meanings: tokenise, then one [Ruby] and one set of
 * [Sense]s per token.
 *
 * **One call, one reading.** The ruby over the line and the reading in the popover are the same
 * object, produced here by [rubyFor] from the same token in the same [ReadingMode]. Two callers
 * cannot drift apart because there is only one place a reading is decided (plan Review Focus 2).
 *
 * The dictionary and the alternates are injected rather than reached for: it keeps this testable
 * off-device (the alternates asset is parsed by [parseReadingAlternates], and the dictionary is a
 * Room DAO), and it matches [rubyFor]'s own shape.
 *
 * [WordInfo.role] is left null. Roles are Task 6's; a placeholder here would be a claim about
 * grammar that nothing had computed.
 */
class Analyzer(
    private val dictionary: DictionaryDao,
    private val alternates: (String) -> List<String>,
) {
    suspend fun analyze(text: String, mode: ReadingMode): List<WordInfo> = tokenize(text).map { token ->
        WordInfo(token, rubyFor(token, mode, alternates), sensesFor(token), role = null)
    }

    /**
     * Two lookups — the surface and the dictionary form — and the order between them depends on
     * whether the surface is a conjugated form.
     *
     * **An inflecting word is looked up by its dictionary form first.** A conjugated surface is
     * not a headword, so an entry it happens to match is a different word: 見 (of 見ていた) is
     * listed as the suffix み "looking", while the token is a verb whose base form 見る is "to
     * see"; なり (of なりたい) is the particle なり, while なる is "to become". For everything else
     * the surface comes first, which is what lets 時 read じ find "o'clock" rather than the base
     * form's "time" — the same surface-then-base order [rubyFor] uses for alternates.
     *
     * The first lookup with an entry the token's part of speech could wear wins. Where neither
     * has one, the first lookup that found anything at all is shown rather than nothing: that is
     * a word the dictionary has, only not in this class, and a near sense beats a blank (the
     * PWA's blanks went 18 -> 3 by widening lookups, not by narrowing them).
     */
    private suspend fun sensesFor(token: JaToken): List<Sense> {
        val base = token.baseForm?.takeIf { it.isNotBlank() && it != token.surface }
        val order = when {
            base == null -> listOf(token.surface)
            token.pos in INFLECTING_POS -> listOf(base, token.surface)
            else -> listOf(token.surface, base)
        }
        var found = emptyList<DictionaryEntity>()
        for (key in order) {
            val entries = dictionary.entriesFor(key)
            if (entries.any { posMatches(token, it) }) return selectSenses(token, entries)
            if (found.isEmpty()) found = entries
        }
        return selectSenses(token, found)
    }
}
