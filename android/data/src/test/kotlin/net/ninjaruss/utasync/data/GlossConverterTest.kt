package net.ninjaruss.utasync.data

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The converter is the Kotlin half of the packing `scripts/build-japanese-db.mjs` writes
 * (`buildJapaneseDb.test.mjs` pins the other half to the same U+001F separator).
 */
class GlossConverterTest {
    private val converter = GlossConverter()

    @Test fun theSeparatorIsTheUnitSeparatorTheScriptWrites() {
        assertEquals("\u001F", GlossConverter.SEPARATOR)
    }

    @Test fun aListSurvivesAPackAndUnpackRoundTrip() {
        val glosses = listOf("to go; to move (towards)", "to head", "x, y")
        assertEquals(glosses, converter.unpack(converter.pack(glosses)))
    }

    @Test fun anEmptyListPacksToTheEmptyStringAndBack() {
        assertEquals("", converter.pack(emptyList()))
        assertEquals(emptyList<String>(), converter.unpack(""))
    }

    @Test fun glossesContainingSemicolonsAndCommasAreNotSplit() {
        // The PWA's own separator was "; ". Gloss text may contain it only if the script let it
        // through, and the converter must still hand back exactly what was packed.
        val packed = "a; b" + GlossConverter.SEPARATOR + "c"
        assertEquals(listOf("a; b", "c"), converter.unpack(packed))
    }
}
