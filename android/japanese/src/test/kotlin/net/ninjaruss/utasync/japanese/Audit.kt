package net.ninjaruss.utasync.japanese

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.resume
import kotlin.coroutines.startCoroutine

// The accuracy audit (spec 7a.2, section 8): a fixed corpus, a recorded expectation per word,
// and printed counts. Expectations must NEVER be produced by the analyzer under test.

/** What a corpus entry's `kind` lets it do. Mirrors scripts/lib/truthKinds.mjs. */
private data class KindRule(val scores: Boolean, val certifies: Boolean)

private val KINDS = mapOf(
    // Written or verified by the owner. The only kind that certifies.
    "hand-labelled" to KindRule(scores = true, certifies = true),
    // A candidate someone else proposed, awaiting owner review: scored, never certifies.
    "unverified" to KindRule(scores = true, certifies = false),
    // Produced by a program: scored, never certifies, and never from the system under test.
    "generated" to KindRule(scores = true, certifies = false),
)

fun isKnownKind(kind: String): Boolean = kind in KINDS
fun canCertify(kind: String): Boolean = KINDS[kind]?.certifies == true

data class CorpusWord(val surface: String, val reading: String, val sense: String, val alternates: List<String>)
data class CorpusEntry(val text: String, val kind: String, val source: String, val words: List<CorpusWord>)
data class Corpus(val v: Int, val entries: List<CorpusEntry>) {
    /** The entries the gate counts: only kinds that certify. */
    fun certified(): Corpus = copy(entries = entries.filter { canCertify(it.kind) })
}

data class AuditCounts(
    val words: Int,
    val wrongReading: Int,
    val wrongSense: Int,
    val blank: Int,
    val unmarkedAlternates: Int,
)

/**
 * Walks the corpus's words, so [AuditCounts.words] is the corpus's count, not the analyzer's.
 * A word is matched by surface. Not returned, or returned with no senses, is `blank`. Otherwise
 * the shown reading (the ruby's, else the token's) is compared with the expectation, and the
 * expected sense must appear (case-insensitively) in some returned gloss.
 * `unmarkedAlternates`: the corpus lists alternates but the ruby carries none.
 */
fun auditAgainst(corpus: Corpus, analyze: (String) -> List<WordInfo>): AuditCounts {
    var words = 0
    var wrongReading = 0
    var wrongSense = 0
    var blank = 0
    var unmarked = 0
    for (entry in corpus.entries) {
        val result = analyze(entry.text)
        for (w in entry.words) {
            words++
            val hit = result.firstOrNull { it.token.surface == w.surface }
            if (hit != null) {
                val shown = hit.ruby?.reading ?: hit.token.reading
                if (shown != w.reading) wrongReading++
                if (w.alternates.isNotEmpty() && hit.ruby?.alternates.isNullOrEmpty()) unmarked++
            } else if (w.alternates.isNotEmpty()) {
                unmarked++ // nothing was shown, so nothing was marked
            }
            if (hit == null || hit.senses.isEmpty()) {
                blank++
            } else if (hit.senses.none { s -> s.glosses.any { it.contains(w.sense, ignoreCase = true) } }) {
                wrongSense++
            }
        }
    }
    return AuditCounts(words, wrongReading, wrongSense, blank, unmarked)
}

/** Runs a suspend call that does not actually suspend (the stub), without a coroutines dependency. */
fun <T> runSuspend(block: suspend () -> T): T {
    var out: Result<T>? = null
    block.startCoroutine(Continuation(EmptyCoroutineContext) { out = it })
    return checkNotNull(out) { "the analyzer suspended; the audit runs it synchronously" }.getOrThrow()
}

private fun resource(name: String): String =
    checkNotNull(CorpusEntry::class.java.classLoader!!.getResourceAsStream(name)) { "missing test resource $name" }
        .readBytes().toString(Charsets.UTF_8)

fun loadCorpus(): Corpus {
    val root = MiniJson.parse(resource("reading-corpus.json")).obj()
    require(root.getValue("v").num() == 1) { "unknown corpus version" }
    return Corpus(
        1,
        root.getValue("entries").list().map { e ->
            val o = e.obj()
            CorpusEntry(
                o.getValue("text").str(),
                o.getValue("kind").str(),
                o.getValue("source").str(),
                o.getValue("words").list().map { w ->
                    val wo = w.obj()
                    CorpusWord(
                        wo.getValue("surface").str(),
                        wo.getValue("reading").str(),
                        wo.getValue("sense").str(),
                        wo.getValue("alternates").list().map { it.str() },
                    )
                },
            )
        },
    )
}

private fun countsJson(c: AuditCounts) =
    "{\"words\": ${c.words}, \"wrongReading\": ${c.wrongReading}, \"wrongSense\": ${c.wrongSense}, " +
        "\"blank\": ${c.blank}, \"unmarkedAlternates\": ${c.unmarkedAlternates}}"

/** `all` scores every entry; `certified` is the gate: hand-labelled entries only. */
fun renderBaseline(all: AuditCounts, certified: AuditCounts): String =
    "{\"v\": 1,\n \"all\": ${countsJson(all)},\n \"certified\": ${countsJson(certified)}}"

fun loadBaseline(): Pair<AuditCounts, AuditCounts> {
    fun counts(o: Map<String, Any?>) = AuditCounts(
        o.getValue("words").num(), o.getValue("wrongReading").num(), o.getValue("wrongSense").num(),
        o.getValue("blank").num(), o.getValue("unmarkedAlternates").num(),
    )
    val root = MiniJson.parse(resource("audit-baseline.json")).obj()
    return counts(root.getValue("all").obj()) to counts(root.getValue("certified").obj())
}

@Suppress("UNCHECKED_CAST")
private fun Any?.obj() = this as Map<String, Any?>

@Suppress("UNCHECKED_CAST")
private fun Any?.list() = this as List<Any?>
private fun Any?.str() = this as String
private fun Any?.num() = (this as Double).toInt()

/** A minimal JSON reader (objects, arrays, strings, numbers): enough for the corpus, and no dependency. */
private object MiniJson {
    fun parse(s: String): Any? {
        val p = Parser(s)
        val v = p.value()
        p.ws()
        check(p.i == s.length) { "trailing JSON at ${p.i}" }
        return v
    }

    private class Parser(val s: String) {
        var i = 0
        fun ws() { while (i < s.length && s[i].isWhitespace()) i++ }
        fun value(): Any? {
            ws()
            return when (val c = s[i]) {
                '{' -> { i++; obj() }
                '[' -> { i++; arr() }
                '"' -> str()
                else -> if (c == '-' || c.isDigit()) num() else error("unexpected '$c' at $i")
            }
        }
        private fun obj(): Map<String, Any?> {
            val m = LinkedHashMap<String, Any?>()
            ws()
            if (s[i] == '}') { i++; return m }
            while (true) {
                ws(); val k = str(); ws(); expect(':'); m[k] = value(); ws()
                if (s[i] == ',') i++ else { expect('}'); return m }
            }
        }
        private fun arr(): List<Any?> {
            val l = ArrayList<Any?>()
            ws()
            if (s[i] == ']') { i++; return l }
            while (true) {
                l.add(value()); ws()
                if (s[i] == ',') i++ else { expect(']'); return l }
            }
        }
        private fun str(): String {
            expect('"')
            val sb = StringBuilder()
            while (s[i] != '"') {
                if (s[i] == '\\') {
                    i++
                    when (val e = s[i]) {
                        'n' -> sb.append('\n'); 't' -> sb.append('\t')
                        'u' -> { sb.append(s.substring(i + 1, i + 5).toInt(16).toChar()); i += 4 }
                        else -> sb.append(e)
                    }
                } else sb.append(s[i])
                i++
            }
            i++
            return sb.toString()
        }
        private fun num(): Double {
            val st = i
            while (i < s.length && (s[i].isDigit() || s[i] in "-+.eE")) i++
            return s.substring(st, i).toDouble()
        }
        private fun expect(c: Char) { check(s[i] == c) { "expected '$c' at $i" }; i++ }
    }
}
