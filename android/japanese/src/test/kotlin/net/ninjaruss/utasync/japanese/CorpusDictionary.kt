package net.ninjaruss.utasync.japanese

import java.io.File
import net.ninjaruss.utasync.data.DictionaryDao
import net.ninjaruss.utasync.data.DictionaryEntity

// The audit needs a REAL dictionary, not a hand-written one. A fake whose glosses were typed next
// to the expectations would make `right` a measure of the typing. So the audit reads the same
// committed input the shipped table is built from — public/jmdict-popover.json — and applies the
// same conversion rules as scripts/build-japanese-db.mjs (reading required, glosses split on ';',
// senseIndex consecutive over kept groups).
//
// Two consequences to keep in mind, both reported with the counts:
//  - The rules live twice, here and in the script. tests/scripts/buildJapaneseDb.test.mjs pins the
//    script; this pins nothing about the script, so a divergence would show up as the audit and
//    the device disagreeing, not as a failure here.
//  - Room is not involved. A JVM unit test cannot open the 37 MB seed database without a driver
//    (CLAUDE.md rule 5), so the DAO's SQL is exercised by :data's instrumented DictionaryTest, and
//    what is exercised here is sense selection over real dictionary rows.

/** The PWA data the shipped dictionary is converted from. */
private const val POPOVER = "public/jmdict-popover.json"

/** The shipped alternates asset. */
private const val ALTERNATES = "japanese/src/main/assets/reading-alternates.json"

/** The unit-test working directory is not contractual, so look for a repository file from here up. */
private fun repoFile(relative: String): File {
    val found = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, relative) }
        .firstOrNull { it.isFile }
    return checkNotNull(found) { "$relative not found from ${File("").absolutePath}" }
}

/**
 * The real dictionary, for the [surfaces] asked for. Only those are kept, so the 29 MB source is
 * read once and nothing else of it is held. Asking about a surface it was not built for fails
 * loudly: a silent empty answer would look like "the dictionary does not have this word".
 */
class CorpusDictionary(surfaces: Set<String>) : DictionaryDao {
    private val rows: Map<String, List<DictionaryEntity>> = read(surfaces)
    private val known = surfaces

    override suspend fun entriesFor(surface: String): List<DictionaryEntity> {
        check(surface in known) { "the test dictionary was not built for '$surface'" }
        return rows[surface].orEmpty()
    }

    override suspend fun entriesFor(surface: String, reading: String): List<DictionaryEntity> =
        entriesFor(surface).filter { it.reading == reading }

    private companion object {
        /** One flat object per sense group; no gloss or reading contains a brace. */
        val GROUP = Regex("""\{[^{}]*}""")
        val FIELD = Regex(""""(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"""")

        fun read(surfaces: Set<String>): Map<String, List<DictionaryEntity>> {
            val text = repoFile(POPOVER).readText()
            val out = HashMap<String, List<DictionaryEntity>>(surfaces.size * 2)
            val key = "\"entries\":"
            var i = text.indexOf(key)
            check(i >= 0) { "$POPOVER has no entries object" }
            i = ws(text, i + key.length)
            check(text[i] == '{') { "$POPOVER's entries is not an object" }
            i++
            while (true) {
                i = ws(text, i)
                when (text[i]) {
                    '}' -> return out
                    ',' -> { i++; continue }
                }
                val surface = StringBuilder()
                i = ws(text, string(text, i, surface))
                check(text[i] == ':') { "expected ':' at $i" }
                val start = ws(text, i + 1)
                i = skipValue(text, start)
                if (surface.toString() in surfaces) out[surface.toString()] = groups(surface.toString(), text.substring(start, i))
            }
        }

        /** The same drops and the same numbering as scripts/build-japanese-db.mjs. */
        fun groups(surface: String, slice: String): List<DictionaryEntity> {
            var senseIndex = 0
            return GROUP.findAll(slice).mapNotNull { m ->
                val fields = FIELD.findAll(m.value).associate { it.groupValues[1] to unescape(it.groupValues[2]) }
                val reading = fields["r"]?.trim().orEmpty()
                val glosses = fields["g"].orEmpty().split(';').map { it.trim() }.filter { it.isNotEmpty() }
                if (reading.isEmpty() || glosses.isEmpty()) null
                else DictionaryEntity(surface, reading, fields["pos"], glosses, senseIndex++)
            }.toList()
        }

        fun unescape(s: String): String {
            if ('\\' !in s) return s
            val sb = StringBuilder()
            var i = 0
            while (i < s.length) {
                if (s[i] == '\\') {
                    i++
                    when (val e = s[i]) {
                        'n' -> sb.append('\n')
                        't' -> sb.append('\t')
                        'u' -> { sb.append(s.substring(i + 1, i + 5).toInt(16).toChar()); i += 4 }
                        else -> sb.append(e)
                    }
                } else {
                    sb.append(s[i])
                }
                i++
            }
            return sb.toString()
        }

        fun ws(t: String, from: Int): Int {
            var i = from
            while (i < t.length && t[i].isWhitespace()) i++
            check(i < t.length) { "unterminated JSON at $i" }
            return i
        }

        /** Reads the string starting at [from] into [into]; returns the index after it. */
        fun string(t: String, from: Int, into: StringBuilder): Int {
            check(t[from] == '"') { "expected a string at $from" }
            var i = from + 1
            while (t[i] != '"') {
                if (t[i] == '\\') {
                    i++
                    when (val e = t[i]) {
                        'n' -> into.append('\n')
                        't' -> into.append('\t')
                        'u' -> { into.append(t.substring(i + 1, i + 5).toInt(16).toChar()); i += 4 }
                        else -> into.append(e)
                    }
                } else {
                    into.append(t[i])
                }
                i++
            }
            return i + 1
        }

        /** Skips one array or object value, strings and their escapes included. */
        fun skipValue(t: String, from: Int): Int {
            var i = from
            var depth = 0
            while (i < t.length) {
                when (t[i]) {
                    '"' -> { i = string(t, i, StringBuilder()); continue }
                    '[', '{' -> depth++
                    ']', '}' -> { depth--; if (depth == 0) return i + 1 }
                }
                i++
            }
            error("unterminated value at $from")
        }
    }
}

/** Every surface and dictionary form the corpus's own sentences tokenise to. */
fun corpusSurfaces(corpus: Corpus): Set<String> = corpus.entries
    .flatMap { tokenize(it.text) }
    .flatMap { listOfNotNull(it.surface, it.baseForm) }
    .toSet()

/** The alternates lookup the app ships, parsed from the asset by the production parser. */
fun shippedAlternates(): (String) -> List<String> {
    val map = parseReadingAlternates(repoFile(ALTERNATES).readText())
    return { map[it].orEmpty() }
}

/**
 * The analyzer the audit scores: the real [Analyzer], the real dictionary rows and the shipped
 * alternates. Nothing here is hand-written per corpus word.
 */
fun corpusAnalyzer(corpus: Corpus): (String) -> List<WordInfo> {
    val analyzer = Analyzer(CorpusDictionary(corpusSurfaces(corpus)), shippedAlternates())
    return { text -> runSuspend { analyzer.analyze(text, ReadingMode.DICTIONARY) } }
}
