package net.ninjaruss.utasync.japanese

import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The audit's `right` count only means what it claims — accuracy over the dictionary the app
 * ships — while [CorpusDictionary] converts `jmdict-popover.json` the way
 * `scripts/build-japanese-db.mjs` does. That rule lives in two languages, and until this test
 * existed nothing compared them: changing a drop rule in the script would have moved the shipped
 * table and left `right` untouched, so the audit would have gone on reporting a number for data
 * the device no longer had.
 *
 * `scripts/build-audit-digest.mjs` writes the digest; this reproduces it. Adding the test found
 * two rules the Kotlin side was missing (the separator refusal, and mapping an empty part of
 * speech to null). Neither changed a row in today's data, which is why a review caught them and
 * three months of green tests had not.
 *
 * **If this fails, the two conversions have diverged. Fix the divergence. Do not regenerate the
 * digest to make it pass** — regenerating records the drift instead of catching it.
 */
class AuditDictionaryDigestTest {
    @Test fun `the Kotlin dictionary reader converts exactly what the build script converts`() {
        val digest = loadDigest()
        val corpus = loadCorpus()
        val surfaces = declaredSurfaces(corpus)
        assertEquals("corpus surface count", digest.surfaces, surfaces.size)

        val rows = CorpusDictionary(surfaces).allRows()
        assertEquals("rows for the corpus surfaces", digest.rows, rows.size)
        assertEquals("surfaces found in the dictionary", digest.surfacesFound, rows.map { it.surface }.toSet().size)

        val lines = rows.map { CorpusDictionary.canonicalLine(it) }.sorted()
        assertEquals(
            "sha256 of the canonical rows — the two conversions have diverged; fix the code, do not regenerate",
            digest.sha256,
            sha256(lines.joinToString("\n")),
        )
    }

    private data class Digest(val surfaces: Int, val surfacesFound: Int, val rows: Int, val sha256: String)

    private fun loadDigest(): Digest {
        val text = resource("audit-dictionary-digest.json")
        fun int(key: String) = Regex("\"$key\"\\s*:\\s*(\\d+)").find(text)!!.groupValues[1].toInt()
        val hash = Regex("\"sha256\"\\s*:\\s*\"([0-9a-f]{64})\"").find(text)!!.groupValues[1]
        return Digest(int("surfaces"), int("surfacesFound"), int("rows"), hash)
    }

    private fun resource(name: String): String =
        checkNotNull(javaClass.classLoader!!.getResourceAsStream(name)) { "$name missing" }
            .use { it.readBytes().decodeToString() }

    private fun sha256(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}
