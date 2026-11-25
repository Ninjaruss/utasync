package net.ninjaruss.utasync.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import net.ninjaruss.utasync.japanese.WordInfo

/** Shown in place of senses for a word the dictionary does not have. */
const val NO_ENTRY_NOTE: String = "No dictionary entry for this word."

/**
 * What the popover shows for one word. Every field that has nothing to say is **null, and draws
 * no row at all** — never an empty one. A kana word has no [reading] because it needs none, a
 * word with one known reading has no [alternates], and a word whose part in the line adds nothing
 * has no [role] (the owner's 2026-11-23 scope decision: roles appear here and nowhere else).
 */
data class WordCard(
    val headword: String,
    val reading: String?,
    val alternates: String?,
    val role: String?,
    val senses: List<String>,
    val note: String?,
)

/**
 * The popover's content for [word].
 *
 * The reading is the `Ruby`'s own, so the popover and the furigana above the line cannot disagree
 * (spec 4.2's last paragraph). The alternates line uses [net.ninjaruss.utasync.japanese.Ruby.isAmbiguous],
 * the one predicate for "mark this word", rather than re-deriving ambiguity here, and it names the
 * other readings instead of merely saying others exist.
 */
fun wordCard(word: WordInfo): WordCard {
    val ruby = word.ruby
    val senses = word.senses.map { sense ->
        val glosses = sense.glosses.joinToString("; ")
        sense.posLabel?.let { "$it — $glosses" } ?: glosses
    }
    return WordCard(
        headword = word.token.surface,
        reading = ruby?.reading,
        alternates = if (ruby?.isAmbiguous == true) "Also read ${ruby.alternates.joinToString(", ")}" else null,
        role = word.role,
        senses = senses,
        note = if (senses.isEmpty()) NO_ENTRY_NOTE else null,
    )
}

/**
 * One meaning for the line sheet: the glosses of the word's first sense, which is the sense
 * `selectSenses` chose for this line, or null for a word with no entry — a blank cell, not the
 * words "no entry" repeated down the list.
 */
fun shortMeaning(word: WordInfo): String? =
    word.senses.firstOrNull()?.glosses?.takeIf { it.isNotEmpty() }?.joinToString("; ")

/** A tapped word: its headword, reading, any other readings, what it is doing, and its senses. */
@Composable
fun WordPopover(word: WordInfo, onClose: () -> Unit) {
    val card = wordCard(word)
    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = { TextButton(onClick = onClose) { Text("Close") } },
        title = {
            Column {
                Text(card.headword, style = MaterialTheme.typography.headlineSmall)
                card.reading?.let { Text(it, style = MaterialTheme.typography.titleMedium) }
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                card.alternates?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.tertiary)
                }
                card.role?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                card.senses.forEach { Text(it, style = MaterialTheme.typography.bodyLarge) }
                card.note?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            }
        },
    )
}
