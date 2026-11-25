package net.ninjaruss.utasync.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.ninjaruss.utasync.japanese.WordInfo

/**
 * The sheet's own heading, and the note under it.
 *
 * **This is the 4.1 anti-goal made into two strings.** The sheet lists a line's words in order
 * with their meanings; it is not prose and it must never be labelled a translation — a legal
 * constraint (nothing republished), a technical one (there is no offline translator) and a
 * pedagogical one (mid-song, knowing which word means what beats a smooth paraphrase) at once.
 */
const val LINE_WORDS_HEADING: String = "Words in this line"
const val LINE_WORDS_NOTE: String = "Each word in order, with its meaning. Not a translation."

/**
 * A line's words, in order, one meaning each. No role column: roles land on 40–50% of tokens, so
 * a column three-fifths blank reads as missing data (the owner's 2026-11-23 decision). Roles are
 * in [WordPopover] only.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LineWordsSheet(words: List<WordInfo>, onClose: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState()) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
            Text(LINE_WORDS_HEADING, style = MaterialTheme.typography.headlineSmall)
            Text(
                LINE_WORDS_NOTE,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
            )
            LazyColumn {
                itemsIndexed(words) { _, word ->
                    val card = wordCard(word)
                    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                        Text(
                            card.reading?.let { "${card.headword}（$it）" } ?: card.headword,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        // A word with no entry gets a blank line rather than "no entry" repeated
                        // down the list; a non-Japanese word is shown as it is (spec 7 item 8).
                        shortMeaning(word)?.let {
                            Text(
                                it,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}
