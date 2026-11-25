package net.ninjaruss.utasync.ui

import android.content.Context
import net.ninjaruss.utasync.japanese.ReadingMode

/**
 * The reading the app shows over the Japanese, and the words it says about it.
 *
 * **One control with three states, not two settings** (spec §7 item 9): off, the dictionary
 * reading, and the sung reading where it is known. Romaji is not among them — it is absent from
 * the product (§3), not merely defaulted off.
 */

/**
 * The default: the dictionary reading, never off.
 *
 * Furigana is the feature, so a fresh install shows it. It is the *dictionary* reading because
 * the sung one needs a transcript and no engine produces one (§4.2); defaulting to a state that
 * cannot be fulfilled would be a setting that lies about what the app knows.
 */
val DEFAULT_READING_MODE: ReadingMode = ReadingMode.DICTIONARY

/**
 * The stored string as a mode, falling back to [DEFAULT_READING_MODE] for anything this build does
 * not know — a value written by a later version the user downgraded from, a renamed enum, a
 * corrupted preferences file. Derived over [ReadingMode.entries] rather than matched case by case,
 * so a mode added later round-trips without an edit here.
 */
internal fun readingModeFrom(stored: String?): ReadingMode =
    ReadingMode.entries.firstOrNull { it.name == stored } ?: DEFAULT_READING_MODE

/** What the control calls each state. */
internal fun readingModeLabel(mode: ReadingMode): String = when (mode) {
    ReadingMode.OFF -> "No furigana"
    ReadingMode.DICTIONARY -> "Dictionary reading"
    ReadingMode.SUNG -> "As sung, where it is known"
}

/**
 * What the control says under [ReadingMode.SUNG], and the reason the state is offered at all.
 *
 * The honest sentence, not a feature claim: a singer assigns readings freely, so the sung reading
 * can only come from hearing the audio, and nothing in this app hears it yet (§4.2, ADR-0003).
 * The state exists so the preference survives the engine arriving; until then it shows exactly
 * what the dictionary state shows, and **says so** rather than letting the user believe otherwise.
 */
internal const val SUNG_READING_CAVEAT =
    "Nothing in the app hears the singing yet, so this shows the dictionary reading today. " +
        "A word read more than one way is marked either way — tap it to see the other readings."

/**
 * The attribution the licences require **in the app**, not only in a file (spec §5).
 *
 * Here as data, in one place, so the screen cannot drift from it and so a test can hold it to
 * naming each work and its licence. Two separate obligations: JMdict/EDICT is CC BY-SA, which
 * requires credit and names the licence; Kuromoji is Apache 2.0 and ships IPADIC under IPADIC's
 * own terms.
 */
internal val DICTIONARY_ATTRIBUTION: List<String> = listOf(
    "Readings and meanings come from JMdict/EDICT, © Electronic Dictionary Research and " +
        "Development Group, used under CC BY-SA 4.0.",
    "Japanese is split into words by Kuromoji (© Atilika Inc., Apache License 2.0) with the " +
        "IPADIC dictionary (© Nara Institute of Science and Technology), each under its own licence.",
)

/**
 * The stored reading mode. Backed by the same `SharedPreferences` file as
 * `net.ninjaruss.utasync.prepare.FetchSetting` — one file for the app's settings — whose name is
 * repeated here because that class keeps it private and `:app` does not depend on its internals.
 * The two keys are distinct, so the duplication costs nothing beyond this note.
 *
 * The mapping is [readingModeFrom]'s, which is where the tests are: a `SharedPreferences` needs a
 * `Context`, and `:app` has no Robolectric (CLAUDE.md rule 5), so what guards this class itself is
 * the compiler and running the app.
 */
class ReadingSetting(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var mode: ReadingMode
        get() = readingModeFrom(prefs.getString(KEY, null))
        set(value) {
            prefs.edit().putString(KEY, value.name).apply()
        }

    private companion object {
        const val PREFS = "utasync"
        const val KEY = "reading_mode"
    }
}
