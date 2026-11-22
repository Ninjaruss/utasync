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
 * Pure: [alternates] is injected so this needs no data file. It is never called with a blank
 * surface, nor for a token that gets no ruby.
 */
fun rubyFor(token: JaToken, mode: ReadingMode, alternates: (String) -> List<String>): Ruby? {
    if (mode == ReadingMode.OFF) return null
    val reading = token.reading?.takeIf { it.isNotEmpty() } ?: return null
    if (token.surface.isBlank()) return null
    if (toHiragana(token.surface) == reading) return null
    val found = alternates(token.surface).ifEmpty {
        token.baseForm?.takeIf { it.isNotBlank() && it != token.surface }?.let(alternates).orEmpty()
    }
    val others = found.filter { it.isNotEmpty() && it != reading }.distinct()
    return Ruby(token.surface, reading, others)
}
