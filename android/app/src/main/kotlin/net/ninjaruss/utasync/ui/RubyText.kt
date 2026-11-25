package net.ninjaruss.utasync.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.isSpecified
import net.ninjaruss.utasync.japanese.WordInfo

/**
 * Ruby is drawn at half the base font size. The conventional ratio, not a measured one, which is
 * why it is a parameter of [RubyText] rather than a constant inside it (CLAUDE.md rule 2).
 */
const val RUBY_SCALE: Float = 0.5f

/**
 * Breaks [words] into the rows they are drawn on, greedily and left to right.
 *
 * **A word is the unit, so a break can never fall between a base and the ruby above it.** That is
 * the whole reason this exists: Compose has no ruby text (spec 5), and its own line breaking sees
 * only the base string — a word whose reading is wider than its surface (口 over くち) would then
 * overflow the row it was told fits. [widthOf] reports a word's real footprint, the wider of its
 * base and its ruby, and the breaking is decided from that.
 *
 * Pure on purpose: the wrapping rule is the part most likely to be wrong and there is no device in
 * CI. [widthOf] takes an **index**, not a word, so a line that repeats a word (は twice) cannot
 * confuse two of them. [RubyText] passes widths it measured with Compose's own text measurer; the
 * default [nominalWidthSp] estimator is for tests and previews and gates nothing on screen.
 *
 * **[maxWidth] and [widthOf] are in one unit, whichever the caller chose, and the function never
 * converts.** [RubyText] works in pixels on purpose: under Android 14's nonlinear font scaling a
 * text unit is not a fixed number of pixels, so adding up sp widths and comparing the total
 * against a container converted with `Dp.toSp()` compares two different scales and wraps a line
 * early or late at large font sizes. Pixels are additive at every scale. The default estimator
 * returns sp, so a caller that takes it must pass [maxWidth] in sp too.
 *
 * A word wider than the whole row gets a run to itself rather than being dropped. An empty line
 * produces no runs. The runs are in order and contiguous, so walking them yields every word once,
 * which is how [RubyText] recovers a word's index in [words].
 */
fun rubyRuns(
    words: List<WordInfo>,
    maxWidth: Float,
    widthOf: (Int) -> Float = { nominalWidthSp(words[it]) },
): List<List<WordInfo>> {
    if (words.isEmpty()) return emptyList()
    val runs = ArrayList<MutableList<WordInfo>>()
    var current = ArrayList<WordInfo>()
    var used = 0f
    words.forEachIndexed { i, word ->
        val width = widthOf(i)
        if (current.isNotEmpty() && used + width > maxWidth) {
            runs += current
            current = ArrayList()
            used = 0f
        }
        current += word
        used += width
    }
    runs += current
    return runs
}

/**
 * Whether this run needs a ruby row above it.
 *
 * One word with a reading gives the whole run its row, so every word in the run keeps the same
 * baseline; a run of kana reserves nothing. A word whose `ruby` is null is correct, not missing
 * data — it is already written in kana.
 */
fun runHasRuby(run: List<WordInfo>): Boolean = run.any { it.ruby?.reading != null }

/**
 * The text drawn for word [index], with the space the tokeniser dropped after it.
 *
 * `tokenize` filters blank surfaces, so "Hello world" arrives as two words and drawing them
 * side by side reads as "Helloworld". A gap between one word's end and the next word's start
 * means there was whitespace there. Japanese words sit at consecutive offsets and get nothing.
 */
fun spacedBase(words: List<WordInfo>, index: Int): String {
    val token = words[index].token
    val next = words.getOrNull(index + 1)?.token ?: return token.surface
    return if (next.start > token.start + token.surface.length) token.surface + " " else token.surface
}

/**
 * A rough footprint for one word, in sp: the wider of its base and its ruby.
 *
 * **Nominal, not measured.** Full-width characters count as one em and ASCII as [asciiEm]; no
 * font is consulted. Nothing on screen is laid out from this — [RubyText] measures with Compose's
 * text measurer — so it gates no behaviour; it exists so [rubyRuns] has a default and so previews
 * and tests can produce plausible widths without a device.
 */
fun nominalWidthSp(
    word: WordInfo,
    baseSp: Float = 16f,
    rubyScale: Float = RUBY_SCALE,
    asciiEm: Float = 0.55f,
): Float {
    val base = advanceEm(word.token.surface, asciiEm) * baseSp
    val ruby = word.ruby?.reading?.let { advanceEm(it, asciiEm) * baseSp * rubyScale } ?: 0f
    return maxOf(base, ruby)
}

private fun advanceEm(text: String, asciiEm: Float): Float =
    text.fold(0f) { sum, c -> sum + if (c.code < 0x2000) asciiEm else 1f }

/**
 * Whether [surface] is Japanese at all: kana, a CJK ideograph, the iteration mark or the katakana
 * prolonged sound mark. A Latin word in a mixed-script line is not a word to tap (spec 7 item 8),
 * and it gets no ruby and no popover. Unicode blocks, not a threshold.
 */
fun isJapanese(surface: String): Boolean = surface.any { c ->
    c.code in 0x3040..0x30FF || c.code in 0x4E00..0x9FFF || c == '々' || c == '〆'
}

/**
 * One lyric line with furigana over it.
 *
 * Laid out as rows of words ([rubyRuns]), each word a ruby above a base. [onWordTap] receives the
 * tapped word's index in [words] and is only wired up when [tappable] — on an inactive lyric row
 * the row itself is the control that seeks, and nesting a second control inside it would take the
 * tap away from it (`LyricDisplay.tsx:440`).
 *
 * [onWordLongPress] and [onLongPressLabel] are **required, not defaulted**: a word's own gesture
 * handler consumes the long press as well as the tap, so without them the row's long press stops
 * working over the words — measured on the emulator, where long-pressing the active line opened
 * the popover instead of the nudge screen. They are the row's long press and its label, handed
 * down. Defaulted, a future caller could drop either one and put that bug back with nothing
 * failing; required, it does not compile.
 *
 * **Accessibility:** the ruby is removed from the semantics tree entirely, so a screen reader
 * never reads base and reading interleaved. What it reads is the words' own surfaces, in order,
 * which is the line's text.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun RubyText(
    words: List<WordInfo>,
    onWordTap: (Int) -> Unit,
    onWordLongPress: () -> Unit,
    onLongPressLabel: String,
    modifier: Modifier = Modifier,
    tappable: Boolean = true,
    baseStyle: TextStyle = LocalTextStyle.current,
    rubyScale: Float = RUBY_SCALE,
) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    // The line height has to shrink with the font size: left at the base's, the ruby sits in a
    // box as tall as the lyric and floats a long way above the word it belongs to.
    val rubyStyle = baseStyle.copy(
        fontSize = if (baseStyle.fontSize.isSpecified) baseStyle.fontSize * rubyScale else TextUnit.Unspecified,
        lineHeight = if (baseStyle.lineHeight.isSpecified) baseStyle.lineHeight * rubyScale else TextUnit.Unspecified,
        fontWeight = null,
    )
    val ambiguousColor = MaterialTheme.colorScheme.tertiary

    BoxWithConstraints(modifier) {
        // Pixels throughout: the measurer reports pixels and `constraints` is in pixels, so
        // nothing is converted and nothing depends on sp being additive (see rubyRuns).
        val maxWidthPx = if (constraints.hasBoundedWidth) constraints.maxWidth.toFloat() else Float.MAX_VALUE
        val bases = remember(words) { words.indices.map { spacedBase(words, it) } }
        val runs = remember(words, bases, baseStyle, rubyScale, maxWidthPx, density) {
            val widths = words.indices.map { i ->
                val base = measurer.measure(bases[i], baseStyle).size.width
                val ruby = words[i].ruby?.reading?.let { measurer.measure(it, rubyStyle).size.width } ?: 0
                maxOf(base, ruby).toFloat()
            }
            rubyRuns(words, maxWidthPx) { widths[it] }
        }

        Column {
            var index = 0
            runs.forEach { run ->
                val withRuby = runHasRuby(run)
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.Start) {
                    run.forEach { word ->
                        val i = index++
                        val lookUp = tappable && isJapanese(word.token.surface)
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = if (lookUp) {
                                Modifier.combinedClickable(
                                    onClickLabel = "Look up this word",
                                    onLongClickLabel = onLongPressLabel,
                                    onLongClick = onWordLongPress,
                                    onClick = { onWordTap(i) },
                                )
                            } else {
                                Modifier
                            },
                        ) {
                            // An empty ruby for a kana word keeps the run's bases on one baseline.
                            if (withRuby) {
                                Text(
                                    text = word.ruby?.reading.orEmpty(),
                                    style = rubyStyle,
                                    textAlign = TextAlign.Center,
                                    color = if (word.ruby?.isAmbiguous == true) ambiguousColor else Color.Unspecified,
                                    // Marked two ways, because colour alone is not a mark: a word
                                    // whose reading the data does not pin down is underlined too.
                                    textDecoration = if (word.ruby?.isAmbiguous == true) TextDecoration.Underline else null,
                                    modifier = Modifier.clearAndSetSemantics { },
                                )
                            }
                            Text(bases[i], style = baseStyle)
                        }
                    }
                }
            }
        }
    }
}
