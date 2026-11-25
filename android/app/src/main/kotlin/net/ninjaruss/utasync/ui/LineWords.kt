package net.ninjaruss.utasync.ui

import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.ninjaruss.utasync.japanese.Analyzer
import net.ninjaruss.utasync.japanese.ReadingMode
import net.ninjaruss.utasync.japanese.WordInfo

/**
 * How many analysed lines are kept. A bound on memory, not a tuned number: no budget is set
 * (ledger L54), and it is a constructor parameter so a caller can say otherwise. Comfortably more
 * than a screenful, so scrolling back up never re-analyses.
 */
const val MAX_CACHED_LINES: Int = 64

/**
 * Analysed lines, one line at a time, off the main thread.
 *
 * `analyze` is suspending, hits Room and tokenises with Kuromoji, whose first call costs about
 * 480 ms on an emulator (ledger L52). So it is never called from a composable body: a line is
 * analysed in a [LaunchedEffect] and **renders as plain text until it comes back** — the lyric is
 * on screen before the furigana is, with no spinner and no blank row.
 *
 * Keyed by line index **and** the line's text, so replacing a song's lyric sheet cannot show the
 * old line's words against the new line (spec 7 item 7).
 */
class LineWordsCache(
    private val analyzer: suspend () -> Analyzer,
    private val mode: ReadingMode,
    maxLines: Int = MAX_CACHED_LINES,
) {
    private val cache = object : LinkedHashMap<String, List<WordInfo>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<WordInfo>>): Boolean =
            size > maxLines
    }

    /** What is already analysed, without blocking: a cache hit must not cost a frame. */
    fun peek(index: Int, text: String): List<WordInfo>? = synchronized(cache) { cache[key(index, text)] }

    /**
     * The line's words, analysed if need be. Null when analysis failed — a missing asset or an
     * unreadable dictionary leaves the line as plain text rather than taking the screen down.
     */
    suspend fun words(index: Int, text: String): List<WordInfo>? {
        peek(index, text)?.let { return it }
        return try {
            withContext(Dispatchers.Default) { analyzer().analyze(text, mode) }
                .also { synchronized(cache) { cache[key(index, text)] = it } }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The failure's type only: never a line of lyrics in a log (ADR-0004).
            Log.w("Utasync", "line analysis failed: ${e.javaClass.simpleName}")
            null
        }
    }

    private fun key(index: Int, text: String) = "$index\u0000$text"
}

/**
 * The words of one line, or null while it has not been analysed yet. A cached line comes back on
 * the first composition, so scrolling does not flicker between plain text and furigana.
 */
@Composable
fun rememberLineWords(cache: LineWordsCache, index: Int, text: String): List<WordInfo>? {
    var words by remember(cache, index, text) { mutableStateOf(cache.peek(index, text)) }
    LaunchedEffect(cache, index, text) { if (words == null) words = cache.words(index, text) }
    return words
}
