package net.ninjaruss.utasync.japanese

import android.content.Context
import java.io.InputStream

/** The asset `scripts/build-japanese-db.mjs` writes: only surfaces read more than one way. */
const val READING_ALTERNATES_ASSET = "reading-alternates.json"

/**
 * Parses the alternates asset, `{ surface: [[common readings], [uncommon readings]] }`, into the
 * lookup [rubyFor] takes: surface to **every** reading that surface is known to take.
 *
 * **The union of both lists, deliberately.** The split is common-versus-uncommon, not
 * primary-versus-alternates: 彼 has あれ and かれ, both common, and reading only the second list
 * would leave it looking unambiguous. [rubyFor] drops the reading actually being shown, so
 * including it here costs nothing and losing a rival reading costs the whole mark.
 *
 * Hand-written because the asset has to be readable in a plain JVM unit test, where `org.json`
 * is a stub that throws, and CLAUDE.md rule 5 forbids adding a JSON library for it. The shape is
 * the one file this project writes, not JSON at large: an object of arrays of arrays of strings.
 */
fun parseReadingAlternates(json: String): Map<String, List<String>> {
    val out = LinkedHashMap<String, List<String>>()
    val s = Json(json)
    s.expect('{')
    if (s.peek() == '}') return out
    while (true) {
        val surface = s.string()
        s.expect(':')
        out[surface] = s.readingLists()
        if (s.peek() == ',') { s.expect(','); continue }
        s.expect('}')
        return out
    }
}

/** As [parseReadingAlternates], reading [stream] (UTF-8) to its end and closing nothing. */
fun parseReadingAlternates(stream: InputStream): Map<String, List<String>> =
    parseReadingAlternates(stream.reader(Charsets.UTF_8).readText())

/**
 * The shipped asset, parsed. The whole map is held in memory (about 20k surfaces), so load it
 * once and keep it; it is not meant to be reparsed per line.
 */
fun readingAlternates(context: Context): Map<String, List<String>> =
    context.assets.open(READING_ALTERNATES_ASSET).use(::parseReadingAlternates)

/** A cursor over the alternates file. Only the shapes that file uses are accepted. */
private class Json(private val src: String) {
    private var i = 0

    fun peek(): Char {
        while (i < src.length && src[i].isWhitespace()) i++
        check(i < src.length) { "unterminated JSON at $i" }
        return src[i]
    }

    fun expect(c: Char) {
        check(peek() == c) { "expected '$c' at $i, found '${src[i]}'" }
        i++
    }

    fun string(): String {
        expect('"')
        val sb = StringBuilder()
        while (src[i] != '"') {
            if (src[i] == '\\') {
                i++
                when (val e = src[i]) {
                    'n' -> sb.append('\n')
                    't' -> sb.append('\t')
                    'u' -> { sb.append(src.substring(i + 1, i + 5).toInt(16).toChar()); i += 4 }
                    else -> sb.append(e)
                }
            } else {
                sb.append(src[i])
            }
            i++
        }
        i++
        return sb.toString()
    }

    /** `[[..], [..]]` — every list on every side, blanks dropped, each reading once. */
    fun readingLists(): List<String> {
        val all = ArrayList<String>()
        expect('[')
        while (peek() != ']') {
            expect('[')
            while (peek() != ']') {
                all += string()
                if (peek() == ',') expect(',')
            }
            expect(']')
            if (peek() == ',') expect(',')
        }
        expect(']')
        return all.filter { it.isNotBlank() }.distinct()
    }
}
