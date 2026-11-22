package net.ninjaruss.utasync.japanese

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.resume
import kotlin.coroutines.startCoroutine

// The accuracy audit (spec 7a.2, section 8): a fixed corpus, a recorded expectation per word,
// and printed counts. Expectations must NEVER be produced by the analyzer under test.

/** What a corpus entry's `kind` lets it do. Mirrors scripts/lib/truthKinds.mjs. */
private data class KindRule(val certifies: Boolean)

private val KINDS = mapOf(
    // Written or verified by the owner. The only kind that certifies.
    "hand-labelled" to KindRule(certifies = true),
    // A candidate someone else proposed, awaiting owner review: scored, never certifies.
    // (Every known kind is scored; an unknown kind is rejected by the corpus tests, not skipped here.)
    "unverified" to KindRule(certifies = false),
    // Produced by a program: scored, never certifies, and never from the system under test.
    "generated" to KindRule(certifies = false),
)

fun isKnownKind(kind: String): Boolean = kind in KINDS
fun canCertify(kind: String): Boolean = KINDS[kind]?.certifies == true

data class CorpusWord(val surface: String, val reading: String, val sense: String, val alternates: List<String>)
data class CorpusEntry(val text: String, val kind: String, val source: String, val words: List<CorpusWord>)
data class Corpus(val v: Int, val entries: List<CorpusEntry>) {
    /** The entries the gate counts: only kinds that certify. */
    fun certified(): Corpus = copy(entries = entries.filter { canCertify(it.kind) })
}

/**
 * Each corpus word gets exactly one verdict: [right], [wrongReading], [wrongSense], [blank] or
 * [unmatched], so those five always sum to [words]. [right] is the number every later task has
 * to move, and it must never fall. [unmarkedAlternates] is a separate axis, not a verdict.
 */
data class AuditCounts(
    val words: Int,
    val right: Int,
    val wrongReading: Int,
    val wrongSense: Int,
    val blank: Int,
    val unmatched: Int,
    val unmarkedAlternates: Int,
) {
    val verdictSum get() = right + wrongReading + wrongSense + blank + unmatched
}

/**
 * Walks the corpus's words, so [AuditCounts.words] is the corpus's count, not the analyzer's.
 * A word is matched by surface. Verdict, first that applies:
 * - `unmatched`: no returned word has that surface (a segmentation disagreement, or nothing
 *   returned: says nothing about meanings, so the owner adjusts the corpus's boundaries);
 * - `blank`: matched but with no senses;
 * - `wrongReading`: the shown reading (the ruby's, else the token's) differs from the expectation;
 * - `wrongSense`: the expected sense is in no returned gloss (case-insensitive, whole words within a gloss: see [glossHasSense]);
 * - otherwise `right`.
 * `unmarkedAlternates`: the corpus lists alternates but the ruby carries none.
 */
fun auditAgainst(corpus: Corpus, analyze: (String) -> List<WordInfo>): AuditCounts {
    var words = 0
    var right = 0
    var wrongReading = 0
    var wrongSense = 0
    var blank = 0
    var unmatched = 0
    var unmarked = 0
    for (entry in corpus.entries) {
        val result = analyze(entry.text)
        for (w in entry.words) {
            words++
            val hit = result.firstOrNull { it.token.surface == w.surface }
            if (w.alternates.isNotEmpty() && hit?.ruby?.alternates.isNullOrEmpty()) unmarked++
            when {
                hit == null -> unmatched++
                hit.senses.isEmpty() -> blank++
                (hit.ruby?.reading ?: hit.token.reading) != w.reading -> wrongReading++
                hit.senses.none { s -> s.glosses.any { glossHasSense(it, w.sense) } } -> wrongSense++
                else -> right++
            }
        }
    }
    return AuditCounts(words, right, wrongReading, wrongSense, blank, unmatched, unmarked)
}

/**
 * True when [sense] appears in [gloss] as a standalone word or word sequence, ignoring case.
 * This is a standalone-word match, NOT a meaning match. It closes the substring cases that
 * inflated `right` ("I" inside "the picture", "he" inside "the", "go" inside "good"), but
 * spaces and hyphens are boundaries too, so "go" still matches "go-between" and "to go wrong".
 * It also errs the other way: "pain" does not match "painful". `right` is the number the plan
 * ratchets on, so treat a high `right` as an upper bound that the owner's labelling must back.
 */
fun glossHasSense(gloss: String, sense: String): Boolean {
    if (sense.isBlank()) return false
    val word = "[\\p{L}\\p{N}]"
    return Regex("(?<!$word)${Regex.escape(sense.trim())}(?!$word)", RegexOption.IGNORE_CASE).containsMatchIn(gloss)
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
    "{\"words\": ${c.words}, \"right\": ${c.right}, \"wrongReading\": ${c.wrongReading}, " +
        "\"wrongSense\": ${c.wrongSense}, \"blank\": ${c.blank}, \"unmatched\": ${c.unmatched}, " +
        "\"unmarkedAlternates\": ${c.unmarkedAlternates}}"

private const val DIRECTION =
    "right is a two-sided ratchet: the test requires right == this baseline. A fall is a regression and an intentional reduction needs a visible edit here; a rise is progress that must be recorded by raising it. An intentional reduction needs an explicit, visible edit of this file. " +
        "The other counts may rise when a real analyzer replaces the stub. Do not read them as accuracy: each word gets ONE verdict, in the order unmatched, blank, wrongReading, wrongSense, right. " +
        "So wrongSense understates (a word wrong in both reading and sense counts only as wrongReading), and blank hides a reading error. wrongSense = 0 does not mean the senses are fine."

/** `all` scores every entry; `certified` is the gate: hand-labelled entries only. */
fun renderBaseline(all: AuditCounts, certified: AuditCounts): String =
    "{\"v\": 1,\n \"direction\": \"$DIRECTION\",\n \"all\": ${countsJson(all)},\n \"certified\": ${countsJson(certified)}}"

fun loadBaseline(): Pair<AuditCounts, AuditCounts> {
    fun counts(o: Map<String, Any?>) = AuditCounts(
        o.getValue("words").num(), o.getValue("right").num(), o.getValue("wrongReading").num(),
        o.getValue("wrongSense").num(), o.getValue("blank").num(), o.getValue("unmatched").num(),
        o.getValue("unmarkedAlternates").num(),
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
