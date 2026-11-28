package net.ninjaruss.utasync.ui

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The player's app bar is the one place a song's own text is drawn in a fixed-height bar, and a
 * song's name is whatever a file was called — on the owner's device, a whole downloader filename.
 * On the first real-song run (2026-11-28) such a title wrapped to three lines, the third was cut
 * through the middle of the characters, and it collided with the "Tap along" action.
 *
 * Nothing else would catch that: `:app` has no Robolectric and these are pure-JVM tests, so a
 * composable's layout cannot be rendered here. This reads the source instead, the same way
 * `SongDaoStateVocabularyTest` reads SQL the compiler cannot check. It is deliberately narrow: it
 * asks only that the title the user cannot control is held to one line.
 */
class AppBarTitleTest {
    private val relative = "app/src/main/kotlin/net/ninjaruss/utasync/ui/PlayerScreen.kt"

    /** The unit-test working directory is not contractual, so look for the file from here up. */
    private fun source(): File? = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, relative) }
        .firstOrNull { it.isFile }

    @Test fun `the player's app-bar title is held to one line, so it cannot clip or collide`() {
        val file = source()
        assertTrue("$relative not found from ${File("").absolutePath}", file != null)
        // The block as written, however it is indented or wrapped: from the title slot to the
        // end of what it draws.
        val text = file!!.readText()
        val start = text.indexOf("title = {")
        assertTrue("no TopAppBar title slot found in $relative", start >= 0)
        val call = text.substring(start, minOf(start + 400, text.length))
        assertTrue(
            "the app-bar title draws a song's own name and must set maxLines = 1:\n$call",
            call.contains("maxLines = 1"),
        )
        assertTrue(
            "a one-line title that is cut off must say so, with an ellipsis:\n$call",
            call.contains("Ellipsis"),
        )
    }
}
