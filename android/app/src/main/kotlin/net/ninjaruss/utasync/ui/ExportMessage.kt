package net.ninjaruss.utasync.ui

import net.ninjaruss.utasync.align.LrcExport

/**
 * What the user is told after trying to export a `.lrc`, and nothing else: the caller decides
 * whether to write by asking whether [LrcExport.text] is empty, which is the same question asked
 * here. An export of nothing used to write a zero-byte file and report "Exported", which is the
 * worst kind of false label — the user has a file they believe holds their corrections.
 *
 * [writeFailed] is true only when a write was attempted and did not succeed.
 */
fun exportMessage(export: LrcExport, writeFailed: Boolean): String = when {
    // No line has a time, so there is nothing an LRC file could hold. Nothing was written.
    export.text.isEmpty() -> "No line has a time yet, so nothing was written"
    writeFailed -> "Could not write the file"
    export.droppedLines == 1 -> "Exported; 1 untimed line was left out"
    export.droppedLines > 1 -> "Exported; ${export.droppedLines} untimed lines were left out"
    else -> "Exported"
}
