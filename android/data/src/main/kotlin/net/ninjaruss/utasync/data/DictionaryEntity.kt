package net.ninjaruss.utasync.data

import androidx.room.Entity
import androidx.room.TypeConverter

/**
 * One sense group of a dictionary headword: [surface] read as [reading], with the part of speech
 * it carries and its [glosses].
 *
 * Rows are converted at build time from the PWA's audited `jmdict-popover.json` by
 * `scripts/build-japanese-db.mjs`; the app never writes them. [senseIndex] is the group's
 * position among the surface's **kept** groups, numbered consecutively from 0 in the order the
 * PWA's popover ranked them (common first), so it is unique per surface and is the display order.
 * The script drops a group it cannot store (no gloss, no reading) and does not number it, so a
 * [senseIndex] is a position in what shipped, not in the source.
 * A reading can have several groups (わたくし is both a pronoun and an adjective).
 *
 * [posLabel] is null where the source had no part of speech; a plain noun's label is not forced.
 */
@Entity(
    tableName = "dictionary",
    // The exact key IS the primary key, so no @Index is needed: (surface) alone and
    // (surface, reading) are both prefixes of it, which is what DictionaryDao queries by.
    // SQLite still builds one sqlite_autoindex over these columns; that is the lookup structure,
    // and the point is that there is no *second* one. [senseIndex] makes each group's row distinct.
    primaryKeys = ["surface", "reading", "senseIndex"],
)
data class DictionaryEntity(
    val surface: String,
    val reading: String,
    val posLabel: String?,
    val glosses: List<String>,
    val senseIndex: Int,
)

/**
 * Glosses are stored as one TEXT column, joined by [SEPARATOR] (U+001F, the ASCII unit separator,
 * which no gloss contains: the conversion script refuses a gloss that does). Callers only ever see
 * a `List<String>`.
 *
 * The script writes the same packing; `buildJapaneseDb.test.mjs` and `GlossConverterTest` each
 * pin one side of it, and `DictionaryTest` reads the shipped file through this converter.
 */
class GlossConverter {
    @TypeConverter
    fun pack(glosses: List<String>): String = glosses.joinToString(SEPARATOR)

    @TypeConverter
    fun unpack(packed: String): List<String> = if (packed.isEmpty()) emptyList() else packed.split(SEPARATOR)

    companion object {
        const val SEPARATOR = "\u001F"
    }
}
