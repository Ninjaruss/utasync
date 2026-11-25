package net.ninjaruss.utasync.japanese

/**
 * Furigana for [token], or null where it needs none (reading mode OFF, no reading, or a reading
 * that is just the surface in kana).
 *
 * The reading shown is always the dictionary reading. [alternates] maps a surface to the other
 * readings it is known to take; they are carried on the [Ruby] so the UI can mark the word as
 * ambiguous (spec 4.2). This never asserts which reading is being sung.
 *
 * [ReadingMode.SUNG] currently behaves exactly as [ReadingMode.DICTIONARY]. It is where an
 * alignment engine's audio reading would be promoted above the dictionary one, but no engine
 * produces a transcript yet, so there is nothing to promote.
 *
 * Alternates are looked up by surface first, then by [JaToken.baseForm] (行って has none under its
 * own surface, but 行く does). The two levels differ deliberately: [Ruby.reading] is always the
 * surface's reading (いって), while alternates found through the base form are dictionary-form
 * readings (いく / ゆく). So the mark does not mean "this surface is also spelled these ways"; it
 * means "this word is read more than one way". A popover showing the headword lists them.
 *
 * **[baseReading] is why the base-form level needs its own filter.** On that level the readings
 * belong to a different string from the surface, so the word's OWN reading is in the list and
 * string equality with [Ruby.reading] can never remove it: 行っ, read いっ, was marked because 行く
 * is read いく, and the popover printed "also read いく" over a word already read いく-inflected.
 * [baseReading] gives the reading the base form has standing alone, and that one is dropped. It
 * is NOT applied to the surface level: there the key is the surface itself, its own reading is
 * the shown one, and dropping "the key's reading" would delete a genuine rival from any word
 * shown in its less common reading (時 as じ would lose とき).
 *
 * It is required rather than defaulted for the reason the gesture handlers in `RubyText` are: a
 * caller who could leave it out could put the self-reference back with nothing failing.
 *
 * Pure: [alternates] and [baseReading] are injected so this needs neither a data file nor the
 * tokenizer. It is never called with a blank surface, nor for a token that gets no ruby.
 */
fun rubyFor(
    token: JaToken,
    mode: ReadingMode,
    alternates: (String) -> List<String>,
    baseReading: (String) -> String?,
): Ruby? {
    if (mode == ReadingMode.OFF) return null
    val reading = token.reading?.takeIf { it.isNotEmpty() } ?: return null
    if (token.surface.isBlank()) return null
    if (toHiragana(token.surface) == reading) return null
    val own = alternates(token.surface)
    val base = token.baseForm?.takeIf { it.isNotBlank() && it != token.surface }
    val found: List<String>
    val selfReference: String?
    if (own.isNotEmpty() || base == null) {
        found = own
        selfReference = null
    } else {
        found = alternates(base)
        // Asked only where the base form answered: the reading of a form nothing was found for
        // would cost a tokenisation for nothing.
        selfReference = if (found.isEmpty()) null else baseReading(base)
    }
    val others = found.filter { it.isNotEmpty() && it != reading && it != selfReference }.distinct()
    return Ruby(token.surface, reading, others)
}
